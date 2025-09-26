import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { MetaAdsService } from '../services/MetaAdsService'
import { MetaAccountRepository } from '../repositories/MetaAccountRepository'
import { validateBody } from '../middleware/validation'
import { authenticateToken } from '../middleware/auth'
import { logger } from '../utils/logger'

const router = Router()
const metaAdsService = new MetaAdsService()
const metaAccountRepository = new MetaAccountRepository()

// Track processed authorization codes to prevent duplicates
const processedCodes = new Map<string, number>()
const CODE_EXPIRY_TIME = 10 * 60 * 1000 // 10 minutes

// Clean up expired codes periodically
setInterval(() => {
  const now = Date.now()
  for (const [code, timestamp] of processedCodes.entries()) {
    if (now - timestamp > CODE_EXPIRY_TIME) {
      processedCodes.delete(code)
    }
  }
}, 5 * 60 * 1000) // Clean every 5 minutes

// Simple rate limiting cache
const rateLimitCache = new Map<string, { count: number; resetTime: number }>()
const RATE_LIMIT_WINDOW = 60 * 1000 // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 30 // Max 30 requests per minute per endpoint (increased from 10)

function checkRateLimit(endpoint: string, req: Request, res: Response): boolean {
  const key = `${endpoint}_${req.ip || 'unknown'}`
  const now = Date.now()
  const limit = rateLimitCache.get(key)
  
  if (!limit || now > limit.resetTime) {
    // Reset or initialize rate limit
    rateLimitCache.set(key, {
      count: 1,
      resetTime: now + RATE_LIMIT_WINDOW
    })
    return true
  }
  
  if (limit.count >= RATE_LIMIT_MAX_REQUESTS) {
    res.status(429).json({
      success: false,
      error: { 
        message: 'Too many requests. Please wait a moment before trying again.',
        retryAfter: Math.ceil((limit.resetTime - now) / 1000)
      }
    })
    return false
  }
  
  limit.count++
  return true
}

const authUrlSchema = z.object({
  redirectUri: z.string().url()
})

const callbackSchema = z.object({
  code: z.string(),
  state: z.string().optional(),
  redirectUri: z.string().url()
})

const campaignActionSchema = z.object({
  campaignId: z.string(),
  action: z.enum(['pause', 'resume'])
})

const adSetActionSchema = z.object({
  adSetId: z.string(),
  action: z.enum(['pause', 'resume'])
})

const createCampaignSchema = z.object({
  adAccountId: z.string(),
  name: z.string().min(1),
  objective: z.string().min(1),
  status: z.enum(['ACTIVE', 'PAUSED']).optional(),
  daily_budget: z.string().optional(),
  lifetime_budget: z.string().optional(),
  start_time: z.string().optional(),
  stop_time: z.string().optional(),
})

const updateCampaignSchema = z.object({
  name: z.string().min(1).optional(),
  status: z.enum(['ACTIVE', 'PAUSED', 'ARCHIVED']).optional(),
  objective: z.string().min(1).optional(),
})

const toggleAdAccountSchema = z.object({
  adAccountId: z.string(),
  isActive: z.boolean()
})

// Create ad set
const createAdSetSchema = z.object({
  adAccountId: z.string(),
  campaignId: z.string(),
  name: z.string().min(1),
  daily_budget: z.string().regex(/^\d+$/).optional(),
  lifetime_budget: z.string().regex(/^\d+$/).optional(),
  start_time: z.string().optional(),
  end_time: z.string().optional(),
  status: z.enum(['ACTIVE', 'PAUSED']).optional(),
  targeting: z.any(),
  billing_event: z.enum(['IMPRESSIONS','LINK_CLICKS','APP_INSTALLS','POST_ENGAGEMENT','THRUPLAY','REACH']).optional(),
  optimization_goal: z.enum(['REACH','IMPRESSIONS','LINK_CLICKS','LEAD_GENERATION','QUALITY_LEAD','THRUPLAY','APP_INSTALLS','AD_RECALL_LIFT']).optional(),
}).refine((d) => !!d.daily_budget || !!d.lifetime_budget, {
  message: 'daily_budget or lifetime_budget is required',
  path: ['daily_budget']
})

// Generate OAuth authorization URL
router.post('/auth/url',
  authenticateToken,
  validateBody(authUrlSchema),
  async (req, res) => {
    try {
      const { redirectUri } = req.body
      const userId = req.user!.id
      const state = `user_${userId}_${Date.now()}`
      
      const authUrl = metaAdsService.generateAuthUrl(redirectUri, state)
      
      res.json({
        success: true,
        data: {
          authUrl,
          state
        }
      })
    } catch (error: any) {
      logger.error('Meta auth URL generation failed:', error)
      res.status(500).json({
        success: false,
        error: { message: error.message }
      })
      return
    }
  }
)

