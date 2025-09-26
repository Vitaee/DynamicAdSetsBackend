import axios from 'axios'
import { logger } from '../utils/logger'

export interface MetaUser {
  id: string
  name: string
  email?: string
}

export interface MetaAdAccount {
  id: string
  name: string
  account_status: number
  business?: {
    id: string
    name: string
  }
  currency: string
  timezone_name: string
}

export interface MetaCampaign {
  id: string
  name: string
  status: string
  objective: string
  daily_budget?: string
  lifetime_budget?: string
  start_time?: string
  stop_time?: string
  created_time: string
  updated_time: string
}

export interface MetaAdSet {
  id: string
  name: string
  status: string
  campaign_id: string
  daily_budget?: string
  lifetime_budget?: string
  start_time?: string
  end_time?: string
  targeting?: any
  created_time: string
  updated_time: string
}

interface MetaOAuthTokenResponse {
  access_token: string
  token_type: string
  expires_in?: number
}

export class MetaAdsService {
  private clientId: string
  private clientSecret: string
  private baseUrl = `https://graph.facebook.com/${process.env.META_GRAPH_API_VERSION || 'v18.0'}`
  private tokenValidationCache = new Map<string, { valid: boolean; timestamp: number }>()
  private readonly VALIDATION_CACHE_TTL = 5 * 60 * 1000 // 5 minutes
  
