import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AutomationRuleRepository } from '../repositories/AutomationRuleRepository';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { engine } from '../services/engineInstance';

// Validation schemas
const locationSchema = z.object({
  city: z.string().min(1, 'City is required'),
  country: z.string().min(1, 'Country is required'),
  lat: z.number().min(-90).max(90, 'Latitude must be between -90 and 90'),
  lon: z.number().min(-180).max(180, 'Longitude must be between -180 and 180')
});

const weatherConditionSchema = z.object({
  id: z.string().optional(),
  parameter: z.enum(['temperature', 'humidity', 'wind_speed', 'precipitation', 'visibility', 'cloud_cover']),
  operator: z.enum(['greater_than', 'less_than', 'equals', 'between']),
  value: z.number(),
  unit: z.string().min(1, 'Unit is required')
});

const conditionGroupSchema = z.object({
  id: z.string().optional(),
  operator: z.enum(['AND', 'OR']),
  conditions: z.array(weatherConditionSchema)
});

const timeFrameConfigSchema = z.object({
  days: z.number().min(1).max(5, 'Days must be between 1 and 5'),
  action: z.enum(['on', 'off'])
}).optional();

const weatherConditionLogicSchema = z.object({
  groups: z.array(conditionGroupSchema),
  globalOperator: z.enum(['AND', 'OR']),
  timeFrame: timeFrameConfigSchema
}).optional();

// Enforce Ad Sets only for rule targets (guardrail)
const ruleCampaignSchema = z.object({
  id: z.string().optional(),
  platform: z.enum(['meta', 'google']),
  campaign_id: z.string().min(1, 'Campaign ID is required'),
  campaign_name: z.string().min(1, 'Campaign name is required'),
  ad_account_id: z.string().min(1, 'Ad account ID is required'),
  ad_account_name: z.string().min(1, 'Ad account name is required'),
  action: z.enum(['pause', 'resume']),
  ad_set_id: z.string({ required_error: 'Select an ad set to control' }),
  ad_set_name: z.string({ required_error: 'Ad set name is required' }),
  target_type: z.literal('ad_set', { invalid_type_error: 'Only ad set targets are allowed' })
});

const createAutomationRuleSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255, 'Name too long'),
  description: z.string().max(1000, 'Description too long').optional(),
  location: locationSchema,
  conditions: z.array(weatherConditionSchema).min(1, 'At least one condition is required'),
  conditionLogic: weatherConditionLogicSchema,
  campaigns: z.array(ruleCampaignSchema).min(1, 'At least one campaign is required'),
  check_interval_minutes: z.number().min(5, 'Check interval must be at least 5 minutes').max(1440, 'Check interval cannot exceed 24 hours')
});

const updateAutomationRuleSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255, 'Name too long').optional(),
  description: z.string().max(1000, 'Description too long').optional(),
  is_active: z.boolean().optional(),
  location: locationSchema.optional(),
  conditions: z.array(weatherConditionSchema).optional(),
  conditionLogic: weatherConditionLogicSchema,
  campaigns: z.array(ruleCampaignSchema).optional(),
  check_interval_minutes: z.number().min(5, 'Check interval must be at least 5 minutes').max(1440, 'Check interval cannot exceed 24 hours').optional()
});

const paramsSchema = z.object({
  id: z.string().uuid('Invalid rule ID format')
});

const querySchema = z.object({
  limit: z.string().transform(val => parseInt(val)).pipe(z.number().min(1).max(100)).optional(),
  offset: z.string().transform(val => parseInt(val)).pipe(z.number().min(0)).optional()
});

export class AutomationRuleController {
  private static repository = new AutomationRuleRepository();

  static async createRule(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new AppError(401, 'User not authenticated');
      }

      // Validate request body
      const validatedData = createAutomationRuleSchema.parse(req.body);

      // Create the rule
      const rule = await AutomationRuleController.repository.create({
        user_id: req.user.id,
        ...validatedData
      });

      // Schedule the rule for execution if active
      try {
        if (rule.is_active) {
          await engine.scheduleRuleCheck(rule.id, req.user.id, rule.check_interval_minutes)
          logger.info(`Scheduled automation rule ${rule.id} for checks`, { interval: rule.check_interval_minutes })
          // Trigger first run immediately to avoid waiting
          try {
            await engine.runRuleOnce(rule.id)
            logger.info(`Triggered immediate execution for rule ${rule.id} after creation`)
          } catch (runErr: any) {
            logger.warn(`Immediate execution failed for rule ${rule.id} (will run on schedule): ${runErr?.message || runErr}`)
          }
        }
      } catch (scheduleErr) {
        logger.error('Failed to schedule automation rule after creation', scheduleErr)
      }