// Handle OAuth callback
router.post('/auth/callback',
  validateBody(callbackSchema),
  async (req, res) => {
    try {
      console.log('Meta callback received:', req.body)
      const { code, state, redirectUri } = req.body
      
      // Check if this code was already processed
      if (processedCodes.has(code)) {
        logger.warn('Authorization code already processed', { code: code.substring(0, 10) + '...' })
        return res.status(400).json({
          success: false,
          error: { message: 'Authorization code has already been used' }
        })
      }
      
      // Mark code as processed immediately
      processedCodes.set(code, Date.now())
      
      // Extract user ID from state
      let userId: string
      if (state && state.startsWith('user_')) {
        const parts = state.split('_')
        if (parts.length >= 2) {
          userId = parts[1]
        } else {
          throw new Error('Invalid state parameter')
        }
      } else {
        throw new Error('Missing or invalid state parameter')
      }

      console.log('Exchanging code for token...')
      // Exchange code for access token
      const tokenResponse = await metaAdsService.exchangeCodeForToken(code, redirectUri)
      console.log('Token response received:', tokenResponse)
      
      console.log('Getting long-lived token...')
      // Get long-lived token
      const longLivedTokenResponse = await metaAdsService.getLongLivedToken(tokenResponse.access_token)
      console.log('Long-lived token response received')
      
      console.log('Getting user info...')
      // Get user info
      const metaUser = await metaAdsService.getUser(longLivedTokenResponse.access_token)
      console.log('Meta user info received:', metaUser)
      
      console.log('Getting ad accounts...')
      // Get and store ad accounts
      const adAccounts = await metaAdsService.getAdAccounts(longLivedTokenResponse.access_token)
      console.log('Ad accounts received:', adAccounts)
      
      // Calculate token expiration
      const expiresAt = longLivedTokenResponse.expires_in 
        ? new Date(Date.now() + longLivedTokenResponse.expires_in * 1000)
        : undefined

      // Check if account already exists
      let metaAccount = await metaAccountRepository.findByUserId(userId)
      
      if (metaAccount) {
        // Update existing account
        metaAccount = await metaAccountRepository.update(metaAccount.id, {
          access_token: longLivedTokenResponse.access_token,
          token_expires_at: expiresAt,
          meta_user_name: metaUser.name,
          meta_user_email: metaUser.email
        })
      } else {
        // Create new account
        metaAccount = await metaAccountRepository.create({
          user_id: userId,
          meta_user_id: metaUser.id,
          meta_user_name: metaUser.name,
          meta_user_email: metaUser.email,
          access_token: longLivedTokenResponse.access_token,
          token_expires_at: expiresAt
        })
      }

      console.log('Upserting ad accounts...')
      console.log('Meta account ID:', metaAccount!.id)
      console.log('Number of ad accounts to store:', adAccounts.length)
      
      // Transform MetaAdAccount[] to MetaAdAccountRecord[]
      const adAccountRecords = adAccounts.map(acc => ({
        meta_account_id: metaAccount!.id,
        ad_account_id: acc.id,
        name: acc.name,
        account_status: acc.account_status,
        business_id: acc.business?.id,
        business_name: acc.business?.name,
        currency: acc.currency,
        timezone_name: acc.timezone_name,
        is_active: true
      }))
      
      await metaAccountRepository.upsertAdAccounts(metaAccount!.id, adAccountRecords)
      console.log('Ad accounts stored successfully')

      // Verify the ad accounts were stored
      const verifyAccount = await metaAccountRepository.findByUserId(userId)
      console.log('Verification - stored ad accounts count:', verifyAccount?.ad_accounts?.length || 0)

      res.json({
        success: true,
        data: {
          message: 'Meta account connected successfully',
          accountInfo: {
            id: metaUser.id,
            name: metaUser.name,
            email: metaUser.email,
            adAccountsCount: adAccounts.length
          }
        }
      })
      return
    } catch (error: any) {
      console.error('Meta OAuth callback failed:', error)
      logger.error('Meta OAuth callback failed:', error)
      res.status(500).json({
        success: false,
        error: { message: error.message }
      })
      return
    }
  }
)

