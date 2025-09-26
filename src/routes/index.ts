import { Router } from 'express';
import authRoutes from './auth.routes';
import campaignRoutes from './campaign.routes';
import weatherRoutes from './weather';
import automationRoutes from './automation';
import { automationRulesRouter } from './automationRules';
import metaRoutes from './meta';
import googleRoutes from './google';

const router = Router();

router.use('/auth', authRoutes);
router.use('/campaigns', campaignRoutes);
router.use('/weather', weatherRoutes);
router.use('/automation', automationRoutes);
router.use('/automation-rules', automationRulesRouter);
router.use('/meta', metaRoutes);
router.use('/google', googleRoutes);

export default router;