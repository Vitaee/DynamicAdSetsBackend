import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { AutomationRuleRepository } from '../repositories/AutomationRuleRepository'
import { AutomationEngine } from '../services/AutomationEngine'
// import { authenticateToken } from '../middleware/auth' // Temporarily disabled
import { validateBody } from '../middleware/validation'
import { logger } from '../utils/logger'

const router = Router()
const automationRuleRepository = new AutomationRuleRepository()
const automationEngine = new AutomationEngine()

const weatherConditionSchema = z.object({
  parameter: z.enum(['temperature', 'humidity', 'wind_speed', 'precipitation', 'visibility', 'cloud_cover']),
  operator: z.enum(['greater_than', 'less_than', 'equals', 'between']),
  value: z.number(),
  unit: z.string()
})

const conditionGroupSchema = z.object({
  id: z.string(),
  operator: z.enum(['AND', 'OR']),
  conditions: z.array(weatherConditionSchema).min(1)
})

const timeFrameConfigSchema = z.object({
  days: z.number().min(1).max(5),
  action: z.enum(['on', 'off'])
})

const weatherConditionLogicSchema = z.object({
  groups: z.array(conditionGroupSchema).min(1),
  globalOperator: z.enum(['AND', 'OR']),
  timeFrame: timeFrameConfigSchema.optional()
})

// Enforce ad sets only: require ad_set fields and target_type 'ad_set'
const ruleCampaignSchema = z.object({
  platform: z.enum(['meta', 'google']),
  campaign_id: z.string(),
  campaign_name: z.string(),
  ad_account_id: z.string(),
  ad_account_name: z.string(),
  action: z.enum(['pause', 'resume']),
  ad_set_id: z.string({ required_error: 'ad_set_id is required. Select an ad set to control.' }),
  ad_set_name: z.string({ required_error: 'ad_set_name is required.' }),
  target_type: z.literal('ad_set', { invalid_type_error: 'Only ad set targets are allowed.' })
})

const createRuleSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  location: z.object({
    city: z.string(),
    country: z.string(),
    lat: z.number(),
    lon: z.number()
  }),
  conditions: z.array(weatherConditionSchema).min(1),
  conditionLogic: weatherConditionLogicSchema.optional(),
  campaigns: z.array(ruleCampaignSchema).min(1),
  check_interval_minutes: z.number().refine(val => val === 720 || val === 1440, {
    message: "Check interval must be either 720 (12 hours) or 1440 (24 hours)"
  })
})

const updateRuleSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  is_active: z.boolean().optional(),
  location: z.object({
    city: z.string(),
    country: z.string(),
    lat: z.number(),
    lon: z.number()
  }).optional(),
  conditions: z.array(weatherConditionSchema).min(1).optional(),
  conditionLogic: weatherConditionLogicSchema.optional(),
  campaigns: z.array(ruleCampaignSchema).min(1).optional(),
  check_interval_minutes: z.number().refine(val => val === 720 || val === 1440, {
    message: "Check interval must be either 720 (12 hours) or 1440 (24 hours)"
  }).optional()
})

// Get all automation rules for user
router.get('/',
  // authenticateToken, // Temporarily disabled for testing
  async (_req: Request, res: Response) => {
    try {
      const userId = '86366871-1f70-457d-8976-74cf6e22282a' // Your user ID
      console.log('GET /automation - getting rules for user:', userId)
      
      const rules = await automationRuleRepository.findByUserId(userId)
      console.log('Found rules:', rules.length)
      
      res.json({
        success: true,
        data: { rules }
      })
      return
    } catch (error: any) {
      logger.error('Failed to get automation rules:', error)
      res.status(500).json({
        success: false,
        error: { message: error.message }
      })
      return
    }
  }
)

// Get specific automation rule
router.get('/:id',
  // authenticateToken, // Temporarily disabled for testing
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params
      if (!id) {
        res.status(400).json({
          success: false,
          error: { message: 'Rule ID is required' }
        })
        return
      }
      
      console.log('GET /automation/:id - getting rule:', id)
      
      const rule = await automationRuleRepository.findById(id)
      
      if (!rule) {
        res.status(404).json({
          success: false,
          error: { message: 'Automation rule not found' }
        })
        return
      }
      
      res.json({
        success: true,
        data: { rule }
      })
      return
    } catch (error: any) {
      logger.error('Failed to get automation rule:', error)
      res.status(500).json({
        success: false,
        error: { message: error.message }
      })
      return
    }
  }
)

