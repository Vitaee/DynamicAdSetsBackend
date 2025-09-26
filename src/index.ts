import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import dotenv from 'dotenv';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';
// import { rateLimiter } from './middleware/rateLimiter';
import routes from './routes';
import { logger } from './utils/logger';
import { validateEnv } from './config/env';
import { startEngineSingleton, stopEngineSingleton } from './services/engineInstance';

dotenv.config();

const env = validateEnv();
const app = express();

// Initialize automation engine (singleton)

// Security middleware
app.use(helmet());
app.use(cors({
  origin: env.FRONTEND_URL,
  credentials: true,
}));

// General middleware
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);
// app.use(rateLimiter); // Temporarily disabled for development

// Routes
app.use('/api', routes);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling
app.use(errorHandler);

// Start server
const server = app.listen(env.PORT, '0.0.0.0', async () => {
  logger.info(`Server running on port ${env.PORT} in ${env.NODE_ENV} mode`);
  
  // Start automation engine singleton
  await startEngineSingleton();
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  
  // Stop automation engine first
  try {
    await stopEngineSingleton();
    logger.info('Automation engine stopped');
  } catch (error) {
    logger.error('Error stopping automation engine:', error);
  }
  
  // Then close the server
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

export default app;
