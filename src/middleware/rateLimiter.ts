import rateLimit from 'express-rate-limit';
import { validateEnv } from '../config/env';

const env = validateEnv();

export const rateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX_REQUESTS,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: {
        message: 'Too many requests',
        retryAfter: Math.ceil(env.RATE_LIMIT_WINDOW_MS / 1000),
      },
    });
  },
});