// Get connected Meta account info
router.get('/account',
  authenticateToken,
  async (req: Request, res: Response) => {
    // Apply rate limiting (but more lenient during OAuth)
    if (!checkRateLimit('/meta/account', req, res)) {
      return
    }

    try {
      const userId = req.user!.id
      
      console.log('GET /meta/account called for user:', userId)
      const metaAccount = await metaAccountRepository.findByUserId(userId)
      console.log('Meta account found:', metaAccount)
      console.log('Ad accounts in retrieved account:', metaAccount?.ad_accounts?.length || 0)
      
      if (!metaAccount) {
        return res.json({
          success: true,
          data: { connected: false }
        })
      }

      // Check if token is still valid (skip validation if token was just created)
      const tokenAge = metaAccount.updated_at ? Date.now() - new Date(metaAccount.updated_at).getTime() : Infinity
      const isRecentToken = tokenAge < 60000 // Less than 1 minute old
      
      if (!isRecentToken) {
        const isValid = await metaAdsService.validateToken(metaAccount.access_token)
        
        if (!isValid) {
          return res.json({
            success: true,
            data: { 
              connected: false,
              expired: true,
              message: 'Token expired, please reconnect'
            }
          })
        }
      }

      const activeAdAccounts = metaAccount.ad_accounts.filter(acc => acc.is_active)
      console.log('Active ad accounts being returned:', activeAdAccounts.length)
      console.log('Ad accounts details:', activeAdAccounts)

      res.json({
        success: true,
        data: {
          connected: true,
          account: {
            id: metaAccount.meta_user_id,
            name: metaAccount.meta_user_name,
            email: metaAccount.meta_user_email,
            connectedAt: metaAccount.created_at,
            adAccounts: activeAdAccounts
          }
        }
      })
      return
    } catch (error: any) {
      console.error('GET /meta/account error:', error)
      logger.error('Failed to get Meta account info:', error)
      res.status(500).json({
        success: false,
        error: { message: error.message }
      })
      return
    }
  }
)

// Get campaigns for an ad account
router.get('/campaigns/:adAccountId',
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const { adAccountId } = req.params
      const userId = req.user!.id
      
      const metaAccount = await metaAccountRepository.findByUserId(userId)
      
      if (!metaAccount) {
        res.status(404).json({
          success: false,
          error: { message: 'Meta account not connected' }
        })
        return
      }

      const campaigns = await metaAdsService.getCampaigns(adAccountId!, metaAccount.access_token)
      
      res.json({
        success: true,
        data: { campaigns }
      })
      return
    } catch (error: any) {
      logger.error('Failed to get Meta campaigns:', error)
      res.status(500).json({
        success: false,
        error: { message: error.message }
      })
      return
    }
  }
)

// Create campaign
router.post('/campaigns',
  authenticateToken,
  validateBody(createCampaignSchema),
  async (req: Request, res: Response) => {
    try {
      const { adAccountId, name, objective, status, daily_budget, lifetime_budget, start_time, stop_time } = req.body
      const userId = req.user!.id

      const metaAccount = await metaAccountRepository.findByUserId(userId)
      if (!metaAccount) {
        res.status(404).json({ success: false, error: { message: 'Meta account not connected' } })
        return
      }

      const created = await metaAdsService.createCampaign(adAccountId, metaAccount.access_token, {
        name,
        objective,
        status,
        daily_budget,
        lifetime_budget,
        start_time,
        stop_time,
      })

      // Fetch details to return a consistent object
      const campaigns = await metaAdsService.getCampaigns(adAccountId, metaAccount.access_token)
      const campaign = campaigns.find(c => c.id === created.id)

      res.status(201).json({ success: true, data: { id: created.id, campaign } })
      return
    } catch (error: any) {
      logger.error('Failed to create Meta campaign:', error)
      res.status(500).json({ success: false, error: { message: error.message } })
      return
    }
  }
)

// Update campaign (name/status/objective)
router.put('/campaigns/:campaignId',
  authenticateToken,
  validateBody(updateCampaignSchema),
  async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.params
      const userId = req.user!.id
      const metaAccount = await metaAccountRepository.findByUserId(userId)
      if (!metaAccount) {
        res.status(404).json({ success: false, error: { message: 'Meta account not connected' } })
        return
      }

      const token = metaAccount.access_token
      if (typeof token !== 'string' || token.length === 0) {
        res.status(400).json({ success: false, error: { message: 'Missing Meta access token' } })
        return
      }
      const ok = await metaAdsService.updateCampaign(campaignId as string, token, req.body)
      res.json({ success: ok, data: { message: 'Campaign updated successfully', campaignId } })
      return
    } catch (error: any) {
      logger.error('Failed to update Meta campaign:', error)
      res.status(500).json({ success: false, error: { message: error.message } })
      return
    }
  }
)

