import { GoogleAccount, CreateGoogleAccountData, UpdateGoogleAccountData } from '../models/GoogleAccount'
import { logger } from '../utils/logger'

// Simple in-memory storage for testing
const googleAccounts: Map<string, GoogleAccount> = new Map()

export class MockGoogleAccountRepository {
  async findByUserId(userId: string): Promise<GoogleAccount | null> {
    try {
      const account = googleAccounts.get(userId)
      return account || null
    } catch (error) {
      logger.error('Error finding Google account by user ID:', error)
      throw new Error('Failed to find Google account')
    }
  }

  async create(data: CreateGoogleAccountData): Promise<GoogleAccount> {
    try {
      const account: GoogleAccount = {
        id: `google_${Date.now()}`,
        user_id: data.user_id,
        google_user_id: data.google_user_id,
        google_user_email: data.google_user_email,
        google_user_name: data.google_user_name,
        google_user_picture: data.google_user_picture,
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        token_expires_at: data.token_expires_at,
        ad_accounts: [],
        created_at: new Date(),
        updated_at: new Date()
      }

      googleAccounts.set(data.user_id, account)
      return account
    } catch (error) {
      logger.error('Error creating Google account:', error)
      throw new Error('Failed to create Google account')
    }
  }

  async update(id: string, data: UpdateGoogleAccountData): Promise<GoogleAccount | null> {
    try {
      // Find account by ID
      let account: GoogleAccount | null = null
      for (const [_userId, acc] of googleAccounts.entries()) {
        if (acc.id === id) {
          account = acc
          break
        }
      }

      if (!account) {
        return null
      }

      // Update the account
      if (data.access_token !== undefined) account.access_token = data.access_token
      if (data.refresh_token !== undefined) account.refresh_token = data.refresh_token
      if (data.token_expires_at !== undefined) account.token_expires_at = data.token_expires_at
      if (data.google_user_name !== undefined) account.google_user_name = data.google_user_name
      if (data.google_user_email !== undefined) account.google_user_email = data.google_user_email
      if (data.google_user_picture !== undefined) account.google_user_picture = data.google_user_picture
      account.updated_at = new Date()

      googleAccounts.set(account.user_id, account)
      return account
    } catch (error) {
      logger.error('Error updating Google account:', error)
      throw new Error('Failed to update Google account')
    }
  }

  async upsertAdAccounts(googleAccountId: string, adAccounts: any[]): Promise<void> {
    try {
      // Find the account
      let account: GoogleAccount | null = null
      for (const [_userId, acc] of googleAccounts.entries()) {
        if (acc.id === googleAccountId) {
          account = acc
          break
        }
      }

      if (!account) {
        throw new Error('Google account not found')
      }

      // Update ad accounts
      account.ad_accounts = adAccounts.map(adAccount => ({
        id: `gad_${Date.now()}_${Math.random()}`,
        google_account_id: googleAccountId,
        customer_id: adAccount.customer_id,
        name: adAccount.name,
        currency_code: adAccount.currency_code,
        timezone: adAccount.timezone,
        status: adAccount.status,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date()
      }))

      googleAccounts.set(account.user_id, account)
    } catch (error) {
      logger.error('Error upserting Google ad accounts:', error)
      throw new Error('Failed to update ad accounts')
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      // Find and delete account by ID
      for (const [userId, account] of googleAccounts.entries()) {
        if (account.id === id) {
          googleAccounts.delete(userId)
          return true
        }
      }
      return false
    } catch (error) {
      logger.error('Error deleting Google account:', error)
      throw new Error('Failed to delete Google account')
    }
  }
}