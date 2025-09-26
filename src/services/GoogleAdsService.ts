import axios from 'axios'
import { google } from 'googleapis'
import { logger } from '../utils/logger'

export interface GoogleUser {
  id: string
  email: string
  name?: string
  picture?: string
}

export interface GoogleAdsAccount {
  id: string
  name: string
  currency_code: string
  timezone: string
  status: string
  customer_id: string
}

export interface GoogleCampaign {
  id: string
  name: string
  status: string
  advertising_channel_type: string
  campaign_budget: {
    amount_micros: string
    period?: string
  }
  start_date?: string
  end_date?: string
}

export class GoogleAdsService {
  private clientId: string
  private clientSecret: string
  private developerToken: string
  private oauth2Client: any

  constructor() {
    this.clientId = process.env.GOOGLE_CLIENT_ID!
    this.clientSecret = process.env.GOOGLE_CLIENT_SECRET!
    this.developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN!
    
    if (!this.clientId || !this.clientSecret || !this.developerToken) {
      throw new Error('GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_ADS_DEVELOPER_TOKEN environment variables are required')
    }

    this.oauth2Client = new google.auth.OAuth2(
      this.clientId,
      this.clientSecret
    )
  }

  generateAuthUrl(redirectUri: string, state?: string): string {
    const scopes = [
      'https://www.googleapis.com/auth/adwords',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile'
    ]

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      redirect_uri: redirectUri,
      prompt: 'consent',
      state
    })
  }

  async exchangeCodeForToken(code: string, redirectUri: string): Promise<any> {
    try {
      const { tokens } = await this.oauth2Client.getToken({
        code,
        redirect_uri: redirectUri
      })

      this.oauth2Client.setCredentials(tokens)
      return tokens
    } catch (error: any) {
      logger.error('Google OAuth token exchange failed:', error)
      throw new Error('Failed to exchange authorization code for access token')
    }
  }

  async getUser(accessToken: string): Promise<GoogleUser> {
    try {
      const response = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      })

      return response.data
    } catch (error: any) {
      logger.error('Failed to get Google user info:', error)
      throw new Error('Failed to get user information')
    }
  }

  async getAdAccounts(_accessToken: string): Promise<GoogleAdsAccount[]> {
    try {
      // For now, return mock data since Google Ads API requires additional setup
      // In production, you would use the Google Ads API client here
      return [
        {
          id: 'customers/1234567890',
          name: 'Sample Google Ads Account',
          currency_code: 'USD',
          timezone: 'America/New_York',
          status: 'ENABLED',
          customer_id: '123-456-7890'
        }
      ]
    } catch (error: any) {
      logger.error('Failed to get Google ad accounts:', error)
      throw new Error('Failed to get ad accounts')
    }
  }

  async getCampaigns(_customerId: string, _accessToken: string): Promise<GoogleCampaign[]> {
    try {
      // For now, return mock data
      // In production, you would use the Google Ads API client here
      return [
        {
          id: 'campaigns/1234567890',
          name: 'Sample Campaign',
          status: 'ENABLED',
          advertising_channel_type: 'SEARCH',
          campaign_budget: {
            amount_micros: '10000000',
            period: 'DAILY'
          },
          start_date: '2024-01-01',
          end_date: '2024-12-31'
        }
      ]
    } catch (error: any) {
      logger.error('Failed to get Google campaigns:', error)
      throw new Error('Failed to get campaigns')
    }
  }

  async updateCampaignStatus(campaignId: string, status: 'ENABLED' | 'PAUSED', _accessToken: string): Promise<boolean> {
    try {
      // In production, you would use the Google Ads API client here
      logger.info(`Updating campaign ${campaignId} status to ${status}`)
      return true
    } catch (error: any) {
      logger.error('Failed to update Google campaign status:', error)
      throw new Error(`Failed to ${status === 'ENABLED' ? 'enable' : 'pause'} campaign`)
    }
  }

  async validateToken(accessToken: string): Promise<boolean> {
    try {
      const response = await axios.get('https://www.googleapis.com/oauth2/v1/tokeninfo', {
        params: { access_token: accessToken }
      })
      return !response.data.error
    } catch (error) {
      return false
    }
  }
}