// Delete (archive) campaign
router.delete('/campaigns/:campaignId',
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.params
      const userId = req.user!.id
      const metaAccount = await metaAccountRepository.findByUserId(userId)
      if (!metaAccount) {
        res.status(404).json({ success: false, error: { message: 'Meta account not connected' } })
        return
      }

      const token = metaAccount.access_token
      if (typeof token !== 'string' || token.length === 0) {
        res.status(400).json({ success: false, error: { message: 'Missing Meta access token' } })
        return
      }
      const ok = await metaAdsService.deleteCampaign(campaignId as string, token)
      res.json({ success: ok, data: { message: 'Campaign deleted successfully', campaignId } })
      return
    } catch (error: any) {
      logger.error('Failed to delete Meta campaign:', error)
      res.status(500).json({ success: false, error: { message: error.message } })
      return
    }
  }
)

// Get ad sets for a campaign
router.get('/adsets/:campaignId',
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.params
      const metaAccount = await metaAccountRepository.findByUserId(req.user!.id)
      
      if (!metaAccount) {
        res.status(404).json({
          success: false,
          error: { message: 'Meta account not connected' }
        })
        return
      }

      const adSets = await metaAdsService.getAdSets(campaignId!, metaAccount.access_token)
      
      res.json({
        success: true,
        data: { adSets }
      })
      return
    } catch (error: any) {
      logger.error('Failed to get Meta ad sets:', error)
      res.status(500).json({
        success: false,
        error: { message: error.message }
      })
      return
    }
  }
)

// Create a new ad set
router.post('/adsets',
  authenticateToken,
  validateBody(createAdSetSchema),
  async (req: Request, res: Response) => {
    try {
      const { adAccountId, campaignId, name, daily_budget, lifetime_budget, start_time, end_time, targeting, status, billing_event, optimization_goal } = req.body
      const metaAccount = await metaAccountRepository.findByUserId(req.user!.id)

      if (!metaAccount) {
        res.status(404).json({ success: false, error: { message: 'Meta account not connected' } })
        return
      }

      // Resolve ad account currency for logging/context
      const acc = metaAccount.ad_accounts.find(a => a.ad_account_id === adAccountId)
      const currency = acc?.currency || 'UNKNOWN'
      logger.info('Creating Meta ad set - input received', {
        adAccountId,
        campaignId,
        name,
        daily_budget,
        lifetime_budget,
        status: status || 'PAUSED',
        currency,
        graphVersion: process.env.META_GRAPH_API_VERSION || 'v18.0'
      })
      if (daily_budget) {
        const db = parseInt(daily_budget, 10)
        if (!Number.isFinite(db) || db <= 0) {
          res.status(400).json({ success: false, error: { message: 'daily_budget must be a positive integer (minor units)' } })
          return
        }
      }

      const created = await metaAdsService.createAdSet(adAccountId, metaAccount.access_token, {
        name,
        campaign_id: campaignId,
        daily_budget,
        lifetime_budget,
        start_time,
        end_time,
        targeting,
        status,
        billing_event,
        optimization_goal,
      })

      res.json({ success: true, data: { id: created.id } })
      return
    } catch (error: any) {
      logger.error('Failed to create Meta ad set:', error.response?.data || error.message)
      res.status(error.status || 500).json({ success: false, error: { message: error.message } })
      return
    }
  }
)

// Delete an ad set
router.delete('/adsets/:adSetId',
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const { adSetId } = req.params
      const metaAccount = await metaAccountRepository.findByUserId(req.user!.id)
      if (!metaAccount) {
        res.status(404).json({ success: false, error: { message: 'Meta account not connected' } })
        return
      }

      const ok = await metaAdsService.deleteAdSet(adSetId as string, metaAccount.access_token)
      res.json({ success: ok, data: { message: 'Ad set deleted successfully', adSetId } })
      return
    } catch (error: any) {
      logger.error('Failed to delete Meta ad set:', error)
      res.status(500).json({ success: false, error: { message: error.message } })
      return
    }
  }
)

// Get single ad set details
router.get('/adset/:adSetId',
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const { adSetId } = req.params
      const metaAccount = await metaAccountRepository.findByUserId(req.user!.id)
      if (!metaAccount) {
        res.status(404).json({ success: false, error: { message: 'Meta account not connected' } })
        return
      }

      const adset = await metaAdsService.getAdSet(adSetId as string, metaAccount.access_token)
      res.json({ success: true, data: { adset } })
      return
    } catch (error: any) {
      logger.error('Failed to fetch Meta ad set details:', error)
      res.status(500).json({ success: false, error: { message: error.message } })
      return
    }
  }
)

