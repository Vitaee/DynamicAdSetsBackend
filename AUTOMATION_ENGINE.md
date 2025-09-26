# WeatherTrigger  Automation Engine

A production-ready, scalable automation engine for managing ad campaigns based on weather conditions.

## New Features

### **Real-Time Job Scheduling**
- Redis-based job scheduler with precise timing
- Supports different check intervals per rule (12h, 24h)
- Automatic job recovery and stuck job detection
- Horizontal scaling with multiple workers

###  **Advanced Rate Limiting**
- Exponential backoff with jitter
- Service-specific rate limits (Meta, Google, OpenWeather)
- Automatic retry with intelligent backoff strategies
- Rate limit caching to prevent API overload

###  **Robust Error Handling**
- Retry mechanisms with configurable max attempts
- Graceful degradation for API failures  
- Comprehensive execution logging
- Dead letter queue handling

### **Production Monitoring**
- Worker health checks and heartbeat monitoring
- Detailed execution metrics and performance tracking
- Real-time job queue statistics
- Worker registry for distributed deployments

###  **Database Integration**
- Raw SQL queries for optimal performance
- Execution metrics storage in JSONB format
- Worker registry table for coordination
- Automatic database migrations

##  Architecture Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Automation    │    │   Job Scheduler │    │   Rate Limiter  │
│     Worker      │◄──►│     (Redis)     │◄──►│     (Redis)     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                        │                        │
         ▼                        ▼                        ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   PostgreSQL    │    │   External APIs │    │     Logging     │
│   (Executions)  │    │ Meta/Google/etc │    │    (Winston)    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

##  Quick Start

### 1. **Database Setup**

Run the migration:
```bash
psql $DATABASE_URL < apps/backend/migrations/005_add_execution_metrics.sql
```

### 2. **Start the  Engine**

The  engine automatically starts with the main application:

```bash
# Start databases
docker compose up -d redis postgres

# Start backend (includes automation worker)
cd apps/backend
npm run dev
```

### 3. **Monitor with CLI**

```bash
# Check worker status
npx ts-node apps/backend/src/cli/automation-cli.ts list-workers

# View job statistics  
npx ts-node apps/backend/src/cli/automation-cli.ts job-stats

# Check rate limit status
npx ts-node apps/backend/src/cli/automation-cli.ts rate-limit-stats

# Test a specific rule
npx ts-node apps/backend/src/cli/automation-cli.ts test-rule <rule-id>
```

## Performance Improvements

### **Before (Exists Engine)**
- Simple `setInterval(60000)` - inefficient for different intervals
- No rate limiting - API failures during high traffic
- Basic retry logic - jobs could get stuck indefinitely  
- Limited error tracking - hard to debug failures
- Single-threaded processing - bottlenecks with many rules

### **After ( Engine)**
- **Redis-based job queue** - precise timing per rule interval
- **Intelligent rate limiting** - exponential backoff with service-specific limits
- **Advanced retry mechanisms** - configurable attempts with different strategies
- **Comprehensive metrics** - execution tracking with performance data
-  **Horizontal scaling** - multiple workers can process jobs in parallel

## Configuration

### **Environment Variables**

```env
# Required for Redis
REDIS_URL=redis://localhost:6379

# Required for weather API
OPENWEATHER_API_KEY=your_api_key

# Optional - Worker configuration
WORKER_MAX_CONCURRENT_JOBS=5
WORKER_HEALTH_CHECK_INTERVAL=30000
```

### **Worker Configuration**

```typescript
const worker = new AutomationWorker({
  workerId: 'my-worker-1',
  maxConcurrentJobs: 5,           // Process up to 5 jobs simultaneously
  healthCheckInterval: 30000,     // Health check every 30 seconds
  gracefulShutdownTimeout: 60000  // Wait 60s for jobs to complete on shutdown
});
```

### **Rate Limiting Configuration**

Default limits per service:
```typescript
const rateLimits = {
  'meta_ads': {
    maxRequests: 200,
    windowMs: 3600000,      // 1 hour
    retryAfterMs: 3600000   // 1 hour backoff
  },
  'google_ads': {
    maxRequests: 10000,
    windowMs: 86400000,     // 24 hours  
    retryAfterMs: 300000    // 5 minute backoff
  },
  'openweather': {
    maxRequests: 1000,
    windowMs: 86400000,     // 24 hours
    retryAfterMs: 60000     // 1 minute backoff
  }
};
```

## CLI Commands

### **Worker Management**
```bash
# Start a worker manually
automation-cli start-worker worker-1 3

# Stop a specific worker  
automation-cli stop-worker worker-1

# List all active workers
automation-cli list-workers
```

