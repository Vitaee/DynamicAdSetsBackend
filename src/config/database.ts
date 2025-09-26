import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { validateEnv } from './env';
import { logger } from '../utils/logger';
import * as schema from '../db/schema';

const env = validateEnv();

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Initialize Drizzle ORM with the pool
export const db = drizzle(pool, { schema });

// Test the connection
pool.on('connect', () => {
  logger.info('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  logger.error('PostgreSQL connection error:', err);
});

// Helper function to execute raw queries (for legacy support)
export async function query(text: string, params?: any[]): Promise<any> {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug('Executed query', { text, duration, rows: res.rowCount });
    return res;
  } catch (error) {
    logger.error('Database query error:', { text, error });
    throw error;
  }
}

// Helper function for transactions with Drizzle
export const withTransaction = db.transaction.bind(db);

//  transaction helper (for raw queries)
export async function withRawTransaction<T>(
  callback: (client: any) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}