import axios from 'axios'
import { WeatherCondition, RuleAction, WeatherConditionLogic, ConditionGroup } from '../models/AutomationRule'
import { RuleExecution } from '../repositories/AutomationRuleRepository'
import { MetaAdsService } from './MetaAdsService'
import { GoogleAdsService } from './GoogleAdsService'
import { JobScheduler, JobData, JobResult } from './JobScheduler'
import { RateLimiter } from './RateLimiter'
import { logger } from '../utils/logger'
import { query } from '../config/database'

interface WeatherData {
  temperature: number
  humidity: number
  wind_speed: number
  precipitation: number
  visibility: number
  cloud_cover: number
  description: string
  icon: string
  condition_id: number
}

interface ExecutionMetrics {
  weatherApiCalls: number
  metaApiCalls: number
  googleApiCalls: number
  totalExecutionTime: number
  conditionsEvaluated: number
  actionsExecuted: number
}

export class AutomationEngine {
  private metaAdsService: MetaAdsService
  private googleAdsService: GoogleAdsService
  private jobScheduler: JobScheduler
  private rateLimiter: RateLimiter
  private weatherApiKey: string
  private isRunning: boolean = false
  private processingCount: number = 0

  constructor() {
    this.metaAdsService = new MetaAdsService()
    this.googleAdsService = new GoogleAdsService()
    this.jobScheduler = new JobScheduler()
    this.rateLimiter = new RateLimiter()
    this.weatherApiKey = process.env.OPENWEATHER_API_KEY!
    
    if (!this.weatherApiKey) {
      throw new Error('OPENWEATHER_API_KEY environment variable is required')
    }
  }

  async startEngine(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Automation engine is already running')
      return
    }

