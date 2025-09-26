import { query } from '../config/database';

// Define AutomationRule interface locally to avoid unused import issues
export interface AutomationRule {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  is_active: boolean;
  location: any;
  conditions: any;
  condition_logic?: any;
  campaigns: any;
  check_interval_minutes: number;
  last_checked_at?: Date;
  last_executed_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface CreateAutomationRuleData {
  user_id: string;
  name: string;
  description?: string;
  location: any;
  conditions: any;
  conditionLogic?: any;
  campaigns: any;
  check_interval_minutes: number;
}

export interface UpdateAutomationRuleData {
  name?: string;
  description?: string;
  is_active?: boolean;
  location?: any;
  conditions?: any;
  conditionLogic?: any;
  campaigns?: any;
  check_interval_minutes?: number;
}

export interface RuleExecution {
  id: string;
  rule_id: string;
  executed_at: Date;
  weather_data: any;
  conditions_met: boolean;
  actions_taken: any;
  success: boolean;
  error_message?: string;
  created_at: Date;
}

export class AutomationRuleRepository {
  
  async findByUserId(userId: string): Promise<AutomationRule[]> {
    const result = await query(
      `SELECT * FROM automation_rules WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    )

    return result.rows.map((row: any) => ({
      ...row,
      location: row.location,
      conditions: row.conditions,
      condition_logic: row.condition_logic,
      campaigns: row.campaigns
    }))
  }

  async findById(id: string): Promise<AutomationRule | null> {
    const result = await query(
      `SELECT * FROM automation_rules WHERE id = $1`,
      [id]
    )

    if (result.rows.length === 0) {
      return null
    }

    const row = result.rows[0]
    return {
      ...row,
      location: row.location,
      conditions: row.conditions,
      condition_logic: row.condition_logic,
      campaigns: row.campaigns
    }
  }

  async create(data: CreateAutomationRuleData): Promise<AutomationRule> {
    const result = await query(
      `INSERT INTO automation_rules (
        user_id, name, description, location, conditions, 
        condition_logic, campaigns, check_interval_minutes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [
        data.user_id,
        data.name,
        data.description,
        JSON.stringify(data.location),
        JSON.stringify(data.conditions),
        data.conditionLogic ? JSON.stringify(data.conditionLogic) : null,
        JSON.stringify(data.campaigns),
        data.check_interval_minutes
      ]
    )

    const row = result.rows[0]
    return {
      ...row,
      location: row.location,
      conditions: row.conditions,
      condition_logic: row.condition_logic,
      campaigns: row.campaigns
    }
  }

  async update(id: string, data: UpdateAutomationRuleData): Promise<AutomationRule | null> {
    const fields = []
    const values = []
    let paramCount = 1

    if (data.name !== undefined) {
      fields.push(`name = $${paramCount++}`)
      values.push(data.name)
    }
    if (data.description !== undefined) {
      fields.push(`description = $${paramCount++}`)
      values.push(data.description)
    }
    if (data.is_active !== undefined) {
      fields.push(`is_active = $${paramCount++}`)
      values.push(data.is_active)
    }
    if (data.location !== undefined) {
      fields.push(`location = $${paramCount++}`)
      values.push(JSON.stringify(data.location))
    }
    if (data.conditions !== undefined) {
      fields.push(`conditions = $${paramCount++}`)
      values.push(JSON.stringify(data.conditions))
    }
    if (data.conditionLogic !== undefined) {
      fields.push(`condition_logic = $${paramCount++}`)
      values.push(data.conditionLogic ? JSON.stringify(data.conditionLogic) : null)
    }
    if (data.campaigns !== undefined) {
      fields.push(`campaigns = $${paramCount++}`)
      values.push(JSON.stringify(data.campaigns))
    }
    if (data.check_interval_minutes !== undefined) {
      fields.push(`check_interval_minutes = $${paramCount++}`)
      values.push(data.check_interval_minutes)
    }

    if (fields.length === 0) {
      return null
    }

    values.push(id)
    const result = await query(
      `UPDATE automation_rules 
       SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${paramCount}
       RETURNING *`,
      values
    )

    if (result.rows.length === 0) {
      return null
    }

    const row = result.rows[0]
    return {
      ...row,
      location: row.location,
      conditions: row.conditions,
      condition_logic: row.condition_logic,
      campaigns: row.campaigns
    }
  }

  async delete(id: string): Promise<boolean> {
    const result = await query(
      'DELETE FROM automation_rules WHERE id = $1',
      [id]
    )
    return result.rowCount > 0
  }

  async updateLastChecked(id: string): Promise<void> {
    await query(
      'UPDATE automation_rules SET last_checked_at = CURRENT_TIMESTAMP WHERE id = $1',
      [id]
    )
  }

  async updateLastExecuted(id: string): Promise<void> {
    await query(
      'UPDATE automation_rules SET last_executed_at = CURRENT_TIMESTAMP WHERE id = $1',
      [id]
    )
  }

  async getActiveRules(): Promise<AutomationRule[]> {
    const result = await query(
      'SELECT * FROM automation_rules WHERE is_active = true ORDER BY created_at DESC'
    )

    return result.rows.map((row: any) => ({
      ...row,
      location: row.location,
      conditions: row.conditions,
      condition_logic: row.condition_logic,
      campaigns: row.campaigns
    }))
  }

  async addExecution(ruleId: string, execution: Omit<RuleExecution, 'id'>): Promise<RuleExecution> {
    const result = await query(
      `INSERT INTO automation_executions (
        rule_id, weather_data, conditions_met, actions_taken, success, error_message
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [
        ruleId,
        JSON.stringify(execution.weather_data),
        execution.conditions_met,
        JSON.stringify(execution.actions_taken),
        execution.success,
        execution.error_message
      ]
    )

    const row = result.rows[0]
    return {
      ...row,
      executed_at: row.executed_at || row.created_at,
      weather_data: row.weather_data,
      actions_taken: row.actions_taken
    }
  }

  async getExecutions(ruleId: string, limit: number = 50): Promise<RuleExecution[]> {
    const result = await query(
      `SELECT * FROM automation_executions 
       WHERE rule_id = $1 
       ORDER BY executed_at DESC 
       LIMIT $2`,
      [ruleId, limit]
    )

    return result.rows.map((row: any) => ({
      ...row,
      executed_at: row.executed_at || row.created_at,
      weather_data: row.weather_data,
      actions_taken: row.actions_taken
    }))
  }

  async getTotalExecutionsForUser(userId: string): Promise<number> {
    const result = await query(
      `SELECT COUNT(*) as count 
       FROM automation_executions ae
       JOIN automation_rules ar ON ae.rule_id = ar.id
       WHERE ar.user_id = $1`,
      [userId]
    )
    return parseInt(result.rows[0].count) || 0
  }

  async getRecentExecutionsForUser(userId: string, limit: number = 10, offset: number = 0): Promise<Array<RuleExecution & { rule_name: string }>> {
    const result = await query(
      `SELECT ae.*, ar.name as rule_name
       FROM automation_executions ae
       JOIN automation_rules ar ON ae.rule_id = ar.id
       WHERE ar.user_id = $1
       ORDER BY ae.executed_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    )

    return result.rows.map((row: any) => ({
      ...row,
      executed_at: row.executed_at || row.created_at,
      rule_name: row.rule_name
    }))
  }
}
