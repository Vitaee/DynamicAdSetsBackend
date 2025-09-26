export interface AutomationRule {
  id: string
  user_id: string
  name: string
  description?: string
  is_active: boolean
  
  // Location
  location: {
    city: string
    country: string
    lat: number
    lon: number
  }
  
  // Weather conditions (backward compatibility)
  conditions: WeatherCondition[]
  
  // Advanced logic support (optional, overrides conditions if present)
  conditionLogic?: WeatherConditionLogic
  
  // Campaigns to control
  campaigns: RuleCampaign[]
  
  // Execution settings
  check_interval_minutes: number
  last_checked_at?: Date
  last_executed_at?: Date
  
  created_at: Date
  updated_at: Date
}

export interface WeatherCondition {
  id: string
  parameter: WeatherParameter
  operator: WeatherOperator
  value: number
  unit: string
}

export interface ConditionGroup {
  id: string
  operator: 'AND' | 'OR'
  conditions: WeatherCondition[]
}

export interface WeatherConditionLogic {
  groups: ConditionGroup[]
  globalOperator: 'AND' | 'OR' // How groups are combined
  timeFrame?: TimeFrameConfig // Optional time frame configuration
}

export interface TimeFrameConfig {
  days: number // Number of days to check forecast (1-5)
  action: 'on' | 'off' // Whether to turn ads on or off when conditions match
}

export interface RuleCampaign {
  id: string
  platform: 'meta' | 'google'
  campaign_id: string
  campaign_name: string
  ad_account_id: string
  ad_account_name: string
  action: CampaignAction
}

export type WeatherParameter = 
  | 'temperature'
  | 'humidity' 
  | 'wind_speed'
  | 'precipitation'
  | 'visibility'
  | 'cloud_cover'

export type WeatherOperator = 
  | 'greater_than'
  | 'less_than'
  | 'equals'
  | 'between'

export type CampaignAction = 
  | 'pause'
  | 'resume'

export interface CreateAutomationRuleData {
  user_id: string
  name: string
  description?: string
  location: AutomationRule['location']
  conditions: WeatherCondition[]
  conditionLogic?: WeatherConditionLogic
  campaigns: RuleCampaign[]
  check_interval_minutes: number
}

export interface UpdateAutomationRuleData {
  name?: string
  description?: string
  is_active?: boolean
  location?: AutomationRule['location']
  conditions?: WeatherCondition[]
  conditionLogic?: WeatherConditionLogic
  campaigns?: RuleCampaign[]
  check_interval_minutes?: number
}

export interface RuleExecution {
  id: string
  rule_id: string
  executed_at: Date
  weather_data: any
  conditions_met: boolean
  actions_taken: RuleAction[]
  success: boolean
  error_message?: string
}

export interface RuleAction {
  campaign_id: string
  platform: 'meta' | 'google'
  action: CampaignAction
  success: boolean
  error_message?: string
  // Optional: when targeting specific ad sets instead of entire campaign
  ad_set_id?: string
  target_type?: 'campaign' | 'ad_set'
}