    try {
      logger.info('Starting automation engine...')
      
      // Connect to Redis
      await this.jobScheduler.connect()
      await this.rateLimiter.connect()

      // Initialize existing automation rules as scheduled jobs
      await this.initializeAutomationRules()

      // Start the main processing loop
      this.isRunning = true
      try { const { workerStatsHooks } = await import('./engineInstance'); workerStatsHooks.setStatus('running') } catch {}
      this.startProcessingLoop()

      // Start recovery job for stuck jobs
      this.startRecoveryLoop()

      logger.info(' automation engine started successfully')
    } catch (error) {
      logger.error('Failed to start automation engine:', error)
      throw error
    }
  }

  async stopEngine(): Promise<void> {
    this.isRunning = false
    
    try {
      await this.jobScheduler.disconnect()
      await this.rateLimiter.disconnect()
      try { const { workerStatsHooks } = await import('./engineInstance'); await workerStatsHooks.setStatus('stopped') } catch {}
      logger.info('Automation engine stopped')
    } catch (error) {
      logger.error('Error stopping automation engine:', error)
    }
  }

  /**
   * Initialize existing automation rules as scheduled jobs
   */
  private async initializeAutomationRules(): Promise<void> {
    try {
      const result = await query(
        'SELECT id, user_id, check_interval_minutes, is_active, last_checked_at FROM automation_rules WHERE is_active = true'
      )

      const activeRules = result.rows
      logger.info(`Initializing ${activeRules.length} active automation rules`)

      for (const rule of activeRules) {
        // Calculate next check time
        const now = Date.now()
        const lastChecked = rule.last_checked_at ? new Date(rule.last_checked_at).getTime() : 0
        const intervalMs = rule.check_interval_minutes * 60 * 1000
        const nextCheckTime = Math.max(now, lastChecked + intervalMs)

        await this.jobScheduler.scheduleJob({
          id: `rule_check_${rule.id}`,
          type: 'automation_rule_check',
          ruleId: rule.id,
          userId: rule.user_id,
          intervalMinutes: rule.check_interval_minutes,
          priority: 1,
          retryCount: 0,
          maxRetries: 3,
          scheduledAt: nextCheckTime
        })
      }

      logger.info('Automation rules initialized successfully')
    } catch (error) {
      logger.error('Failed to initialize automation rules:', error)
      throw error
    }
  }

  /**
   * Main processing loop
   */
  private startProcessingLoop(): void {
    const processJobs = async () => {
      if (!this.isRunning) return

      try {
        const readyJobs = await this.jobScheduler.getReadyJobs(5) // Process up to 5 jobs at once
        
        if (readyJobs.length > 0) {
          logger.debug(`Processing ${readyJobs.length} ready jobs`)
          
          // Process jobs in parallel (with concurrency limit)
          const jobPromises = readyJobs.map(job => this.processJob(job))
          this.processingCount += readyJobs.length
          try { const { workerStatsHooks } = await import('./engineInstance'); workerStatsHooks.setCurrentJobs(this.processingCount) } catch {}
          await Promise.allSettled(jobPromises)
          this.processingCount = Math.max(0, this.processingCount - readyJobs.length)
          try { const { workerStatsHooks } = await import('./engineInstance'); workerStatsHooks.setCurrentJobs(this.processingCount) } catch {}
        }

        // Log statistics periodically
        if (Math.random() < 0.1) { // 10% chance to log stats
          await this.logEngineStats()
        }

      } catch (error) {
        logger.error('Error in processing loop:', error)
      }

      // Schedule next iteration
      setTimeout(processJobs, 5000) // Check every 5 seconds
    }

    processJobs()
  }

  /**
   * Recovery loop for stuck jobs
   */
  private startRecoveryLoop(): void {
    const runRecovery = async () => {
      if (!this.isRunning) return

      try {
        const recoveredCount = await this.jobScheduler.recoverStuckJobs()
        if (recoveredCount > 0) {
          logger.info(`Recovery cycle completed: ${recoveredCount} jobs recovered`)
        }
      } catch (error) {
        logger.error('Error in recovery loop:', error)
      }

      setTimeout(runRecovery, 300000) // Run every 5 minutes
    }

    setTimeout(runRecovery, 60000) // Start after 1 minute
  }

  // Public: run a rule immediately (bypass scheduler)
  async runRuleOnce(ruleId: string): Promise<void> {
    await this.processAutomationRule(ruleId)
  }

  /**
   * Process a single job
   */
  private async processJob(job: JobData): Promise<void> {
    const startTime = Date.now()
    let result: JobResult

    // Mark job as processing
    const marked = await this.jobScheduler.markJobProcessing(job.id)
    if (!marked) {
      logger.warn(`Job ${job.id} was already processed by another worker`)
      return
    }

    try {
      logger.info(`Processing job ${job.id} for rule ${job.ruleId}`, {
        attempt: job.retryCount + 1,
        maxRetries: job.maxRetries
      })

      switch (job.type) {
        case 'automation_rule_check':
          await this.processAutomationRule(job.ruleId)
          break
        default:
          throw new Error(`Unknown job type: ${job.type}`)
      }

      result = {
        success: true,
        executionTime: Date.now() - startTime
      }

    } catch (error: any) {
      const executionTime = Date.now() - startTime
      
      logger.error(`Job ${job.id} failed:`, {
        error: error.message,
        ruleId: job.ruleId,
        attempt: job.retryCount + 1,
        executionTime
      })

      // Determine if we should retry and how long to wait
      const retryAfter = this.calculateRetryDelay(error, job.retryCount)

      result = {
        success: false,
        error: error.message,
        executionTime,
        retryAfter
      }
    }

    // Complete the job
    await this.jobScheduler.completeJob(job.id, result)
    try { const { workerStatsHooks } = await import('./engineInstance'); await workerStatsHooks.markProcessed(result.success) } catch {}
  }

  /**
   * Process automation rule execution (new version)
   */
  private async processAutomationRule(ruleId: string): Promise<void> {
    const metrics: ExecutionMetrics = {
      weatherApiCalls: 0,
      metaApiCalls: 0,
      googleApiCalls: 0,
      totalExecutionTime: 0,
      conditionsEvaluated: 0,
      actionsExecuted: 0
    }

    const executionStartTime = Date.now()

    try {
      // Get rule details
      const rule = await this.getRuleById(ruleId)
      if (!rule) {
        throw new Error(`Rule ${ruleId} not found`)
      }

      if (!rule.is_active) {
        logger.info(`Rule ${ruleId} is no longer active, skipping`)
        return
      }

      // Update last checked time
      await this.updateLastChecked(ruleId)

      // Get weather data with rate limiting
      const weatherData = await this.rateLimiter.executeWithBackoff(
        () => this.getWeatherData(rule.location.lat, rule.location.lon),
        { service: 'openweather', endpoint: 'current_weather' }
      )
      metrics.weatherApiCalls++

      // Evaluate conditions
      const conditionsMet = rule.condition_logic 
        ? this.evaluateConditionLogic(rule.condition_logic, weatherData)
        : this.evaluateConditions(rule.conditions, weatherData)
      
      metrics.conditionsEvaluated++

      logger.info(`Rule ${rule.name} evaluation result:`, {
        ruleId,
        conditionsMet,
        temperature: weatherData.temperature,
        humidity: weatherData.humidity,
        description: weatherData.description
      })

      // Execute actions if conditions met
      const actions: RuleAction[] = []
      let executionSuccess = true

      if (conditionsMet) {
        logger.info(`Executing actions for rule ${rule.name}`)
        
        const campaigns = rule.campaigns as any[]
        const executePromises = campaigns.map(async (campaign: any) => {
          try {
            const action = await this.executeAction(campaign, metrics, rule.user_id)
            actions.push(action)
            if (!action.success) executionSuccess = false
            return action
          } catch (error: any) {
            const failedAction = {
              campaign_id: campaign.campaign_id,
              platform: campaign.platform,
              action: campaign.action,
              success: false,
              error_message: error.message,
              target_type: campaign.target_type === 'ad_set' ? 'ad_set' as const : 'campaign' as const,
              ...(campaign.ad_set_id && { ad_set_id: campaign.ad_set_id })
            }
            actions.push(failedAction)
            executionSuccess = false
            return failedAction
          }
        })

        await Promise.allSettled(executePromises)
        metrics.actionsExecuted = actions.filter(a => a.success).length
        
        if (executionSuccess) {
          await this.updateLastExecuted(ruleId)
        }
      }

      metrics.totalExecutionTime = Date.now() - executionStartTime

      // Store execution record
      await this.storeExecutionRecord({
        rule_id: ruleId,
        executed_at: new Date(),
        weather_data: weatherData,
        conditions_met: conditionsMet,
        actions_taken: actions,
        success: !conditionsMet || executionSuccess,
        metrics
      })

    } catch (error: any) {
      metrics.totalExecutionTime = Date.now() - executionStartTime
      
      // Store failed execution record
      await this.storeExecutionRecord({
        rule_id: ruleId,
        executed_at: new Date(),
        weather_data: null,
        conditions_met: false,
        actions_taken: [],
        success: false,
        error_message: error.message,
        metrics
      })

      throw error
    }
  }

  /**
   * Execute campaign action with rate limiting
   */
  private async executeAction(campaign: any, metrics: ExecutionMetrics, userId: string): Promise<RuleAction> {
    const isAdSetTarget = campaign.target_type === 'ad_set' && !!campaign.ad_set_id
    const action: RuleAction = {
      campaign_id: campaign.campaign_id,
      platform: campaign.platform,
      action: campaign.action,
      success: false,
      ...(isAdSetTarget ? { ad_set_id: campaign.ad_set_id, target_type: 'ad_set' as const } : { target_type: 'campaign' as const })
    }

    try {
      if (campaign.platform === 'meta') {
        await this.rateLimiter.executeWithBackoff(
          async () => {
            const metaAccount = await this.getMetaAccountByUserId(campaign.user_id || userId)
            if (!metaAccount) {
              throw new Error('Meta account not found')
            }

            const status = campaign.action === 'pause' ? 'PAUSED' : 'ACTIVE'
            if (isAdSetTarget) {
              // Validate ad set exists before updating
              const adSetDetails = await this.metaAdsService.getAdSet(
                campaign.ad_set_id,
                metaAccount.access_token
              )
              if (!adSetDetails) {
                throw new Error(`Ad set ${campaign.ad_set_id} not found or inaccessible`)
              }
              return await this.metaAdsService.updateAdSetStatus(
                campaign.ad_set_id,
                status,
                metaAccount.access_token
              )
            } else {
              return await this.metaAdsService.updateCampaignStatus(
                campaign.campaign_id, 
                status, 
                metaAccount.access_token
              )
            }
          },
          { service: 'meta_ads', endpoint: isAdSetTarget ? 'adset_update' : 'campaign_update', maxRetries: 2 }
        )
        metrics.metaApiCalls++
        action.success = true

      } else if (campaign.platform === 'google') {
        await this.rateLimiter.executeWithBackoff(
          async () => {
            const googleAccount = await this.getGoogleAccountByUserId(campaign.user_id || userId)
            if (!googleAccount) {
              throw new Error('Google account not found')
            }

            const status = campaign.action === 'pause' ? 'PAUSED' : 'ENABLED'
            return await this.googleAdsService.updateCampaignStatus(
              campaign.campaign_id,
              status,
              googleAccount.access_token
            )
          },
          { service: 'google_ads', endpoint: 'campaign_update', maxRetries: 2 }
        )
        metrics.googleApiCalls++
        action.success = true
      }

      if (isAdSetTarget) {
        logger.info(`Successfully executed ${campaign.action} on ${campaign.platform} ad set ${campaign.ad_set_id} (campaign ${campaign.campaign_id})`)
      } else {
        logger.info(`Successfully executed ${campaign.action} on ${campaign.platform} campaign ${campaign.campaign_id}`)
      }

    } catch (error: any) {
      action.error_message = error.message
      if (isAdSetTarget) {
        logger.error(`Failed to execute action on ${campaign.platform} ad set ${campaign.ad_set_id} (campaign ${campaign.campaign_id}):`, error)
      } else {
        logger.error(`Failed to execute action on ${campaign.platform} campaign ${campaign.campaign_id}:`, error)
      }
    }

    return action
  }

  /**
   * Calculate retry delay based on error type
   */
  private calculateRetryDelay(error: any, retryCount: number): number {
    // Rate limit errors - use longer delays
    if (error.message?.includes('rate limit') || error.message?.includes('429')) {
      return Math.min(300000, 60000 * Math.pow(2, retryCount)) // Max 5 minutes
    }

    // Network errors - shorter delays
    if (error.message?.includes('network') || error.message?.includes('timeout')) {
      return Math.min(60000, 5000 * Math.pow(2, retryCount)) // Max 1 minute
    }

    // Default exponential backoff
    return Math.min(120000, 10000 * Math.pow(2, retryCount)) // Max 2 minutes
  }

  private async getWeatherData(lat: number, lon: number): Promise<WeatherData> {
    try {
      const response = await axios.get('https://api.openweathermap.org/data/2.5/weather', {
        params: {
          lat,
          lon,
          appid: this.weatherApiKey,
          units: 'metric'
        },
        timeout: 10000
      })

      const data = response.data
      return {
        temperature: data.main.temp,
        humidity: data.main.humidity,
        wind_speed: data.wind?.speed || 0,
        precipitation: data.rain?.['1h'] || data.snow?.['1h'] || 0,
        visibility: data.visibility ? data.visibility / 1000 : 10,
        cloud_cover: data.clouds.all,
        description: data.weather[0].description,
        icon: data.weather[0].icon,
        condition_id: data.weather[0].id
      }
    } catch (error: any) {
      logger.error('Failed to fetch weather data:', error)
      throw new Error(`Weather API error: ${error.message}`)
    }
  }

  private evaluateConditions(conditions: WeatherCondition[], weatherData: WeatherData): boolean {
    if (conditions.length === 0) return false

    // All conditions must be met (AND logic)
    return conditions.every(condition => {
      const weatherValue = weatherData[condition.parameter]
      if (weatherValue === undefined) return false

      switch (condition.operator) {
        case 'greater_than':
          return weatherValue > condition.value
        case 'less_than':
          return weatherValue < condition.value
        case 'equals':
          return Math.abs(weatherValue - condition.value) < 0.1
        case 'between':
          // For between, we need two values: min and max
          // condition.value should be an object with {min, max} or we use a range approach
          const range = (condition as any).range || 5; // Default range if not specified
          const minValue = condition.value - range;
          const maxValue = condition.value + range;
          return weatherValue >= minValue && weatherValue <= maxValue
        default:
          return false
      }
    })
  }

  private evaluateConditionLogic(logic: WeatherConditionLogic, weatherData: WeatherData): boolean {
    if (logic.groups.length === 0) return false

    // Evaluate each group
    const groupResults = logic.groups.map(group => this.evaluateConditionGroup(group, weatherData))

    // Combine groups using global operator
    if (logic.globalOperator === 'AND') {
      return groupResults.every(result => result)
    } else {
      return groupResults.some(result => result)
    }
  }

  private evaluateConditionGroup(group: ConditionGroup, weatherData: WeatherData): boolean {
    if (group.conditions.length === 0) return false

    // Evaluate each condition in the group
    const conditionResults = group.conditions.map(condition => {
      const weatherValue = weatherData[condition.parameter]
      if (weatherValue === undefined) return false

      switch (condition.operator) {
        case 'greater_than':
          return weatherValue > condition.value
        case 'less_than':
          return weatherValue < condition.value
        case 'equals':
          return Math.abs(weatherValue - condition.value) < 0.1
        case 'between':
          // For between, we need two values: min and max
          // condition.value should be an object with {min, max} or we use a range approach
          const range = (condition as any).range || 5; // Default range if not specified
          const minValue = condition.value - range;
          const maxValue = condition.value + range;
          return weatherValue >= minValue && weatherValue <= maxValue
        default:
          return false
      }
    })

    // Combine conditions using group operator
    if (group.operator === 'AND') {
      return conditionResults.every(result => result)
    } else {
      return conditionResults.some(result => result)
    }
  }



  // Database methods using raw SQL
  private async getRuleById(ruleId: string): Promise<any> {
    const result = await query('SELECT * FROM automation_rules WHERE id = $1', [ruleId])
    return result.rows[0] || null
  }

  private async updateLastChecked(ruleId: string): Promise<void> {
    await query('UPDATE automation_rules SET last_checked_at = CURRENT_TIMESTAMP WHERE id = $1', [ruleId])
  }

  private async updateLastExecuted(ruleId: string): Promise<void> {
    await query('UPDATE automation_rules SET last_executed_at = CURRENT_TIMESTAMP WHERE id = $1', [ruleId])
  }

  private async getMetaAccountByUserId(userId: string): Promise<any> {
    const result = await query('SELECT * FROM meta_accounts WHERE user_id = $1', [userId])
    return result.rows[0] || null
  }

  private async getGoogleAccountByUserId(userId: string): Promise<any> {
    const result = await query('SELECT * FROM google_accounts WHERE user_id = $1', [userId])
    return result.rows[0] || null
  }

  private async storeExecutionRecord(execution: any): Promise<void> {
    await query(
      `INSERT INTO automation_executions (
        rule_id, weather_data, conditions_met, actions_taken, 
        success, error_message, execution_metrics
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        execution.rule_id,
        JSON.stringify(execution.weather_data),
        execution.conditions_met,
        JSON.stringify(execution.actions_taken),
        execution.success,
        execution.error_message,
        JSON.stringify(execution.metrics)
      ]
    )
  }

  /**
   * Log engine statistics
   */
  private async logEngineStats(): Promise<void> {
    try {
      const [jobStats, rateLimitStats] = await Promise.all([
        this.jobScheduler.getJobStats(),
        this.rateLimiter.getRateLimitStats()
      ])

      logger.info('Automation engine statistics:', {
        jobs: jobStats,
        rateLimits: rateLimitStats,
        timestamp: new Date().toISOString()
      })
    } catch (error) {
      logger.error('Failed to get engine stats:', error)
    }
  }

  /**
   * Public: get engine statistics for UI
   */
  async getEngineStats(): Promise<{ jobs: any; rateLimits: any; timestamp: string }> {
    const [jobStats, rateLimitStats] = await Promise.all([
      this.jobScheduler.getJobStats(),
      this.rateLimiter.getRateLimitStats()
    ])
    return {
      jobs: jobStats,
      rateLimits: rateLimitStats,
      timestamp: new Date().toISOString()
    }
  }

  /**
   * Schedule rule check
   */
  async scheduleRuleCheck(ruleId: string, userId: string, intervalMinutes: number): Promise<void> {
    await this.jobScheduler.scheduleRuleCheck(ruleId, userId, intervalMinutes)
  }

  /**
   * Remove rule from scheduler
   */
  async removeRule(ruleId: string): Promise<void> {
    await this.jobScheduler.removeJob(`rule_check_${ruleId}`)
  }

  async testRule(ruleId: string): Promise<RuleExecution> {
    const rule = await this.getRuleById(ruleId)
    if (!rule) {
      throw new Error('Rule not found')
    }

    // Get current weather data
    const weatherData = await this.getWeatherData(rule.location.lat, rule.location.lon)

    // Evaluate conditions (use new logic if available, fallback to old conditions)
    const conditionsMet = rule.condition_logic 
      ? this.evaluateConditionLogic(rule.condition_logic, weatherData)
      : this.evaluateConditions(rule.conditions, weatherData)

    // Create test execution (don't actually execute actions)
    const campaigns = rule.campaigns as any[];
    const execution: RuleExecution = {
      id: `test_${Date.now()}`,
      rule_id: rule.id,
      executed_at: new Date(),
      weather_data: weatherData,
      conditions_met: conditionsMet,
      actions_taken: campaigns.map((campaign: any) => ({
        campaign_id: campaign.campaign_id,
        platform: campaign.platform,
        action: campaign.action,
        success: true, // Simulated success
        ...(campaign.target_type === 'ad_set' && campaign.ad_set_id ? { ad_set_id: campaign.ad_set_id, target_type: 'ad_set' } : { target_type: 'campaign' })
      })),
      success: true,
      created_at: new Date()
    }

    return execution
  }
}
