import { Router } from 'express';
import { AutomationRuleController } from '../controllers/AutomationRuleController';
import { authenticateToken } from '../middleware/auth';

const router = Router();

// All automation rule routes require authentication
router.use(authenticateToken);

// GET /api/automation-rules - Get user's automation rules
router.get('/', AutomationRuleController.getRules);

// POST /api/automation-rules - Create new automation rule
router.post('/', AutomationRuleController.createRule);

// GET /api/automation-rules/stats - Get user's automation statistics
router.get('/stats', AutomationRuleController.getUserStats);

// GET /api/automation-rules/executions/recent - Get user's recent executions
router.get('/executions/recent', AutomationRuleController.getRecentExecutions);

// GET /api/automation-rules/engine/stats - Engine/job/ratelimit stats
router.get('/engine/stats', AutomationRuleController.getEngineStats);

// GET /api/automation-rules/:id - Get specific automation rule
router.get('/:id', AutomationRuleController.getRule);

// PUT /api/automation-rules/:id - Update automation rule
router.put('/:id', AutomationRuleController.updateRule);

// DELETE /api/automation-rules/:id - Delete automation rule
router.delete('/:id', AutomationRuleController.deleteRule);

// POST /api/automation-rules/:id/toggle - Toggle rule active status
router.post('/:id/toggle', AutomationRuleController.toggleRuleStatus);

// GET /api/automation-rules/:id/executions - Get rule execution history
router.get('/:id/executions', AutomationRuleController.getRuleExecutions);

export { router as automationRulesRouter };