// Create new automation rule
router.post('/',
  // authenticateToken, // Temporarily disabled for testing
  validateBody(createRuleSchema),
  async (req: Request, res: Response) => {
    try {
      const userId = '86366871-1f70-457d-8976-74cf6e22282a' // Your user ID
      console.log('POST /automation - creating rule for user:', userId)
      console.log('Rule data:', req.body)
      
      const rule = await automationRuleRepository.create({
        user_id: userId,
        ...req.body
      })
      
      console.log('Created rule:', rule.id)
      
      res.status(201).json({
        success: true,
        data: { rule }
      })
      return
    } catch (error: any) {
      logger.error('Failed to create automation rule:', error)
      res.status(500).json({
        success: false,
        error: { message: error.message }
      })
      return
    }
  }
)

// Update automation rule
router.put('/:id',
  // authenticateToken, // Temporarily disabled for testing
  validateBody(updateRuleSchema),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params
      if (!id) {
        res.status(400).json({
          success: false,
          error: { message: 'Rule ID is required' }
        })
        return
      }
      
      console.log('PUT /automation/:id - updating rule:', id)
      console.log('Update data:', req.body)
      
      const rule = await automationRuleRepository.update(id, req.body)
      
      if (!rule) {
        res.status(404).json({
          success: false,
          error: { message: 'Automation rule not found' }
        })
        return
      }
      
      console.log('Updated rule:', rule.id)
      
      res.json({
        success: true,
        data: { rule }
      })
      return
    } catch (error: any) {
      logger.error('Failed to update automation rule:', error)
      res.status(500).json({
        success: false,
        error: { message: error.message }
      })
      return
    }
  }
)

// Delete automation rule
router.delete('/:id',
  // authenticateToken, // Temporarily disabled for testing
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params
      if (!id) {
        res.status(400).json({
          success: false,
          error: { message: 'Rule ID is required' }
        })
        return
      }
      
      console.log('DELETE /automation/:id - deleting rule:', id)
      
      const deleted = await automationRuleRepository.delete(id)
      
      if (!deleted) {
        res.status(404).json({
          success: false,
          error: { message: 'Automation rule not found' }
        })
        return
      }
      
      console.log('Deleted rule:', id)
      
      res.json({
        success: true,
        data: { message: 'Automation rule deleted successfully' }
      })
      return
    } catch (error: any) {
      logger.error('Failed to delete automation rule:', error)
      res.status(500).json({
        success: false,
        error: { message: error.message }
      })
      return
    }
  }
)

// Test automation rule
router.post('/:id/test',
  // authenticateToken, // Temporarily disabled for testing
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params
      if (!id) {
        res.status(400).json({
          success: false,
          error: { message: 'Rule ID is required' }
        })
        return
      }
      
      console.log('POST /automation/:id/test - testing rule:', id)
      
      const execution = await automationEngine.testRule(id)
      
      console.log('Test execution result:', execution)
      
      res.json({
        success: true,
        data: { execution }
      })
      return
    } catch (error: any) {
      logger.error('Failed to test automation rule:', error)
      res.status(500).json({
        success: false,
        error: { message: error.message }
      })
      return
    }
  }
)

// Get rule execution history
router.get('/:id/executions',
  // authenticateToken, // Temporarily disabled for testing
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params
      if (!id) {
        res.status(400).json({
          success: false,
          error: { message: 'Rule ID is required' }
        })
        return
      }
      
      const limit = parseInt(req.query.limit as string) || 50
      
      console.log('GET /automation/:id/executions - getting executions for rule:', id)
      
      const executions = await automationRuleRepository.getExecutions(id, limit)
      
      console.log('Found executions:', executions.length)
      
      res.json({
        success: true,
        data: { executions }
      })
      return
    } catch (error: any) {
      logger.error('Failed to get rule executions:', error)
      res.status(500).json({
        success: false,
        error: { message: error.message }
      })
      return
    }
  }
)

export default router
