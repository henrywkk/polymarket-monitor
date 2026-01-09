import { Pool, PoolConfig } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const poolConfig: PoolConfig = {
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000, // Increased to 10 seconds for Railway/cloud deployments
};

export const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

export const query = async (text: string, params?: unknown[]) => {
  try {
    const res = await pool.query(text, params);
    // Removed verbose query logging to reduce Railway log rate limits
    // Only log errors, not successful queries
    return res;
  } catch (error) {
    // Only log errors with query preview (first 200 chars) to avoid log spam
    const queryPreview = text.length > 200 ? text.substring(0, 200) + '...' : text;
    console.error('Database query error', { 
      query: queryPreview, 
      error: error instanceof Error ? error.message : String(error) 
    });
    throw error;
  }
};

export const getClient = async () => {
  const client = await pool.connect();
  return client;
};

