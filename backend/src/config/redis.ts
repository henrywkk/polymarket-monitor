import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD,
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: 3,
  // Make Redis connection lazy - don't connect immediately
  lazyConnect: true,
  // Increase connection timeout for cloud deployments
  connectTimeout: 10000, // 10 seconds
  // Enable offline queue - commands will be queued if connection is down
  enableOfflineQueue: true,
  // Don't fail on connection errors - queue commands instead
  enableReadyCheck: false,
};

// If REDIS_URL is provided, use it instead
const redisUrl = process.env.REDIS_URL;

export const redis = redisUrl
  ? new Redis(redisUrl, redisConfig)
  : new Redis(redisConfig);

let connectionAttempted = false;

// Attempt connection (non-blocking)
const attemptConnection = async () => {
  if (connectionAttempted) return;
  connectionAttempted = true;
  
  try {
    await redis.connect();
    console.log('Redis client connected');
  } catch (error) {
    console.warn('Redis connection failed (will retry in background):', error instanceof Error ? error.message : String(error));
    // Connection will retry automatically via retryStrategy
  }
};

redis.on('connect', () => {
  console.log('Redis client connected');
});

redis.on('error', (err) => {
  // Only log non-timeout errors to avoid spam during connection attempts
  const errMsg = err.message || String(err);
  if (!errMsg.includes('ETIMEDOUT') && !errMsg.includes('ECONNREFUSED') && !errMsg.includes('ENOTFOUND')) {
    console.error('Redis client error', err);
  }
});

redis.on('close', () => {
  // Don't log every close event to avoid spam
});

redis.on('ready', () => {
  console.log('Redis client ready');
});

// Attempt connection in background (non-blocking)
// This allows the server to start even if Redis is unavailable
setTimeout(() => {
  attemptConnection().catch(() => {
    // Silently fail - Redis is optional for basic functionality
  });
}, 1000); // Wait 1 second before attempting connection

export default redis;