### **Job Management**
```bash
# Schedule a rule check manually
automation-cli schedule-rule rule-123 user-456 30

# View job queue statistics
automation-cli list-jobs

# Get detailed job metrics
automation-cli job-stats
```

### **Debugging**
```bash
# Test a specific rule
automation-cli test-rule rule-123

# Check API rate limits
automation-cli rate-limit-stats

# Show help
automation-cli help
```

## Monitoring & Metrics

### **Execution Metrics**

Each rule execution stores detailed metrics:

```json
{
  "weatherApiCalls": 1,
  "metaApiCalls": 2, 
  "googleApiCalls": 0,
  "totalExecutionTime": 1250,
  "conditionsEvaluated": 1,
  "actionsExecuted": 2
}
```

### **Worker Health**

Worker registry tracks:
- Worker status (starting/running/stopping/stopped)
- Jobs processed/succeeded/failed
- Current job count
- Last heartbeat timestamp
- Uptime and performance metrics

### **Database Queries**

Monitor automation performance:

```sql
-- Rule execution success rate
SELECT 
  ar.name,
  COUNT(*) as total_executions,
  SUM(CASE WHEN ae.success THEN 1 ELSE 0 END) as successful_executions,
  ROUND(AVG(CASE WHEN ae.success THEN 1 ELSE 0 END) * 100, 2) as success_rate
FROM automation_rules ar
JOIN automation_executions ae ON ar.id = ae.rule_id
WHERE ae.executed_at > NOW() - INTERVAL '24 hours'
GROUP BY ar.id, ar.name;

-- API call metrics
SELECT 
  DATE_TRUNC('hour', executed_at) as hour,
  SUM((execution_metrics->>'weatherApiCalls')::int) as weather_calls,
  SUM((execution_metrics->>'metaApiCalls')::int) as meta_calls,
  SUM((execution_metrics->>'googleApiCalls')::int) as google_calls
FROM automation_executions 
WHERE executed_at > NOW() - INTERVAL '24 hours'
  AND execution_metrics IS NOT NULL
GROUP BY hour
ORDER BY hour;

-- Worker performance
SELECT 
  worker_id,
  status,
  jobs_processed,
  ROUND((jobs_succeeded::float / NULLIF(jobs_processed, 0)) * 100, 2) as success_rate,
  last_heartbeat
FROM worker_registry
WHERE status IN ('running', 'starting');
```

##  Error Handling

### **Retry Strategies**

1. **Rate Limit Errors**: Exponential backoff with extracted retry-after headers
2. **Network Errors**: Short delays with jitter to prevent thundering herd
3. **API Errors**: Service-specific retry logic based on error codes  
4. **Database Errors**: Transaction rollback with retry

### **Error Recovery**

- **Stuck Jobs**: Automatic detection and recovery every 5 minutes
- **Failed Workers**: Health check cleanup removes stale workers
- **API Failures**: Circuit breaker pattern prevents cascading failures
- **Database Issues**: Connection pooling with automatic reconnection

## Scaling

### **Horizontal Scaling**

Run multiple workers across different servers:

```bash
# Server 1
WORKER_ID=server1-worker1 npm run dev

# Server 2  
WORKER_ID=server2-worker1 npm run dev

# Server 3
WORKER_ID=server3-worker1 npm run dev
```

### **Load Balancing**

- Jobs are distributed via Redis queue
- Workers coordinate through worker registry
- No single point of failure
- Automatic failover if workers go down

##  Security

- **API Keys**: Stored securely in environment variables
- **Rate Limiting**: Prevents API abuse and quota exhaustion  
- **Input Validation**: All job data validated before processing
- **Error Sanitization**: Sensitive data removed from logs

## Logging

### **Log Levels**

- **ERROR**: Failed executions, API errors, worker crashes
- **WARN**: Rate limits hit, stuck jobs recovered, retries
- **INFO**: Job completions, worker status, health checks
- **DEBUG**: Job processing details, API call timing

### **Log Format**

```json
{
  "timestamp": "2025-01-09T10:30:00.000Z",
  "level": "info", 
  "message": "Rule execution completed",
  "ruleId": "rule-123",
  "conditionsMet": true,
  "actionsExecuted": 2,
  "executionTime": 1250,
  "service": "weathertrigger-backend"
}
```

##  Next Steps

1. **Alerts**: Add Slack/email notifications for failures
2. **Analytics**: Build ,  improve dashboard for execution analytics  
3. **Caching**: Add weather data caching to reduce API calls
4. **Load Testing**: Stress test with 1000+ concurrent rules
5. **Backup**: Implement Redis persistence and backup strategies

---
