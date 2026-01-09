import { redis } from '../config/redis';

/**
 * Redis Sliding Window Service
 * 
 * Provides time-series data storage with automatic cleanup of old data.
 * Uses Redis Sorted Sets (ZSET) where score is timestamp and value is JSON data.
 */
export class RedisSlidingWindow {
  /**
   * Add data point to time-series with automatic cleanup
   * @param key Redis key
   * @param value Data to store (will be JSON stringified)
   * @param maxAgeMs Maximum age in milliseconds (older data auto-removed)
   * @param maxItems Maximum number of items to keep
   */
  static async add(
    key: string,
    value: any,
    maxAgeMs: number = 3600000, // 1 hour default
    maxItems: number = 1000
  ): Promise<void> {
    const score = Date.now();
    const stringValue = JSON.stringify(value);
    
    try {
      // Add to sorted set
      await redis.zadd(key, score, stringValue);
      
      // Remove old data (older than maxAgeMs)
      const cutoffTime = Date.now() - maxAgeMs;
      await redis.zremrangebyscore(key, 0, cutoffTime);
      
      // Limit items if exceeds maxItems
      const count = await redis.zcard(key);
      if (count > maxItems) {
        // Remove oldest entries (keep last maxItems)
        await redis.zremrangebyrank(key, 0, count - maxItems - 1);
      }
      
      // Set TTL slightly longer than maxAgeMs to ensure cleanup
      const ttlSeconds = Math.ceil(maxAgeMs / 1000) + 3600; // Add 1 hour buffer
      await redis.expire(key, ttlSeconds);
    } catch (error) {
      console.error(`Error adding to Redis sliding window (key: ${key}):`, error);
      throw error;
    }
  }
  
  /**
   * Get data points within time range
   * @param key Redis key
   * @param startTime Start timestamp (inclusive)
   * @param endTime End timestamp (inclusive)
   * @returns Array of data points
   */
  static async getRange(
    key: string,
    startTime: number,
    endTime: number
  ): Promise<any[]> {
    try {
      const results = await redis.zrangebyscore(key, startTime, endTime);
      return results.map(r => {
        try {
          return JSON.parse(r);
        } catch (e) {
          console.error(`Error parsing Redis value for key ${key}:`, e);
          return null;
        }
      }).filter(r => r !== null);
    } catch (error) {
      console.error(`Error getting range from Redis (key: ${key}):`, error);
      return [];
    }
  }
  
  /**
   * Get latest N data points
   * @param key Redis key
   * @param count Number of items to retrieve
   * @returns Array of data points (newest first)
   */
  static async getLatest(key: string, count: number): Promise<any[]> {
    try {
      const results = await redis.zrevrange(key, 0, count - 1);
      return results.map(r => {
        try {
          return JSON.parse(r);
        } catch (e) {
          console.error(`Error parsing Redis value for key ${key}:`, e);
          return null;
        }
      }).filter(r => r !== null);
    } catch (error) {
      console.error(`Error getting latest from Redis (key: ${key}):`, error);
      return [];
    }
  }
  
  /**
   * Get all data points (use with caution - can be large)
   * @param key Redis key
   * @returns Array of all data points
   */
  static async getAll(key: string): Promise<any[]> {
    try {
      const results = await redis.zrange(key, 0, -1);
      return results.map(r => {
        try {
          return JSON.parse(r);
        } catch (e) {
          console.error(`Error parsing Redis value for key ${key}:`, e);
          return null;
        }
      }).filter(r => r !== null);
    } catch (error) {
      console.error(`Error getting all from Redis (key: ${key}):`, error);
      return [];
    }
  }
  
  /**
   * Get count of items in sliding window
   * @param key Redis key
   * @returns Number of items
   */
  static async count(key: string): Promise<number> {
    try {
      return await redis.zcard(key);
    } catch (error) {
      console.error(`Error counting Redis key ${key}:`, error);
      return 0;
    }
  }
  
  /**
   * Delete all data for a key
   * @param key Redis key
   */
  static async delete(key: string): Promise<void> {
    try {
      await redis.del(key);
    } catch (error) {
      console.error(`Error deleting Redis key ${key}:`, error);
    }
  }
  
  /**
   * Get statistics about the sliding window
   * @param key Redis key
   * @returns Statistics object
   */
  static async getStats(key: string): Promise<{
    count: number;
    oldest?: number;
    newest?: number;
  }> {
    try {
      const count = await redis.zcard(key);
      if (count === 0) {
        return { count: 0 };
      }
      
      const oldest = await redis.zrange(key, 0, 0, 'WITHSCORES');
      const newest = await redis.zrevrange(key, 0, 0, 'WITHSCORES');
      
      return {
        count,
        oldest: oldest.length > 0 ? parseFloat(oldest[1]) : undefined,
        newest: newest.length > 0 ? parseFloat(newest[1]) : undefined,
      };
    } catch (error) {
      console.error(`Error getting stats for Redis key ${key}:`, error);
      return { count: 0 };
    }
  }
}
