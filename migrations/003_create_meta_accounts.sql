-- Create meta_accounts table
CREATE TABLE IF NOT EXISTS meta_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    meta_user_id VARCHAR(255) NOT NULL,
    meta_user_name VARCHAR(255) NOT NULL,
    meta_user_email VARCHAR(255),
    access_token TEXT NOT NULL,
    token_expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, meta_user_id)
);

-- Create meta_ad_accounts table
CREATE TABLE IF NOT EXISTS meta_ad_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meta_account_id UUID NOT NULL REFERENCES meta_accounts(id) ON DELETE CASCADE,
    ad_account_id VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    account_status INTEGER NOT NULL DEFAULT 1,
    business_id VARCHAR(255),
    business_name VARCHAR(255),
    currency VARCHAR(10) NOT NULL,
    timezone_name VARCHAR(100) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(meta_account_id, ad_account_id)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_meta_accounts_user_id ON meta_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_meta_accounts_meta_user_id ON meta_accounts(meta_user_id);
CREATE INDEX IF NOT EXISTS idx_meta_ad_accounts_meta_account_id ON meta_ad_accounts(meta_account_id);
CREATE INDEX IF NOT EXISTS idx_meta_ad_accounts_ad_account_id ON meta_ad_accounts(ad_account_id);
CREATE INDEX IF NOT EXISTS idx_meta_ad_accounts_is_active ON meta_ad_accounts(is_active);

-- Add updated_at trigger for meta_accounts
CREATE OR REPLACE FUNCTION update_meta_accounts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger only if it doesn't already exist (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'trigger_meta_accounts_updated_at'
          AND tgrelid = 'meta_accounts'::regclass
    ) THEN
        CREATE TRIGGER trigger_meta_accounts_updated_at
            BEFORE UPDATE ON meta_accounts
            FOR EACH ROW
            EXECUTE FUNCTION update_meta_accounts_updated_at();
    END IF;
END$$;

-- Add updated_at trigger for meta_ad_accounts
CREATE OR REPLACE FUNCTION update_meta_ad_accounts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger only if it doesn't already exist (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'trigger_meta_ad_accounts_updated_at'
          AND tgrelid = 'meta_ad_accounts'::regclass
    ) THEN
        CREATE TRIGGER trigger_meta_ad_accounts_updated_at
            BEFORE UPDATE ON meta_ad_accounts
            FOR EACH ROW
            EXECUTE FUNCTION update_meta_ad_accounts_updated_at();
    END IF;
END$$;
