import redis from '../config/redis';

const CACHE_TTL = 30; // 30 seconds
const TOP_MARKETS_KEY = 'top_markets';
const MARKET_DETAIL_KEY = (id: string) => `market:${id}`;
const MARKET_HISTORY_KEY = (id: string, timeframe: string) =>
  `market_history:${id}:${timeframe}`;

export class CacheService {
  /**
   * Cache top markets list
   */
  async cacheTopMarkets(data: unknown, ttl: number = CACHE_TTL): Promise<void> {
    try {
      await redis.setex(
        TOP_MARKETS_KEY,
        ttl,
        JSON.stringify(data)
      );
    } catch (error) {
      console.error('Error caching top markets:', error);
    }
  }

  /**
   * Get cached top markets
   */
  async getCachedTopMarkets(): Promise<unknown | null> {
    try {
      const cached = await redis.get(TOP_MARKETS_KEY);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      console.error('Error getting cached top markets:', error);
      return null;
    }
  }

  /**
   * Cache market detail
   */
  async cacheMarketDetail(
    id: string,
    data: unknown,
    ttl: number = CACHE_TTL
  ): Promise<void> {
    try {
      await redis.setex(MARKET_DETAIL_KEY(id), ttl, JSON.stringify(data));
    } catch (error) {
      console.error(`Error caching market detail ${id}:`, error);
    }
  }

  /**
   * Get cached market detail
   */
  async getCachedMarketDetail(id: string): Promise<unknown | null> {
    try {
      const cached = await redis.get(MARKET_DETAIL_KEY(id));
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      console.error(`Error getting cached market detail ${id}:`, error);
      return null;
    }
  }

  /**
   * Cache market history
   */
  async cacheMarketHistory(
    id: string,
    timeframe: string,
    data: unknown,
    ttl: number = 60
  ): Promise<void> {
    try {
      await redis.setex(
        MARKET_HISTORY_KEY(id, timeframe),
        ttl,
        JSON.stringify(data)
      );
    } catch (error) {
      console.error(`Error caching market history ${id}:`, error);
    }
  }

  /**
   * Get cached market history
   */
  async getCachedMarketHistory(
    id: string,
    timeframe: string
  ): Promise<unknown | null> {
    try {
      const cached = await redis.get(MARKET_HISTORY_KEY(id, timeframe));
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      console.error(`Error getting cached market history ${id}:`, error);
      return null;
    }
  }

  /**
   * Invalidate cache for a market
   */
  async invalidateMarket(id: string): Promise<void> {
    try {
      await redis.del(MARKET_DETAIL_KEY(id));
      // Also invalidate top markets cache since it might include this market
      await redis.del(TOP_MARKETS_KEY);
    } catch (error) {
      console.error(`Error invalidating cache for market ${id}:`, error);
    }
  }

  /**
   * Clear all caches (use with caution)
   */
  async clearAll(): Promise<void> {
    try {
      const keys = await redis.keys('market:*');
      const topMarketsKey = await redis.keys(TOP_MARKETS_KEY);
      const allKeys = [...keys, ...topMarketsKey];
      if (allKeys.length > 0) {
        await redis.del(...allKeys);
      }
    } catch (error) {
      console.error('Error clearing cache:', error);
    }
  }
}

export const cacheService = new CacheService();

