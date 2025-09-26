-- Add execution metrics column to automation_executions table
ALTER TABLE automation_executions 
ADD COLUMN IF NOT EXISTS execution_metrics JSONB;

-- Add index for better performance on metrics queries
CREATE INDEX IF NOT EXISTS idx_automation_executions_metrics 
ON automation_executions USING GIN (execution_metrics);

-- Add index for success/failure analytics
CREATE INDEX IF NOT EXISTS idx_automation_executions_success 
ON automation_executions(success, executed_at);

-- Create worker registry table for tracking automation workers
CREATE TABLE IF NOT EXISTS worker_registry (
  worker_id VARCHAR(255) PRIMARY KEY,
  status VARCHAR(50) NOT NULL,
  started_at TIMESTAMP NOT NULL,
  last_heartbeat TIMESTAMP NOT NULL,
  max_concurrent_jobs INTEGER NOT NULL,
  current_jobs INTEGER NOT NULL DEFAULT 0,
  jobs_processed INTEGER NOT NULL DEFAULT 0,
  jobs_succeeded INTEGER NOT NULL DEFAULT 0,
  jobs_failed INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add indexes for worker registry
CREATE INDEX IF NOT EXISTS idx_worker_registry_status ON worker_registry(status);
CREATE INDEX IF NOT EXISTS idx_worker_registry_heartbeat ON worker_registry(last_heartbeat);

-- Add trigger for worker registry updated_at
CREATE OR REPLACE FUNCTION update_worker_registry_updated_at()
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
        WHERE tgname = 'trigger_worker_registry_updated_at'
          AND tgrelid = 'worker_registry'::regclass
    ) THEN
        CREATE TRIGGER trigger_worker_registry_updated_at
            BEFORE UPDATE ON worker_registry
            FOR EACH ROW
            EXECUTE FUNCTION update_worker_registry_updated_at();
    END IF;
END$$;
