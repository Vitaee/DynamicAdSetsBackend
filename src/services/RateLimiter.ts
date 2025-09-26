import { createClient, type RedisClientType } from 'redis';
import { logger } from '../utils/logger';
import { validateEnv } from '../config/env';

const env = validateEnv();

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  retryAfterMs?: number;
}

export interface BackoffConfig {
  initialDelayMs: number;
  maxDelayMs: number;
  multiplier: number;
  jitter: boolean;
}

export interface ApiCallOptions {
  service: string;
  endpoint: string;
  maxRetries?: number;
  customBackoff?: Partial<BackoffConfig>;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfter?: number;
  remaining?: number;
  resetTime?: number;
}

/**
 * Redis-based Rate Limiter with Exponential Backoff
 * Handles rate limiting for external APIs (Meta, Google, Weather)
 */
export class RateLimiter {
  private redis: RedisClientType;
  private readonly RATE_LIMIT_PREFIX = 'ratelimit:';
  private readonly BACKOFF_PREFIX = 'backoff:';

  // Default rate limits for different services
  private readonly DEFAULT_LIMITS: Record<string, RateLimitConfig> = {
    'meta_ads': {
      maxRequests: 200,
      windowMs: 3600000, // 1 hour
      retryAfterMs: 3600000
    },
    'google_ads': {
      maxRequests: 10000,
      windowMs: 86400000, // 24 hours
      retryAfterMs: 300000 // 5 minutes
    },
    'openweather': {
      maxRequests: 1000,
      windowMs: 86400000, // 24 hours  
      retryAfterMs: 60000 // 1 minute
    },
    'google_places': {
      maxRequests: 1000,
      windowMs: 86400000, // 24 hours
      retryAfterMs: 60000 // 1 minute
    }
  };

  // Default backoff configuration
  private readonly DEFAULT_BACKOFF: BackoffConfig = {
    initialDelayMs: 1000,
    maxDelayMs: 300000, // 5 minutes max
    multiplier: 2,
    jitter: true
  };

  constructor() {
    this.redis = createClient({
      url: env.REDIS_URL,
      socket: { reconnectStrategy: (retries) => Math.min(retries * 50, 1000) }
    });

    this.redis.on('error', (err) => {
      logger.error('Redis client error in RateLimiter:', err);
    });
  }

  async connect(): Promise<void> {
    await this.redis.connect();
    logger.info('Rate limiter connected to Redis');
  }

  async disconnect(): Promise<void> {
    await this.redis.disconnect();
  }

  /**
   * Check if request is allowed by rate limit
   */
  async checkRateLimit(service: string, identifier?: string): Promise<RateLimitResult> {
    const config = this.DEFAULT_LIMITS[service];
    if (!config) {
      logger.warn(`No rate limit config for service: ${service}`);
      return { allowed: true };
    }

    const key = `${this.RATE_LIMIT_PREFIX}${service}:${identifier || 'default'}`;
    const now = Date.now();
    const windowStart = now - config.windowMs;

    try {
      // Remove expired entries and add current request
      const multi = this.redis.multi();
      multi.zRemRangeByScore(key, 0, windowStart);
      multi.zCard(key);
      multi.zAdd(key, { score: now, value: `${now}-${Math.random()}` });
      multi.expire(key, Math.ceil(config.windowMs / 1000));
      
      const results = await multi.exec();
      const currentCount = (results?.[1] as number) || 0;

      if (currentCount >= config.maxRequests) {
        // Rate limit exceeded
        const oldestEntry = await this.redis.zRangeWithScores(key, 0, 0);
        const resetTime = oldestEntry.length > 0 ? 
          parseInt(oldestEntry[0]?.score?.toString() || '0') + config.windowMs : 
          now + config.windowMs;

        logger.warn(`Rate limit exceeded for ${service}`, {
          service,
          identifier,
          currentCount,
          maxRequests: config.maxRequests,
          resetTime: new Date(resetTime).toISOString()
        });

        return {
          allowed: false,
          retryAfter: config.retryAfterMs || Math.max(resetTime - now, 60000),
          remaining: 0,
          resetTime
        };
      }

      return {
        allowed: true,
        remaining: config.maxRequests - currentCount - 1,
        resetTime: now + config.windowMs
      };

    } catch (error) {
      logger.error(`Rate limit check failed for ${service}:`, error);
      // Fail open - allow request if Redis is down
      return { allowed: true };
    }
  }

