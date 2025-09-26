import { createClient, type RedisClientType } from 'redis';
import { logger } from '../utils/logger';
import { validateEnv } from '../config/env';

const env = validateEnv();

export interface JobData {
  id: string;
  type: 'automation_rule_check';
  ruleId: string;
  userId: string;
  intervalMinutes: number;
  priority: number;
  retryCount: number;
  maxRetries: number;
  createdAt: number;
  scheduledAt: number;
  lastExecutedAt?: number;
  metadata?: any;
}

export interface JobResult {
  success: boolean;
  error?: string;
  executionTime: number;
  retryAfter?: number;
}

/**
 * Redis-based Job Scheduler for automation rules
 * Uses Redis sorted sets for time-based scheduling
 */
export class JobScheduler {
  private redis: RedisClientType;
  private readonly JOBS_KEY = 'automation:scheduled_jobs';
  private readonly PROCESSING_KEY = 'automation:processing_jobs';
  private readonly RESULTS_KEY = 'automation:job_results';

  constructor() {
    this.redis = createClient({
      url: env.REDIS_URL,
      socket: { reconnectStrategy: (retries) => Math.min(retries * 50, 1000) }
    });

    this.redis.on('error', (err) => {
      logger.error('Redis client error:', err);
    });

    this.redis.on('connect', () => {
      logger.info('Connected to Redis for job scheduling');
    });
  }

  async connect(): Promise<void> {
    await this.redis.connect();
  }

  async disconnect(): Promise<void> {
    await this.redis.disconnect();
  }

  /**
   * Schedule a new job or update existing one
   */
  async scheduleJob(job: Omit<JobData, 'createdAt'>): Promise<void> {
    const jobData: JobData = {
      ...job,
      createdAt: Date.now()
    };

    try {
      // Store job data
      await this.redis.hSet(`job:${job.id}`, {
        data: JSON.stringify(jobData)
      });

      // Add to scheduled jobs sorted set (score = scheduledAt timestamp)
      await this.redis.zAdd(this.JOBS_KEY, {
        score: job.scheduledAt,
        value: job.id
      });

      logger.info(`Scheduled job ${job.id} for ${new Date(job.scheduledAt).toISOString()}`, {
        type: job.type,
        ruleId: job.ruleId,
        intervalMinutes: job.intervalMinutes
      });
    } catch (error) {
      logger.error(`Failed to schedule job ${job.id}:`, error);
      throw error;
    }
  }

  /**
   * Schedule automation rule check
   */
  async scheduleRuleCheck(ruleId: string, userId: string, intervalMinutes: number, priority: number = 1): Promise<void> {
    const now = Date.now();
    const scheduleTime = now + (intervalMinutes * 60 * 1000);
    
    const job: Omit<JobData, 'createdAt'> = {
      id: `rule_check_${ruleId}`,
      type: 'automation_rule_check',
      ruleId,
      userId,
      intervalMinutes,
      priority,
      retryCount: 0,
      maxRetries: 3,
      scheduledAt: scheduleTime
    };

    await this.scheduleJob(job);
  }

  /**
   * Get jobs ready for execution
   */
  async getReadyJobs(limit: number = 10): Promise<JobData[]> {
    const now = Date.now();
    
    try {
      // Get jobs scheduled before now
      const jobIds = await this.redis.zRangeByScore(this.JOBS_KEY, 0, now, {
        LIMIT: { offset: 0, count: limit }
      });

      if (jobIds.length === 0) {
        return [];
      }

      // Get job data for each ID
      const jobs: JobData[] = [];
      for (const jobId of jobIds) {
        const jobDataStr = await this.redis.hGet(`job:${jobId}`, 'data');
        if (jobDataStr) {
          try {
            const jobData = JSON.parse(jobDataStr) as JobData;
            jobs.push(jobData);
          } catch (error) {
            logger.error(`Failed to parse job data for ${jobId}:`, error);
            // Remove corrupted job
            await this.removeJob(jobId);
          }
        }
      }

      return jobs;
    } catch (error) {
      logger.error('Failed to get ready jobs:', error);
      return [];
    }
  }

  /**
   * Mark job as processing
   */
  async markJobProcessing(jobId: string): Promise<boolean> {
    try {
      // Atomically move job from scheduled to processing
      const multi = this.redis.multi();
      multi.zRem(this.JOBS_KEY, jobId);
      multi.sAdd(this.PROCESSING_KEY, jobId);
      multi.hSet(`job:${jobId}`, 'processingStartedAt', Date.now().toString());
      
      const results = await multi.exec();
      
      // Check if job was successfully moved (it existed in scheduled jobs)
      return results && results[0] === 1;
    } catch (error) {
      logger.error(`Failed to mark job ${jobId} as processing:`, error);
      return false;
    }
  }

