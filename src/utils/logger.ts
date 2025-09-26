import * as winston from 'winston';
import { validateEnv } from '../config/env';

const env = validateEnv();

const logLevel = env.NODE_ENV === 'production' ? 'info' : 'debug';

export const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'weathertrigger-backend' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp(),
        winston.format.printf((info) => {
          const { level, message, timestamp, ...meta } = info as any
          const msg = typeof message === 'string' ? message : JSON.stringify(message)
          const rest = Object.keys(meta).length ? JSON.stringify(meta) : ''
          return `${timestamp} ${level}: ${msg}${rest ? ' ' + rest : ''}`
        })
      ),
    }),
  ],
});

if (env.NODE_ENV === 'production') {
  logger.add(
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
    })
  );
  logger.add(
    new winston.transports.File({
      filename: 'logs/combined.log',
    })
  );
}