  private async makeApiRequest(url: string, params: any, retries = 3): Promise<any> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        logger.info(`Making Meta API request to ${url} (attempt ${attempt}/${retries})`)
        const response = await axios.get(url, { params })
        logger.info(`Meta API request successful for ${url}`)
        return response
      } catch (error: any) {
        if (error.response?.status === 429) {
          // Rate limited, wait before retry
          const waitTime = Math.min(1000 * Math.pow(2, attempt), 10000) // Max 10 seconds
          logger.warn(`Meta API rate limited for ${url}, waiting ${waitTime}ms before retry ${attempt}/${retries}`)
          logger.warn(`Rate limit headers:`, error.response?.headers)
          
          if (attempt < retries) {
            await new Promise(resolve => setTimeout(resolve, waitTime))
            continue
          }
        }
        logger.error(`Meta API request failed for ${url}:`, error.response?.status, error.response?.statusText)
        throw error
      }
    }
  }

  constructor() {
    this.clientId = process.env.META_APP_ID!
    this.clientSecret = process.env.META_APP_SECRET!
    
    if (!this.clientId || !this.clientSecret) {
      throw new Error('META_APP_ID and META_APP_SECRET environment variables are required')
    }
  }

  generateAuthUrl(redirectUri: string, state?: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      scope: 'ads_management,ads_read,business_management',
      response_type: 'code',
      display: 'popup',
      auth_type: 'rerequest',
      ...(state && { state })
    })

    const version = process.env.META_GRAPH_API_VERSION || 'v18.0'
    return `https://www.facebook.com/${version}/dialog/oauth?${params.toString()}`
  }

  async exchangeCodeForToken(code: string, redirectUri: string): Promise<MetaOAuthTokenResponse> {
    try {
      logger.info('Exchanging Meta OAuth code for token', { code: code.substring(0, 10) + '...', redirectUri })
      const response = await axios.get(`${this.baseUrl}/oauth/access_token`, {
        params: {
          client_id: this.clientId,
          client_secret: this.clientSecret,
          code,
          redirect_uri: redirectUri
        }
      })

      logger.info('Meta token exchange successful')
      return response.data
    } catch (error: any) {
      logger.error('Meta OAuth token exchange failed:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message
      })
      throw new Error('Failed to exchange authorization code for access token')
    }
  }

  async getLongLivedToken(shortLivedToken: string): Promise<MetaOAuthTokenResponse> {
    try {
      const response = await axios.get(`${this.baseUrl}/oauth/access_token`, {
        params: {
          grant_type: 'fb_exchange_token',
          client_id: this.clientId,
          client_secret: this.clientSecret,
          fb_exchange_token: shortLivedToken
        }
      })

      return response.data
    } catch (error: any) {
      logger.error('Meta long-lived token exchange failed:', error.response?.data || error.message)
      throw new Error('Failed to get long-lived access token')
    }
  }

  async getUser(accessToken: string): Promise<MetaUser> {
    try {
      const response = await axios.get(`${this.baseUrl}/me`, {
        params: {
          fields: 'id,name,email',
          access_token: accessToken
        }
      })

      return response.data
    } catch (error: any) {
      logger.error('Failed to get Meta user info:', error.response?.data || error.message)
      throw new Error('Failed to get user information')
    }
  }

  async getAdAccounts(accessToken: string): Promise<MetaAdAccount[]> {
    try {
      logger.info('Fetching Meta ad accounts')
      const response = await axios.get(`${this.baseUrl}/me/adaccounts`, {
        params: {
          fields: 'id,name,account_status,business,currency,timezone_name',
          access_token: accessToken
        }
      })

      logger.info('Meta ad accounts fetched successfully', { count: response.data.data?.length || 0 })
      return response.data.data || []
    } catch (error: any) {
      logger.error('Failed to get Meta ad accounts:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message
      })
      throw new Error('Failed to get ad accounts')
    }
  }

  async getCampaigns(adAccountId: string, accessToken: string): Promise<MetaCampaign[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/${adAccountId}/campaigns`, {
        params: {
          fields: 'id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time,created_time,updated_time',
          access_token: accessToken
        }
      })

      return response.data.data || []
    } catch (error: any) {
      logger.error('Failed to get Meta campaigns:', error.response?.data || error.message)
      throw new Error('Failed to get campaigns')
    }
  }

  async createCampaign(
    adAccountId: string,
    accessToken: string,
    data: { name: string; objective: string; status?: 'ACTIVE' | 'PAUSED'; daily_budget?: string; lifetime_budget?: string; start_time?: string; stop_time?: string }
  ): Promise<{ id: string }> {
    try {
      const objectiveMap: Record<string, string> = {
        'REACH': 'OUTCOME_AWARENESS',
        'AWARENESS': 'OUTCOME_AWARENESS',
        'OUTCOME_AWARENESS': 'OUTCOME_AWARENESS',
        'TRAFFIC': 'OUTCOME_TRAFFIC',
        'OUTCOME_TRAFFIC': 'OUTCOME_TRAFFIC',
        'ENGAGEMENT': 'OUTCOME_ENGAGEMENT',
        'OUTCOME_ENGAGEMENT': 'OUTCOME_ENGAGEMENT',
        'LEAD_GENERATION': 'OUTCOME_LEADS',
        'LEADS': 'OUTCOME_LEADS',
        'OUTCOME_LEADS': 'OUTCOME_LEADS',
        'SALES': 'OUTCOME_SALES',
        'OUTCOME_SALES': 'OUTCOME_SALES',
        'APP_PROMOTION': 'OUTCOME_APP_PROMOTION',
        'OUTCOME_APP_PROMOTION': 'OUTCOME_APP_PROMOTION',
      }
      const normalizedObjective = objectiveMap[(data.objective || '').toUpperCase()] || data.objective

      const payload: any = {
        name: data.name,
        objective: normalizedObjective,
        status: data.status || 'PAUSED',
        special_ad_categories: ['NONE'],
        access_token: accessToken,
      }

      if (data.daily_budget) payload.daily_budget = data.daily_budget
      if (data.lifetime_budget) payload.lifetime_budget = data.lifetime_budget
      if (data.start_time) payload.start_time = data.start_time
      if (data.stop_time) payload.stop_time = data.stop_time

      const response = await axios.post(`${this.baseUrl}/${adAccountId}/campaigns`, payload)
      return { id: response.data.id }
    } catch (error: any) {
      logger.error('Failed to create Meta campaign:', error.response?.data || error.message)
      throw new Error('Failed to create campaign')
    }
  }

  async updateCampaign(
    campaignId: string,
    accessToken: string,
    data: Partial<{ name: string; status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED'; objective: string }>
  ): Promise<boolean> {
    try {
      const payload: any = { access_token: accessToken }
      if (data.name !== undefined) payload.name = data.name
      if (data.status !== undefined) payload.status = data.status
      if (data.objective !== undefined) {
        const objectiveMap: Record<string, string> = {
          'REACH': 'OUTCOME_AWARENESS',
          'AWARENESS': 'OUTCOME_AWARENESS',
          'OUTCOME_AWARENESS': 'OUTCOME_AWARENESS',
          'TRAFFIC': 'OUTCOME_TRAFFIC',
          'OUTCOME_TRAFFIC': 'OUTCOME_TRAFFIC',
          'ENGAGEMENT': 'OUTCOME_ENGAGEMENT',
          'OUTCOME_ENGAGEMENT': 'OUTCOME_ENGAGEMENT',
          'LEAD_GENERATION': 'OUTCOME_LEADS',
          'LEADS': 'OUTCOME_LEADS',
          'OUTCOME_LEADS': 'OUTCOME_LEADS',
          'SALES': 'OUTCOME_SALES',
          'OUTCOME_SALES': 'OUTCOME_SALES',
          'APP_PROMOTION': 'OUTCOME_APP_PROMOTION',
          'OUTCOME_APP_PROMOTION': 'OUTCOME_APP_PROMOTION',
        }
        payload.objective = objectiveMap[(data.objective || '').toUpperCase()] || data.objective
      }

      const response = await axios.post(`${this.baseUrl}/${campaignId}`, payload)
      return response.data.success === true
    } catch (error: any) {
      logger.error('Failed to update Meta campaign:', error.response?.data || error.message)
      throw new Error('Failed to update campaign')
    }
  }

  async deleteCampaign(campaignId: string, accessToken: string): Promise<boolean> {
    try {
      const response = await axios.delete(`${this.baseUrl}/${campaignId}`, {
        params: { access_token: accessToken }
      })
      return response.data.success === true
    } catch (error: any) {
      logger.error('Failed to delete Meta campaign:', error.response?.data || error.message)
      throw new Error('Failed to delete campaign')
    }
  }

  async getAdSets(campaignId: string, accessToken: string): Promise<MetaAdSet[]> {
    try {
      const response = await this.makeApiRequest(`${this.baseUrl}/${campaignId}/adsets`, {
        fields: 'id,name,status,campaign_id,daily_budget,lifetime_budget,start_time,end_time,targeting,created_time,updated_time',
        access_token: accessToken
      })

      return response.data.data || []
    } catch (error: any) {
      logger.error('Failed to get Meta ad sets:', error.response?.data || error.message)
      throw new Error('Failed to get ad sets')
    }
  }

  async createAdSet(
    adAccountId: string,
    accessToken: string,
    data: { 
      name: string; 
      campaign_id: string; 
      daily_budget?: string; 
      lifetime_budget?: string; 
      start_time?: string; 
      end_time?: string; 
      targeting: any; 
      status?: 'ACTIVE' | 'PAUSED';
      billing_event?: 'IMPRESSIONS' | 'LINK_CLICKS' | 'APP_INSTALLS' | 'POST_ENGAGEMENT' | 'THRUPLAY' | 'REACH';
      optimization_goal?: 'REACH' | 'IMPRESSIONS' | 'LINK_CLICKS' | 'LEAD_GENERATION' | 'QUALITY_LEAD' | 'THRUPLAY' | 'APP_INSTALLS' | 'AD_RECALL_LIFT';
    }
  ): Promise<{ id: string }> {
    try {
      const payload: any = {
        name: data.name,
        campaign_id: data.campaign_id,
        access_token: accessToken,
        status: data.status || 'PAUSED',
        targeting: data.targeting,
      }
      // Defaults required by Meta Marketing API
      payload.billing_event = data.billing_event || 'IMPRESSIONS'
      payload.optimization_goal = data.optimization_goal || 'REACH'
      // Avoid bid amount requirement by using lowest cost without cap unless explicitly provided
      if (!('bid_strategy' in payload)) {
        payload.bid_strategy = 'LOWEST_COST_WITHOUT_CAP'
      }
      if (data.daily_budget) payload.daily_budget = data.daily_budget
      if (data.lifetime_budget) payload.lifetime_budget = data.lifetime_budget
      if (data.start_time) payload.start_time = data.start_time
      if (data.end_time) payload.end_time = data.end_time

      // Log sanitized payload and endpoint
      const { access_token, ...logPayload } = payload
      logger.info('Meta ad set create - request', { url: `${this.baseUrl}/${adAccountId}/adsets`, payload: logPayload })

      const response = await axios.post(`${this.baseUrl}/${adAccountId}/adsets`, payload)
      logger.info('Meta ad set create - success', { id: response.data?.id })
      return { id: response.data.id }
    } catch (error: any) {
      logger.error('Failed to create Meta ad set:', error.response?.data || error.message)
      const userMsg = error.response?.data?.error_user_msg || error.response?.data?.error?.message || 'Failed to create ad set'
      const err = new Error(userMsg)
      ;(err as any).status = error.response?.status
      throw err
    }
  }

  async deleteAdSet(adSetId: string, accessToken: string): Promise<boolean> {
    try {
      const response = await axios.delete(`${this.baseUrl}/${adSetId}`, {
        params: { access_token: accessToken }
      })
      return response.data.success === true
    } catch (error: any) {
      logger.error('Failed to delete Meta ad set:', error.response?.data || error.message)
      throw new Error('Failed to delete ad set')
    }
  }

  async getAdSet(adSetId: string, accessToken: string): Promise<{ id: string; name: string; status?: string; campaign?: { id: string; name: string } }> {
    try {
      const response = await this.makeApiRequest(`${this.baseUrl}/${adSetId}`, {
        fields: 'id,name,status,campaign{id,name}',
        access_token: accessToken,
      })
      const d = response.data
      return { id: d.id, name: d.name, status: d.status, campaign: d.campaign }
    } catch (error: any) {
      logger.error('Failed to get Meta ad set details:', error.response?.data || error.message)
      throw new Error('Failed to get ad set details')
    }
  }

  async updateAdSetStatus(adSetId: string, status: 'ACTIVE' | 'PAUSED', accessToken: string): Promise<boolean> {
    try {
      const response = await axios.post(`${this.baseUrl}/${adSetId}`, {
        status,
        access_token: accessToken
      })
      return response.data.success === true
    } catch (error: any) {
      logger.error('Failed to update Meta ad set status:', error.response?.data || error.message)
      throw new Error(`Failed to ${status.toLowerCase()} ad set`)
    }
  }

  async updateCampaignStatus(campaignId: string, status: 'ACTIVE' | 'PAUSED', accessToken: string): Promise<boolean> {
    try {
      const response = await axios.post(`${this.baseUrl}/${campaignId}`, {
        status,
        access_token: accessToken
      })

      return response.data.success === true
    } catch (error: any) {
      logger.error('Failed to update Meta campaign status:', error.response?.data || error.message)
      throw new Error(`Failed to ${status.toLowerCase()} campaign`)
    }
  }

  async validateToken(accessToken: string): Promise<boolean> {
    // Check cache first
    const cached = this.tokenValidationCache.get(accessToken)
    const now = Date.now()
    
    if (cached && (now - cached.timestamp) < this.VALIDATION_CACHE_TTL) {
      logger.info('Using cached token validation result')
      return cached.valid
    }

    try {
      logger.info('Validating Meta token with API call')
      const response = await this.makeApiRequest(`${this.baseUrl}/me`, {
        access_token: accessToken
      })

      const isValid = !!response.data.id
      
      // Cache the result
      this.tokenValidationCache.set(accessToken, {
        valid: isValid,
        timestamp: now
      })
      
      // Clean up old cache entries
      this.cleanupTokenCache()

      return isValid
    } catch (error: any) {
      logger.warn('Token validation failed:', error.response?.status, error.response?.statusText)
      
      // Cache negative result for a shorter time (1 minute)
      this.tokenValidationCache.set(accessToken, {
        valid: false,
        timestamp: now
      })
      
      return false
    }
  }

  private cleanupTokenCache() {
    const now = Date.now()
    const entries = Array.from(this.tokenValidationCache.entries())
    for (const [token, cache] of entries) {
      if ((now - cache.timestamp) > this.VALIDATION_CACHE_TTL) {
        this.tokenValidationCache.delete(token)
      }
    }
  }
}