  /**
   * Complete job execution
   */
  async completeJob(jobId: string, result: JobResult): Promise<void> {
    try {
      const jobDataStr = await this.redis.hGet(`job:${jobId}`, 'data');
      if (!jobDataStr) {
        logger.warn(`Job ${jobId} not found when trying to complete`);
        return;
      }

      const jobData = JSON.parse(jobDataStr) as JobData;

      if (result.success) {
        // Job succeeded - schedule next execution
        await this.scheduleNextExecution(jobData);
        await this.cleanupJob(jobId);
      } else if (jobData.retryCount < jobData.maxRetries) {
        // Job failed but can retry
        await this.scheduleRetry(jobData, result.retryAfter);
      } else {
        // Job failed and max retries reached
        logger.error(`Job ${jobId} failed after ${jobData.maxRetries} retries. Giving up.`);
        await this.cleanupJob(jobId);
      }

      // Store result for monitoring
      await this.storeJobResult(jobId, result);

    } catch (error) {
      logger.error(`Failed to complete job ${jobId}:`, error);
      await this.cleanupJob(jobId);
    }
  }

  /**
   * Schedule next execution of a successful job
   */
  private async scheduleNextExecution(jobData: JobData): Promise<void> {
    const nextScheduleTime = Date.now() + (jobData.intervalMinutes * 60 * 1000);
    
    const nextJob: JobData = {
      ...jobData,
      scheduledAt: nextScheduleTime,
      retryCount: 0,
      lastExecutedAt: Date.now(),
      createdAt: Date.now()
    };

    await this.redis.hSet(`job:${jobData.id}`, {
      data: JSON.stringify(nextJob)
    });

    await this.redis.zAdd(this.JOBS_KEY, {
      score: nextScheduleTime,
      value: jobData.id
    });
  }

  /**
   * Schedule job retry with exponential backoff
   */
  private async scheduleRetry(jobData: JobData, customRetryAfter?: number): Promise<void> {
    const retryCount = jobData.retryCount + 1;
    const exponentialBackoff = Math.min(Math.pow(2, retryCount) * 1000, 300000); // Max 5 minutes
    const retryDelay = customRetryAfter || exponentialBackoff;
    const retryTime = Date.now() + retryDelay;

    const retryJob: JobData = {
      ...jobData,
      retryCount,
      scheduledAt: retryTime,
      createdAt: Date.now()
    };

    await this.redis.hSet(`job:${jobData.id}`, {
      data: JSON.stringify(retryJob)
    });

    await this.redis.zAdd(this.JOBS_KEY, {
      score: retryTime,
      value: jobData.id
    });

    logger.info(`Scheduled retry ${retryCount}/${jobData.maxRetries} for job ${jobData.id} in ${retryDelay}ms`);
  }

  /**
   * Store job execution result
   */
  private async storeJobResult(jobId: string, result: JobResult): Promise<void> {
    const resultData = {
      ...result,
      timestamp: Date.now()
    };

    await this.redis.hSet(`${this.RESULTS_KEY}:${jobId}`, {
      data: JSON.stringify(resultData)
    });

    // Set expiration for result (keep for 24 hours)
    await this.redis.expire(`${this.RESULTS_KEY}:${jobId}`, 86400);
  }

  /**
   * Remove job from processing and cleanup
   */
  private async cleanupJob(jobId: string): Promise<void> {
    const multi = this.redis.multi();
    multi.sRem(this.PROCESSING_KEY, jobId);
    multi.del(`job:${jobId}`);
    await multi.exec();
  }

  /**
   * Remove job completely
   */
  async removeJob(jobId: string): Promise<void> {
    const multi = this.redis.multi();
    multi.zRem(this.JOBS_KEY, jobId);
    multi.sRem(this.PROCESSING_KEY, jobId);
    multi.del(`job:${jobId}`);
    await multi.exec();
  }

  /**
   * Get job statistics
   */
  async getJobStats(): Promise<{
    scheduled: number;
    processing: number;
    overdue: number;
  }> {
    const now = Date.now();
    
    const [scheduled, processing, overdue] = await Promise.all([
      this.redis.zCard(this.JOBS_KEY),
      this.redis.sCard(this.PROCESSING_KEY),
      this.redis.zCount(this.JOBS_KEY, 0, now - 300000) // Jobs scheduled more than 5 min ago
    ]);

    return { scheduled, processing, overdue };
  }

  /**
   * Recover stuck jobs (jobs in processing for too long)
   */
  async recoverStuckJobs(): Promise<number> {
    const processingJobs = await this.redis.sMembers(this.PROCESSING_KEY);
    let recoveredCount = 0;

    for (const jobId of processingJobs) {
      const processingStartedAtStr = await this.redis.hGet(`job:${jobId}`, 'processingStartedAt');
      
      if (processingStartedAtStr) {
        const processingStartedAt = parseInt(processingStartedAtStr);
        const processingTime = Date.now() - processingStartedAt;
        
        // If processing for more than 10 minutes, consider it stuck
        if (processingTime > 600000) {
          logger.warn(`Recovering stuck job ${jobId} (processing for ${processingTime}ms)`);
          
          // Move back to scheduled with immediate execution
          await this.redis.sRem(this.PROCESSING_KEY, jobId);
          await this.redis.zAdd(this.JOBS_KEY, {
            score: Date.now(),
            value: jobId
          });
          
          recoveredCount++;
        }
      }
    }

    if (recoveredCount > 0) {
      logger.info(`Recovered ${recoveredCount} stuck jobs`);
    }

    return recoveredCount;
  }
}