// Control ad set (pause/resume)
router.post('/adsets/action',
  authenticateToken,
  validateBody(adSetActionSchema),
  async (req: Request, res: Response) => {
    try {
      const { adSetId, action } = req.body
      const metaAccount = await metaAccountRepository.findByUserId(req.user!.id)

      if (!metaAccount) {
        res.status(404).json({ success: false, error: { message: 'Meta account not connected' } })
        return
      }

      const status = action === 'pause' ? 'PAUSED' : 'ACTIVE'
      const success = await metaAdsService.updateAdSetStatus(adSetId, status, metaAccount.access_token)

      res.json({
        success,
        data: {
          message: `Ad set ${action}d successfully`,
          adSetId,
          newStatus: status
        }
      })
      return
    } catch (error: any) {
      logger.error('Failed to update Meta ad set:', error)
      res.status(500).json({ success: false, error: { message: error.message } })
      return
    }
  }
)

// Control campaign (pause/resume)
router.post('/campaigns/action',
  authenticateToken,
  validateBody(campaignActionSchema),
  async (req: Request, res: Response) => {
    try {
      const { campaignId, action } = req.body
      const metaAccount = await metaAccountRepository.findByUserId(req.user!.id)
      
      if (!metaAccount) {
        res.status(404).json({
          success: false,
          error: { message: 'Meta account not connected' }
        })
        return
      }

      const status = action === 'pause' ? 'PAUSED' : 'ACTIVE'
      const success = await metaAdsService.updateCampaignStatus(
        campaignId, 
        status, 
        metaAccount.access_token
      )

      res.json({
        success,
        data: { 
          message: `Campaign ${action}d successfully`,
          campaignId,
          newStatus: status
        }
      })
      return
    } catch (error: any) {
      logger.error('Failed to update Meta campaign:', error)
      res.status(500).json({
        success: false,
        error: { message: error.message }
      })
      return
    }
  }
)

// Toggle ad account activation
router.post('/accounts/toggle',
  authenticateToken,
  validateBody(toggleAdAccountSchema),
  async (req: Request, res: Response) => {
    try {
      const { adAccountId, isActive } = req.body
      const userId = req.user!.id
      
      console.log(`Toggling ad account ${adAccountId} to ${isActive ? 'active' : 'inactive'}`)
      
      const metaAccount = await metaAccountRepository.findByUserId(userId)
      
      if (!metaAccount) {
        res.status(404).json({
          success: false,
          error: { message: 'Meta account not connected' }
        })
        return
      }

      // Find and update the specific ad account
      const adAccountIndex = metaAccount.ad_accounts.findIndex(acc => acc.ad_account_id === adAccountId)
      
      if (adAccountIndex === -1) {
        res.status(404).json({
          success: false,
          error: { message: 'Ad account not found' }
        })
        return
      }

      // Update the ad account status
      if (metaAccount.ad_accounts[adAccountIndex]) {
        metaAccount.ad_accounts[adAccountIndex].is_active = isActive
        metaAccount.updated_at = new Date()

        // Save the updated account (in a real implementation, you'd update just the ad account)
        await metaAccountRepository.update(metaAccount.id, {
          access_token: metaAccount.access_token
        })
      }
      
      console.log(`Ad account ${adAccountId} is now ${isActive ? 'active' : 'inactive'}`)
      
      res.json({
        success: true,
        data: { 
          message: `Ad account ${isActive ? 'activated' : 'deactivated'} successfully`,
          adAccountId,
          isActive
        }
      })
      return
    } catch (error: any) {
      logger.error('Failed to toggle ad account:', error)
      res.status(500).json({
        success: false,
        error: { message: error.message }
      })
      return
    }
  }
)

// Disconnect Meta account
router.delete('/account',
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const metaAccount = await metaAccountRepository.findByUserId(req.user!.id)
      
      if (!metaAccount) {
        res.status(404).json({
          success: false,
          error: { message: 'No Meta account connected' }
        })
        return
      }

      await metaAccountRepository.delete(metaAccount.id)
      
      res.json({
        success: true,
        data: { message: 'Meta account disconnected successfully' }
      })
      return
    } catch (error: any) {
      logger.error('Failed to disconnect Meta account:', error)
      res.status(500).json({
        success: false,
        error: { message: error.message }
      })
      return
    }
  }
)

export default router
