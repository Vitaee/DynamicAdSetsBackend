export interface MetaAccount {
  id: string
  user_id: string
  meta_user_id: string
  meta_user_name: string
  meta_user_email?: string
  access_token: string
  token_expires_at?: Date
  ad_accounts: MetaAdAccountRecord[]
  created_at: Date
  updated_at: Date
}

export interface MetaAdAccountRecord {
  id: string
  meta_account_id: string
  ad_account_id: string
  name: string
  account_status: number
  business_id?: string
  business_name?: string
  currency: string
  timezone_name: string
  is_active: boolean
  created_at: Date
  updated_at: Date
}

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