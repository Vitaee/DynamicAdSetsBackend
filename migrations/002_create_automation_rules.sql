-- Create automation_rules table
CREATE TABLE IF NOT EXISTS automation_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    location JSONB NOT NULL,
    conditions JSONB NOT NULL,
    condition_logic JSONB,
    campaigns JSONB NOT NULL,
    check_interval_minutes INTEGER NOT NULL,
    last_checked_at TIMESTAMP,
    last_executed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_automation_rules_user_id ON automation_rules(user_id);
CREATE INDEX IF NOT EXISTS idx_automation_rules_is_active ON automation_rules(is_active);

-- Create trigger for updated_at
-- Create trigger only if it doesn't already exist (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'update_automation_rules_updated_at'
          AND tgrelid = 'automation_rules'::regclass
    ) THEN
        CREATE TRIGGER update_automation_rules_updated_at
        BEFORE UPDATE ON automation_rules
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END$$;

-- Create automation_executions table for tracking rule executions
CREATE TABLE IF NOT EXISTS automation_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id UUID NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
    executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    weather_data JSONB NOT NULL,
    conditions_met BOOLEAN NOT NULL,
    actions_taken JSONB NOT NULL,
    success BOOLEAN NOT NULL,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for rule_id lookups
CREATE INDEX IF NOT EXISTS idx_automation_executions_rule_id ON automation_executions(rule_id);
CREATE INDEX IF NOT EXISTS idx_automation_executions_executed_at ON automation_executions(executed_at);