  /**
   * Execute API call with rate limiting and exponential backoff
   */
  async executeWithBackoff<T>(
    apiCall: () => Promise<T>,
    options: ApiCallOptions
  ): Promise<T> {
    const { service, endpoint, maxRetries = 3, customBackoff } = options;
    const backoffConfig = { ...this.DEFAULT_BACKOFF, ...customBackoff };
    
    let attempt = 0;
    let lastError: any;

    while (attempt <= maxRetries) {
      try {
        // Check rate limit before making request
        const rateLimitResult = await this.checkRateLimit(service, endpoint);
        
        if (!rateLimitResult.allowed) {
          const retryAfter = rateLimitResult.retryAfter || 60000;
          logger.info(`Rate limited for ${service}:${endpoint}, waiting ${retryAfter}ms`);
          
          if (attempt === maxRetries) {
            throw new Error(`Rate limit exceeded for ${service}:${endpoint} after ${maxRetries} attempts`);
          }
          
          await this.delay(retryAfter);
          attempt++;
          continue;
        }

        // Make the API call
        const startTime = Date.now();
        const result = await apiCall();
        const duration = Date.now() - startTime;

        logger.debug(`API call successful: ${service}:${endpoint}`, {
          duration,
          attempt: attempt + 1
        });

        // Clear any existing backoff for this endpoint
        await this.clearBackoff(service, endpoint);
        
        return result;

      } catch (error: any) {
        lastError = error;
        attempt++;

        // Check if this is a rate limit error
        if (this.isRateLimitError(error)) {
          const retryAfter = this.extractRetryAfter(error) || this.calculateBackoffDelay(attempt, backoffConfig);
          
          logger.warn(`Rate limit error on ${service}:${endpoint}`, {
            attempt,
            maxRetries,
            retryAfter,
            error: error.message
          });

          await this.setBackoff(service, endpoint, retryAfter);

          if (attempt <= maxRetries) {
            await this.delay(retryAfter);
            continue;
          }
        } else if (this.isRetryableError(error)) {
          const backoffDelay = this.calculateBackoffDelay(attempt, backoffConfig);
          
          logger.warn(`Retryable error on ${service}:${endpoint}`, {
            attempt,
            maxRetries,
            backoffDelay,
            error: error.message
          });

          if (attempt <= maxRetries) {
            await this.delay(backoffDelay);
            continue;
          }
        } else {
          // Non-retryable error
          logger.error(`Non-retryable error on ${service}:${endpoint}:`, error);
          throw error;
        }
      }
    }

    // All retries exhausted
    logger.error(`All retries exhausted for ${service}:${endpoint}`, {
      attempts: attempt,
      maxRetries,
      lastError: lastError.message
    });
    
    throw new Error(`API call failed after ${maxRetries} retries: ${lastError?.message || 'Unknown error'}`);
  }

  /**
   * Set backoff for specific service/endpoint
   */
  private async setBackoff(service: string, endpoint: string, delayMs: number): Promise<void> {
    const key = `${this.BACKOFF_PREFIX}${service}:${endpoint}`;
    const backoffUntil = Date.now() + delayMs;
    
    await this.redis.set(key, backoffUntil.toString(), {
      EX: Math.ceil(delayMs / 1000)
    });
  }

  /**
   * Clear backoff for specific service/endpoint
   */
  private async clearBackoff(service: string, endpoint: string): Promise<void> {
    const key = `${this.BACKOFF_PREFIX}${service}:${endpoint}`;
    await this.redis.del(key);
  }

  /**
   * Check if endpoint is currently in backoff
   */
  async isInBackoff(service: string, endpoint: string): Promise<{ inBackoff: boolean; retryAfter?: number }> {
    const key = `${this.BACKOFF_PREFIX}${service}:${endpoint}`;
    const backoffUntilStr = await this.redis.get(key);
    
    if (!backoffUntilStr) {
      return { inBackoff: false };
    }

    const backoffUntil = parseInt(backoffUntilStr);
    const now = Date.now();
    
    if (now >= backoffUntil) {
      await this.clearBackoff(service, endpoint);
      return { inBackoff: false };
    }

    return {
      inBackoff: true,
      retryAfter: backoffUntil - now
    };
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateBackoffDelay(attempt: number, config: BackoffConfig): number {
    let delay = config.initialDelayMs * Math.pow(config.multiplier, attempt - 1);
    delay = Math.min(delay, config.maxDelayMs);
    
    if (config.jitter) {
      // Add jitter to prevent thundering herd
      delay = delay * (0.5 + Math.random() * 0.5);
    }
    
    return Math.floor(delay);
  }

  /**
   * Check if error indicates rate limiting
   */
  private isRateLimitError(error: any): boolean {
    if (!error) return false;
    
    const status = error.response?.status || error.status;
    const message = error.message?.toLowerCase() || '';
    
    return (
      status === 429 ||
      status === 503 ||
      message.includes('rate limit') ||
      message.includes('too many requests') ||
      message.includes('quota exceeded') ||
      message.includes('throttled')
    );
  }

  /**
   * Check if error is retryable
   */
  private isRetryableError(error: any): boolean {
    if (!error) return false;
    
    const status = error.response?.status || error.status;
    
    // Retryable HTTP status codes
    const retryableCodes = [408, 429, 500, 502, 503, 504];
    
    if (retryableCodes.includes(status)) {
      return true;
    }

    // Network errors
    const message = error.message?.toLowerCase() || '';
    return (
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('connection') ||
      message.includes('econnreset') ||
      message.includes('socket hang up')
    );
  }

  /**
   * Extract retry-after header from error response
   */
  private extractRetryAfter(error: any): number | null {
    const retryAfterHeader = error.response?.headers?.['retry-after'];
    
    if (retryAfterHeader) {
      const seconds = parseInt(retryAfterHeader);
      if (!isNaN(seconds)) {
        return seconds * 1000; // Convert to milliseconds
      }
    }
    
    return null;
  }

  /**
   * Delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get rate limit statistics
   */
  async getRateLimitStats(): Promise<Record<string, any>> {
    const services = Object.keys(this.DEFAULT_LIMITS);
    const stats: Record<string, any> = {};
    
    for (const service of services) {
      const key = `${this.RATE_LIMIT_PREFIX}${service}:default`;
      const count = await this.redis.zCard(key);
      const config = this.DEFAULT_LIMITS[service];
      
      if (config) {
        stats[service] = {
          current: count,
          max: config.maxRequests,
          remaining: Math.max(0, config.maxRequests - count),
          windowMs: config.windowMs
        };
      }
    }
    
    return stats;
  }
}
