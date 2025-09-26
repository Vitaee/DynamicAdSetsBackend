export interface GoogleAccount {
  id: string
  user_id: string
  google_user_id: string
  google_user_email: string
  google_user_name?: string
  google_user_picture?: string
  access_token: string
  refresh_token?: string
  token_expires_at?: Date
  ad_accounts: GoogleAdAccount[]
  created_at: Date
  updated_at: Date
}

export interface GoogleAdAccount {
  id: string
  google_account_id: string
  customer_id: string
  name: string
  currency_code: string
  timezone: string
  status: string
  is_active: boolean
  created_at: Date
  updated_at: Date
}

export interface CreateGoogleAccountData {
  user_id: string
  google_user_id: string
  google_user_email: string
  google_user_name?: string
  google_user_picture?: string
  access_token: string
  refresh_token?: string
  token_expires_at?: Date
}

export interface UpdateGoogleAccountData {
  access_token?: string
  refresh_token?: string
  token_expires_at?: Date
  google_user_name?: string
  google_user_email?: string
  google_user_picture?: string
}