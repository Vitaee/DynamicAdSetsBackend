import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { GoogleAdsService } from '../services/GoogleAdsService'
import { MockGoogleAccountRepository } from '../repositories/MockGoogleAccountRepository'
// import { authenticateToken } from '../middleware/auth' // Temporarily disabled
import { validateBody } from '../middleware/validation'
import { logger } from '../utils/logger'

const router = Router()
const googleAdsService = new GoogleAdsService()
const googleAccountRepository = new MockGoogleAccountRepository()

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

// Generate OAuth authorization URL
router.post('/auth/url',
  // authenticateToken, // Temporarily disabled for testing
  validateBody(authUrlSchema),
  async (req, res) => {
    try {
      const { redirectUri } = req.body
      const state = `user_86366871-1f70-457d-8976-74cf6e22282a_${Date.now()}`
      
      const authUrl = googleAdsService.generateAuthUrl(redirectUri, state)
      
      res.json({
        success: true,
        data: {
          authUrl,
          state
        }
      })
    } catch (error: any) {
      logger.error('Google auth URL generation failed:', error)
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
  // authenticateToken, // Temporarily disabled for testing
  validateBody(callbackSchema),
  async (req, res) => {
    try {
      console.log('Google callback received:', req.body)
      const { code, redirectUri } = req.body
      const userId = '86366871-1f70-457d-8976-74cf6e22282a' // Temporarily hardcoded for testing

      console.log('Exchanging code for token...')
      // Exchange code for access token
      const tokenResponse = await googleAdsService.exchangeCodeForToken(code, redirectUri)
      console.log('Token response received:', tokenResponse)
      
      console.log('Getting user info...')
      // Get user info
      const googleUser = await googleAdsService.getUser(tokenResponse.access_token)
      console.log('Google user info received:', googleUser)
      
      console.log('Getting ad accounts...')
      // Get and store ad accounts
      const adAccounts = await googleAdsService.getAdAccounts(tokenResponse.access_token)
      console.log('Ad accounts received:', adAccounts)
      
      // Calculate token expiration
      const expiresAt = tokenResponse.expires_in 
        ? new Date(Date.now() + tokenResponse.expires_in * 1000)
        : undefined

      // Check if account already exists
      let googleAccount = await googleAccountRepository.findByUserId(userId)
      
      if (googleAccount) {
        // Update existing account
        googleAccount = await googleAccountRepository.update(googleAccount.id, {
          access_token: tokenResponse.access_token,
          refresh_token: tokenResponse.refresh_token,
          token_expires_at: expiresAt,
          google_user_name: googleUser.name,
          google_user_email: googleUser.email,
          google_user_picture: googleUser.picture
        })
      } else {
        // Create new account
        googleAccount = await googleAccountRepository.create({
          user_id: userId,
          google_user_id: googleUser.id,
          google_user_name: googleUser.name,
          google_user_email: googleUser.email,
          google_user_picture: googleUser.picture,
          access_token: tokenResponse.access_token,
          refresh_token: tokenResponse.refresh_token,
          token_expires_at: expiresAt
        })
      }

      console.log('Upserting ad accounts...')
      console.log('Google account ID:', googleAccount!.id)
      console.log('Number of ad accounts to store:', adAccounts.length)
      await googleAccountRepository.upsertAdAccounts(googleAccount!.id, adAccounts)
      console.log('Ad accounts stored successfully')

      // Verify the ad accounts were stored
      const verifyAccount = await googleAccountRepository.findByUserId(userId)
      console.log('Verification - stored ad accounts count:', verifyAccount?.ad_accounts?.length || 0)

      res.json({
        success: true,
        data: {
          message: 'Google account connected successfully',
          accountInfo: {
            id: googleUser.id,
            name: googleUser.name,
            email: googleUser.email,
            picture: googleUser.picture,
            adAccountsCount: adAccounts.length
          }
        }
      })
    } catch (error: any) {
      console.error('Google OAuth callback failed:', error)
      logger.error('Google OAuth callback failed:', error)
      res.status(500).json({
        success: false,
        error: { message: error.message }
      })
      return
    }
  }
)

// Get connected Google account info
router.get('/account',
  // authenticateToken, // Temporarily disabled for testing
  async (_req: Request, res: Response) => {
    try {
      console.log('GET /google/account called')
      const googleAccount = await googleAccountRepository.findByUserId('86366871-1f70-457d-8976-74cf6e22282a')
      console.log('Google account found:', googleAccount)
      console.log('Ad accounts in retrieved account:', googleAccount?.ad_accounts?.length || 0)
      
      if (!googleAccount) {
        return res.json({
          success: true,
          data: { connected: false }
        })
      }

      // Check if token is still valid
      const isValid = await googleAdsService.validateToken(googleAccount.access_token)
      
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

      const activeAdAccounts = googleAccount.ad_accounts.filter(acc => acc.is_active)
      console.log('Active ad accounts being returned:', activeAdAccounts.length)
      console.log('Ad accounts details:', activeAdAccounts)

      res.json({
        success: true,
        data: {
          connected: true,
          account: {
            id: googleAccount.google_user_id,
            name: googleAccount.google_user_name,
            email: googleAccount.google_user_email,
            picture: googleAccount.google_user_picture,
            connectedAt: googleAccount.created_at,
            adAccounts: activeAdAccounts
          }
        }
      })
      return
    } catch (error: any) {
      console.error('GET /google/account error:', error)
      logger.error('Failed to get Google account info:', error)
      res.status(500).json({
        success: false,
        error: { message: error.message }
      })
      return
    }
  }
)

// Get campaigns for an ad account
router.get('/campaigns/:customerId',
  // authenticateToken, // Temporarily disabled for testing
  async (req: Request, res: Response) => {
    try {
      const { customerId } = req.params
      const googleAccount = await googleAccountRepository.findByUserId('86366871-1f70-457d-8976-74cf6e22282a')
      
      if (!googleAccount) {
        res.status(404).json({
          success: false,
          error: { message: 'Google account not connected' }
        })
        return
      }

      const campaigns = await googleAdsService.getCampaigns(customerId!, googleAccount.access_token)
      
      res.json({
        success: true,
        data: { campaigns }
      })
      return
    } catch (error: any) {
      logger.error('Failed to get Google campaigns:', error)
      res.status(500).json({
        success: false,
        error: { message: error.message }
      })
      return
    }
  }
)

// Control campaign (pause/resume)
router.post('/campaigns/action',
  // authenticateToken, // Temporarily disabled for testing
  validateBody(campaignActionSchema),
  async (req: Request, res: Response) => {
    try {
      const { campaignId, action } = req.body
      const googleAccount = await googleAccountRepository.findByUserId('86366871-1f70-457d-8976-74cf6e22282a')
      
      if (!googleAccount) {
        res.status(404).json({
          success: false,
          error: { message: 'Google account not connected' }
        })
        return
      }

      const status = action === 'pause' ? 'PAUSED' : 'ENABLED'
      const success = await googleAdsService.updateCampaignStatus(
        campaignId, 
        status, 
        googleAccount.access_token
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
      logger.error('Failed to update Google campaign:', error)
      res.status(500).json({
        success: false,
        error: { message: error.message }
      })
      return
    }
  }
)

// Disconnect Google account
router.delete('/account',
  // authenticateToken, // Temporarily disabled for testing
  async (_req: Request, res: Response) => {
    try {
      const googleAccount = await googleAccountRepository.findByUserId('86366871-1f70-457d-8976-74cf6e22282a')
      
      if (!googleAccount) {
        res.status(404).json({
          success: false,
          error: { message: 'No Google account connected' }
        })
        return
      }

      await googleAccountRepository.delete(googleAccount.id)
      
      res.json({
        success: true,
        data: { message: 'Google account disconnected successfully' }
      })
      return
    } catch (error: any) {
      logger.error('Failed to disconnect Google account:', error)
      res.status(500).json({
        success: false,
        error: { message: error.message }
      })
      return
    }
  }
)

export default router