      logger.info(`Automation rule created: ${rule.id}`, {
        userId: req.user.id,
        ruleName: rule.name
      });

      res.status(201).json({
        success: true,
        message: 'Automation rule created successfully',
        data: { rule }
      });
    } catch (error) {
      next(error);
    }
  }

  static async getRules(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new AppError(401, 'User not authenticated');
      }

      // Validate query parameters
      const { limit, offset } = querySchema.parse(req.query);

      // Get user's automation rules
      let rules = await AutomationRuleController.repository.findByUserId(req.user.id);

      // Apply pagination if provided
      if (offset !== undefined) {
        rules = rules.slice(offset);
      }
      if (limit !== undefined) {
        rules = rules.slice(0, limit);
      }

      res.json({
        success: true,
        data: { 
          rules,
          total: rules.length,
          ...(limit && { limit }),
          ...(offset && { offset })
        }
      });
    } catch (error) {
      next(error);
    }
  }

  static async getRule(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new AppError(401, 'User not authenticated');
      }

      // Validate parameters
      const { id } = paramsSchema.parse(req.params);

      // Find the rule
      const rule = await AutomationRuleController.repository.findById(id);

      if (!rule) {
        throw new AppError(404, 'Automation rule not found');
      }

      // Check if user owns this rule
      if (rule.user_id !== req.user.id) {
        throw new AppError(403, 'Access denied to this automation rule');
      }

      res.json({
        success: true,
        data: { rule }
      });
    } catch (error) {
      next(error);
    }
  }

  static async updateRule(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new AppError(401, 'User not authenticated');
      }

      // Validate parameters and body
      const { id } = paramsSchema.parse(req.params);
      const validatedData = updateAutomationRuleSchema.parse(req.body);

      // Check if rule exists and user owns it
      const existingRule = await AutomationRuleController.repository.findById(id);
      if (!existingRule) {
        throw new AppError(404, 'Automation rule not found');
      }

      if (existingRule.user_id !== req.user.id) {
        throw new AppError(403, 'Access denied to this automation rule');
      }

      // Update the rule
      const updatedRule = await AutomationRuleController.repository.update(id, validatedData);

      if (!updatedRule) {
        throw new AppError(400, 'Failed to update automation rule');
      }

      logger.info(`Automation rule updated: ${id}`, {
        userId: req.user.id,
        changes: Object.keys(validatedData)
      });

      // Reschedule if interval or active flag changed and rule is active
      try {
        if (updatedRule && updatedRule.is_active) {
          await engine.removeRule(id) // remove any existing schedule
          await engine.scheduleRuleCheck(id, req.user.id, updatedRule.check_interval_minutes)
          logger.info(`Rescheduled automation rule ${id}`, { interval: updatedRule.check_interval_minutes })

          // Also trigger an immediate execution so users don't have to wait
          try {
            await engine.runRuleOnce(id)
            logger.info(`Triggered immediate execution for rule ${id} after update`)
          } catch (runErr: any) {
            logger.warn(`Immediate execution failed for rule ${id} (will run on schedule): ${runErr?.message || runErr}`)
          }
        } else {
          await engine.removeRule(id)
          logger.info(`Removed schedule for automation rule ${id} (inactive)`)
        }
      } catch (scheduleErr) {
        logger.error('Failed to reschedule automation rule after update', scheduleErr)
      }

      res.json({
        success: true,
        message: 'Automation rule updated successfully',
        data: { rule: updatedRule }
      });
    } catch (error) {
      next(error);
    }
  }

  static async deleteRule(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new AppError(401, 'User not authenticated');
      }

      // Validate parameters
      const { id } = paramsSchema.parse(req.params);

      // Check if rule exists and user owns it
      const existingRule = await AutomationRuleController.repository.findById(id);
      if (!existingRule) {
        throw new AppError(404, 'Automation rule not found');
      }

      if (existingRule.user_id !== req.user.id) {
        throw new AppError(403, 'Access denied to this automation rule');
      }

      // Delete the rule
      const deleted = await AutomationRuleController.repository.delete(id);

      if (!deleted) {
        throw new AppError(400, 'Failed to delete automation rule');
      }

      logger.info(`Automation rule deleted: ${id}`, {
        userId: req.user.id,
        ruleName: existingRule.name
      });

      res.json({
        success: true,
        message: 'Automation rule deleted successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  static async getRuleExecutions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new AppError(401, 'User not authenticated');
      }

      // Validate parameters
      const { id } = paramsSchema.parse(req.params);
      const { limit } = querySchema.parse(req.query);

      // Check if rule exists and user owns it
      const rule = await AutomationRuleController.repository.findById(id);
      if (!rule) {
        throw new AppError(404, 'Automation rule not found');
      }

      if (rule.user_id !== req.user.id) {
        throw new AppError(403, 'Access denied to this automation rule');
      }

      // Get executions
      const executions = await AutomationRuleController.repository.getExecutions(id, limit || 50);

      res.json({
        success: true,
        data: { 
          executions,
          rule_id: id,
          total: executions.length
        }
      });
    } catch (error) {
      next(error);
    }
  }

  static async toggleRuleStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new AppError(401, 'User not authenticated');
      }

      // Validate parameters
      const { id } = paramsSchema.parse(req.params);

      // Check if rule exists and user owns it
      const existingRule = await AutomationRuleController.repository.findById(id);
      if (!existingRule) {
        throw new AppError(404, 'Automation rule not found');
      }

      if (existingRule.user_id !== req.user.id) {
        throw new AppError(403, 'Access denied to this automation rule');
      }

      // Toggle the status
      const updatedRule = await AutomationRuleController.repository.update(id, {
        is_active: !existingRule.is_active
      });

      if (!updatedRule) {
        throw new AppError(400, 'Failed to toggle automation rule status');
      }

      logger.info(`Automation rule status toggled: ${id}`, {
        userId: req.user.id,
        newStatus: updatedRule.is_active
      });

      res.json({
        success: true,
        message: `Automation rule ${updatedRule.is_active ? 'activated' : 'deactivated'} successfully`,
        data: { rule: updatedRule }
      });

      // Schedule or remove based on new status
      try {
        if (updatedRule.is_active) {
          await engine.scheduleRuleCheck(id, req.user.id, updatedRule.check_interval_minutes)
          logger.info(`Scheduled automation rule ${id} after activation`, { interval: updatedRule.check_interval_minutes })
          try {
            await engine.runRuleOnce(id)
            logger.info(`Triggered immediate execution for rule ${id} on activation`)
          } catch (runErr: any) {
            logger.warn(`Immediate execution failed for rule ${id} (will run on schedule): ${runErr?.message || runErr}`)
          }
        } else {
          await engine.removeRule(id)
          logger.info(`Removed schedule for automation rule ${id} after deactivation`)
        }
      } catch (scheduleErr) {
        logger.error('Failed to adjust schedule after status toggle', scheduleErr)
      }
    } catch (error) {
      next(error);
    }
  }

  static async getUserStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new AppError(401, 'User not authenticated');
      }

      // Get user's rules and execution stats
      const rules = await AutomationRuleController.repository.findByUserId(req.user.id);
      const totalExecutions = await AutomationRuleController.repository.getTotalExecutionsForUser(req.user.id);

      const activeRules = rules.filter(rule => rule.is_active).length;
      const inactiveRules = rules.filter(rule => !rule.is_active).length;

      res.json({
        success: true,
        data: {
          user_id: req.user.id,
          total_rules: rules.length,
          active_rules: activeRules,
          inactive_rules: inactiveRules,
          total_executions: totalExecutions,
          rules_by_platform: {
            meta: rules.filter(rule => rule.campaigns.some((c: any) => c.platform === 'meta')).length,
            google: rules.filter(rule => rule.campaigns.some((c: any) => c.platform === 'google')).length
          }
        }
      });
    } catch (error) {
      next(error);
    }
  }

  static async getRecentExecutions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new AppError(401, 'User not authenticated')
      }

      const limitParam = (req.query.limit as string) || '10'
      const offsetParam = (req.query.offset as string) || '0'
      const limit = Math.max(1, Math.min(50, parseInt(limitParam, 10) || 10))
      const offset = Math.max(0, parseInt(offsetParam, 10) || 0)

      const executions = await AutomationRuleController.repository.getRecentExecutionsForUser(req.user.id, limit, offset)

      res.json({
        success: true,
        data: {
          executions,
          total: executions.length,
          limit,
          offset
        }
      })
    } catch (error) {
      next(error)
    }
  }

  static async getEngineStats(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const stats = await engine.getEngineStats()
      // attach workers
      const { workerStatsHooks } = await import('../services/engineInstance')
      const workers = await workerStatsHooks.getWorkers()
      res.json({ success: true, data: { ...stats, workers } })
    } catch (error) {
      next(error)
    }
  }
}
