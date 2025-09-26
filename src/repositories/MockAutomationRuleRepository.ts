import { AutomationRule, CreateAutomationRuleData, UpdateAutomationRuleData, RuleExecution } from '../models/AutomationRule'
import { logger } from '../utils/logger'

// Simple in-memory storage for testing
const automationRules: Map<string, AutomationRule> = new Map()
const ruleExecutions: Map<string, RuleExecution[]> = new Map()

export class MockAutomationRuleRepository {
  async findByUserId(userId: string): Promise<AutomationRule[]> {
    try {
      const userRules: AutomationRule[] = []
      for (const rule of automationRules.values()) {
        if (rule.user_id === userId) {
          userRules.push(rule)
        }
      }
      return userRules.sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
    } catch (error) {
      logger.error('Error finding automation rules by user ID:', error)
      throw new Error('Failed to find automation rules')
    }
  }

  async findById(id: string): Promise<AutomationRule | null> {
    try {
      return automationRules.get(id) || null
    } catch (error) {
      logger.error('Error finding automation rule by ID:', error)
      throw new Error('Failed to find automation rule')
    }
  }

  async create(data: CreateAutomationRuleData): Promise<AutomationRule> {
    try {
      const rule: AutomationRule = {
        id: `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        user_id: data.user_id,
        name: data.name,
        description: data.description,
        is_active: true,
        location: data.location,
        conditions: data.conditions.map(condition => ({
          ...condition,
          id: `condition_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        })),
        campaigns: data.campaigns.map(campaign => ({
          ...campaign,
          id: `campaign_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        })),
        check_interval_minutes: data.check_interval_minutes,
        created_at: new Date(),
        updated_at: new Date()
      }

      automationRules.set(rule.id, rule)
      return rule
    } catch (error) {
      logger.error('Error creating automation rule:', error)
      throw new Error('Failed to create automation rule')
    }
  }

  async update(id: string, data: UpdateAutomationRuleData): Promise<AutomationRule | null> {
    try {
      const rule = automationRules.get(id)
      if (!rule) {
        return null
      }

      const updatedRule: AutomationRule = {
        ...rule,
        name: data.name ?? rule.name,
        description: data.description ?? rule.description,
        is_active: data.is_active ?? rule.is_active,
        location: data.location ?? rule.location,
        conditions: data.conditions ? data.conditions.map(condition => ({
          ...condition,
          id: condition.id || `condition_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        })) : rule.conditions,
        campaigns: data.campaigns ? data.campaigns.map(campaign => ({
          ...campaign,
          id: campaign.id || `campaign_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        })) : rule.campaigns,
        check_interval_minutes: data.check_interval_minutes ?? rule.check_interval_minutes,
        updated_at: new Date()
      }

      automationRules.set(id, updatedRule)
      return updatedRule
    } catch (error) {
      logger.error('Error updating automation rule:', error)
      throw new Error('Failed to update automation rule')
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      const deleted = automationRules.delete(id)
      // Also delete associated executions
      ruleExecutions.delete(id)
      return deleted
    } catch (error) {
      logger.error('Error deleting automation rule:', error)
      throw new Error('Failed to delete automation rule')
    }
  }

  async updateLastChecked(id: string): Promise<void> {
    try {
      const rule = automationRules.get(id)
      if (rule) {
        rule.last_checked_at = new Date()
        automationRules.set(id, rule)
      }
    } catch (error) {
      logger.error('Error updating last checked time:', error)
      throw new Error('Failed to update last checked time')
    }
  }

  async updateLastExecuted(id: string): Promise<void> {
    try {
      const rule = automationRules.get(id)
      if (rule) {
        rule.last_executed_at = new Date()
        automationRules.set(id, rule)
      }
    } catch (error) {
      logger.error('Error updating last executed time:', error)
      throw new Error('Failed to update last executed time')
    }
  }

  async getActiveRules(): Promise<AutomationRule[]> {
    try {
      const activeRules: AutomationRule[] = []
      for (const rule of automationRules.values()) {
        if (rule.is_active) {
          activeRules.push(rule)
        }
      }
      return activeRules
    } catch (error) {
      logger.error('Error getting active rules:', error)
      throw new Error('Failed to get active rules')
    }
  }

  async addExecution(ruleId: string, execution: Omit<RuleExecution, 'id'>): Promise<RuleExecution> {
    try {
      const fullExecution: RuleExecution = {
        ...execution,
        id: `execution_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      }

      const executions = ruleExecutions.get(ruleId) || []
      executions.unshift(fullExecution) // Add to beginning for latest first
      
      // Keep only last 100 executions per rule
      if (executions.length > 100) {
        executions.splice(100)
      }
      
      ruleExecutions.set(ruleId, executions)
      return fullExecution
    } catch (error) {
      logger.error('Error adding rule execution:', error)
      throw new Error('Failed to add rule execution')
    }
  }

  async getExecutions(ruleId: string, limit: number = 50): Promise<RuleExecution[]> {
    try {
      const executions = ruleExecutions.get(ruleId) || []
      return executions.slice(0, limit)
    } catch (error) {
      logger.error('Error getting rule executions:', error)
      throw new Error('Failed to get rule executions')
    }
  }
}