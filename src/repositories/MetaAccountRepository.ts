import { query } from '../config/database'
import { MetaAccount, MetaAdAccountRecord } from '../models/MetaAccount'

export interface CreateMetaAccountData {
  user_id: string
  meta_user_id: string
  meta_user_name: string
  meta_user_email?: string
  access_token: string
  token_expires_at?: Date
}

export interface UpdateMetaAccountData {
  access_token?: string
  token_expires_at?: Date
  meta_user_name?: string
  meta_user_email?: string
}

export class MetaAccountRepository {
  async findByUserId(userId: string): Promise<MetaAccount | null> {
    const result = await query(
      `SELECT ma.*, 
              array_agg(
                json_build_object(
                  'id', maa.id,
                  'ad_account_id', maa.ad_account_id,
                  'name', maa.name,
                  'account_status', maa.account_status,
                  'business_id', maa.business_id,
                  'business_name', maa.business_name,
                  'currency', maa.currency,
                  'timezone_name', maa.timezone_name,
                  'is_active', maa.is_active,
                  'created_at', maa.created_at,
                  'updated_at', maa.updated_at
                )
              ) FILTER (WHERE maa.id IS NOT NULL) as ad_accounts
       FROM meta_accounts ma
       LEFT JOIN meta_ad_accounts maa ON ma.id = maa.meta_account_id
       WHERE ma.user_id = $1
       GROUP BY ma.id`,
      [userId]
    )

    if (result.rows.length === 0) {
      return null
    }

    const row = result.rows[0]
    return {
      ...row,
      ad_accounts: row.ad_accounts || []
    }
  }

  async create(data: CreateMetaAccountData): Promise<MetaAccount> {
    const result = await query(
      `INSERT INTO meta_accounts (user_id, meta_user_id, meta_user_name, meta_user_email, access_token, token_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [data.user_id, data.meta_user_id, data.meta_user_name, data.meta_user_email, data.access_token, data.token_expires_at]
    )

    return {
      ...result.rows[0],
      ad_accounts: []
    }
  }

  async update(id: string, data: UpdateMetaAccountData): Promise<MetaAccount | null> {
    const fields = []
    const values = []
    let paramCount = 1

    if (data.access_token !== undefined) {
      fields.push(`access_token = $${paramCount++}`)
      values.push(data.access_token)
    }
    if (data.token_expires_at !== undefined) {
      fields.push(`token_expires_at = $${paramCount++}`)
      values.push(data.token_expires_at)
    }
    if (data.meta_user_name !== undefined) {
      fields.push(`meta_user_name = $${paramCount++}`)
      values.push(data.meta_user_name)
    }
    if (data.meta_user_email !== undefined) {
      fields.push(`meta_user_email = $${paramCount++}`)
      values.push(data.meta_user_email)
    }

    if (fields.length === 0) {
      return null
    }

    values.push(id)
    const result = await query(
      `UPDATE meta_accounts 
       SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${paramCount}
       RETURNING *`,
      values
    )

    if (result.rows.length === 0) {
      return null
    }

    // Get the updated account with ad accounts
    return this.findById(id)
  }

  async findById(id: string): Promise<MetaAccount | null> {
    const result = await query(
      `SELECT ma.*, 
              array_agg(
                json_build_object(
                  'id', maa.id,
                  'ad_account_id', maa.ad_account_id,
                  'name', maa.name,
                  'account_status', maa.account_status,
                  'business_id', maa.business_id,
                  'business_name', maa.business_name,
                  'currency', maa.currency,
                  'timezone_name', maa.timezone_name,
                  'is_active', maa.is_active,
                  'created_at', maa.created_at,
                  'updated_at', maa.updated_at
                )
              ) FILTER (WHERE maa.id IS NOT NULL) as ad_accounts
       FROM meta_accounts ma
       LEFT JOIN meta_ad_accounts maa ON ma.id = maa.meta_account_id
       WHERE ma.id = $1
       GROUP BY ma.id`,
      [id]
    )

    if (result.rows.length === 0) {
      return null
    }

    const row = result.rows[0]
    return {
      ...row,
      ad_accounts: row.ad_accounts || []
    }
  }

  async upsertAdAccounts(metaAccountId: string, adAccounts: Omit<MetaAdAccountRecord, 'id' | 'created_at' | 'updated_at'>[]): Promise<void> {
    // First, mark all existing ad accounts as inactive
    await query(
      'UPDATE meta_ad_accounts SET is_active = false WHERE meta_account_id = $1',
      [metaAccountId]
    )

    // Then upsert each ad account
    for (const adAccount of adAccounts) {
      await query(
        `INSERT INTO meta_ad_accounts (
          meta_account_id, ad_account_id, name, account_status, 
          business_id, business_name, currency, timezone_name, is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (meta_account_id, ad_account_id) 
        DO UPDATE SET 
          name = EXCLUDED.name,
          account_status = EXCLUDED.account_status,
          business_id = EXCLUDED.business_id,
          business_name = EXCLUDED.business_name,
          currency = EXCLUDED.currency,
          timezone_name = EXCLUDED.timezone_name,
          is_active = EXCLUDED.is_active,
          updated_at = CURRENT_TIMESTAMP`,
        [
          metaAccountId,
          adAccount.ad_account_id,
          adAccount.name,
          adAccount.account_status,
          adAccount.business_id,
          adAccount.business_name,
          adAccount.currency,
          adAccount.timezone_name,
          adAccount.is_active
        ]
      )
    }
  }

  async delete(id: string): Promise<boolean> {
    const result = await query(
      'DELETE FROM meta_accounts WHERE id = $1',
      [id]
    )
    return result.rowCount > 0
  }
}