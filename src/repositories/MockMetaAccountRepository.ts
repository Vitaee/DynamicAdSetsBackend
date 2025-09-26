import { MetaAccount, CreateMetaAccountData, UpdateMetaAccountData } from '../models/MetaAccount'
import { logger } from '../utils/logger'

// Simple in-memory storage for testing
const metaAccounts: Map<string, MetaAccount> = new Map()

export class MockMetaAccountRepository {
  async findByUserId(userId: string): Promise<MetaAccount | null> {
    try {
      const account = metaAccounts.get(userId)
      return account || null
    } catch (error) {
      logger.error('Error finding Meta account by user ID:', error)
      throw new Error('Failed to find Meta account')
    }
  }

  async create(data: CreateMetaAccountData): Promise<MetaAccount> {
    try {
      const account: MetaAccount = {
        id: `meta_${Date.now()}`,
        user_id: data.user_id,
        meta_user_id: data.meta_user_id,
        meta_user_name: data.meta_user_name,
        meta_user_email: data.meta_user_email,
        access_token: data.access_token,
        token_expires_at: data.token_expires_at,
        ad_accounts: [],
        created_at: new Date(),
        updated_at: new Date()
      }

      metaAccounts.set(data.user_id, account)
      return account
    } catch (error) {
      logger.error('Error creating Meta account:', error)
      throw new Error('Failed to create Meta account')
    }
  }

  async update(id: string, data: UpdateMetaAccountData): Promise<MetaAccount | null> {
    try {
      // Find account by ID
      let account: MetaAccount | null = null
      const entries = Array.from(metaAccounts.entries())
      for (const [_userId, acc] of entries) {
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
      if (data.token_expires_at !== undefined) account.token_expires_at = data.token_expires_at
      if (data.meta_user_name !== undefined) account.meta_user_name = data.meta_user_name
      if (data.meta_user_email !== undefined) account.meta_user_email = data.meta_user_email
      account.updated_at = new Date()

      metaAccounts.set(account.user_id, account)
      return account
    } catch (error) {
      logger.error('Error updating Meta account:', error)
      throw new Error('Failed to update Meta account')
    }
  }

  async upsertAdAccounts(metaAccountId: string, adAccounts: any[]): Promise<void> {
    try {
      // Find the account
      let account: MetaAccount | null = null
      const entries2 = Array.from(metaAccounts.entries())
      for (const [_userId, acc] of entries2) {
        if (acc.id === metaAccountId) {
          account = acc
          break
        }
      }

      if (!account) {
        throw new Error('Meta account not found')
      }

      // Update ad accounts
      account.ad_accounts = adAccounts.map(adAccount => ({
        id: `ad_${Date.now()}_${Math.random()}`,
        meta_account_id: metaAccountId,
        ad_account_id: adAccount.id,
        name: adAccount.name,
        account_status: adAccount.account_status,
        business_id: adAccount.business?.id,
        business_name: adAccount.business?.name,
        currency: adAccount.currency,
        timezone_name: adAccount.timezone_name,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date()
      }))

      metaAccounts.set(account.user_id, account)
    } catch (error) {
      logger.error('Error upserting Meta ad accounts:', error)
      throw new Error('Failed to update ad accounts')
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      // Find and delete account by ID
      const entries3 = Array.from(metaAccounts.entries())
      for (const [userId, account] of entries3) {
        if (account.id === id) {
          metaAccounts.delete(userId)
          return true
        }
      }
      return false
    } catch (error) {
      logger.error('Error deleting Meta account:', error)
      throw new Error('Failed to delete Meta account')
    }
  }
}