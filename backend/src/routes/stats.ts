import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { apiLimiter } from '../middleware/rateLimiter';
import { redis } from '../config/redis';

const router = Router();

// Apply rate limiting
router.use(apiLimiter);

/**
 * GET /api/stats
 * Returns platform-wide statistics
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    // Get market statistics
    const marketStats = await query(`
      SELECT 
        COUNT(*) as total_markets,
        COUNT(CASE WHEN end_date IS NULL OR end_date > NOW() THEN 1 END) as active_markets,
        COUNT(CASE WHEN end_date IS NOT NULL AND end_date <= NOW() THEN 1 END) as closed_markets,
        COUNT(DISTINCT category) as total_categories
      FROM markets
    `);

    // Get outcome statistics
    const outcomeStats = await query(`
      SELECT COUNT(*) as total_outcomes
      FROM outcomes
    `);

    // Get price history statistics
    const priceStats = await query(`
      SELECT 
        COUNT(*) as total_price_records,
        COUNT(DISTINCT market_id) as markets_with_history,
        MIN(timestamp) as earliest_record,
        MAX(timestamp) as latest_record
      FROM price_history
    `);

    // Get recent activity (markets updated in last 24 hours)
    const recentActivity = await query(`
      SELECT COUNT(*) as recently_updated
      FROM markets
      WHERE updated_at >= NOW() - INTERVAL '24 hours'
    `);

    // Get Redis stats (active price caches)
    let activePriceCaches = 0;
    try {
      const keys = await redis.keys('market:*:price:*');
      activePriceCaches = keys.length;
    } catch (error) {
      // Redis might not be available, continue without it
      console.warn('Could not fetch Redis stats:', error);
    }

    const stats = {
      markets: {
        total: parseInt(marketStats.rows[0].total_markets, 10),
        active: parseInt(marketStats.rows[0].active_markets, 10),
        closed: parseInt(marketStats.rows[0].closed_markets, 10),
        categories: parseInt(marketStats.rows[0].total_categories, 10),
        recentlyUpdated: parseInt(recentActivity.rows[0].recently_updated, 10),
      },
      outcomes: {
        total: parseInt(outcomeStats.rows[0].total_outcomes, 10),
      },
      priceHistory: {
        totalRecords: parseInt(priceStats.rows[0].total_price_records, 10),
        marketsWithHistory: parseInt(priceStats.rows[0].markets_with_history, 10),
        earliestRecord: priceStats.rows[0].earliest_record,
        latestRecord: priceStats.rows[0].latest_record,
      },
      realTime: {
        activePriceCaches,
      },
      timestamp: new Date().toISOString(),
    };

    return res.json(stats);
  } catch (error) {
    console.error('Error fetching statistics:', error);
    return res.status(500).json({
      error: 'Failed to fetch statistics',
      details: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : undefined,
    });
  }
});

/**
 * GET /api/stats/markets/:id
 * Returns statistics for a specific market
 */
router.get('/markets/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Verify market exists
    const marketCheck = await query('SELECT id, question, category FROM markets WHERE id = $1', [id]);
    if (marketCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Market not found' });
    }

    const market = marketCheck.rows[0];

    // Get outcome count
    const outcomeCount = await query('SELECT COUNT(*) as count FROM outcomes WHERE market_id = $1', [id]);

    // Get price history statistics
    const priceStats = await query(`
      SELECT 
        COUNT(*) as total_records,
        COUNT(DISTINCT outcome_id) as outcomes_with_history,
        MIN(timestamp) as first_record,
        MAX(timestamp) as last_record,
        AVG(mid_price) as avg_mid_price,
        MIN(mid_price) as min_mid_price,
        MAX(mid_price) as max_mid_price,
        AVG(implied_probability) as avg_probability
      FROM price_history
      WHERE market_id = $1
    `, [id]);

    // Get recent price changes (last 24 hours)
    const recentStats = await query(`
      SELECT 
        COUNT(*) as records_24h,
        AVG(mid_price) as avg_mid_price_24h,
        MIN(mid_price) as min_mid_price_24h,
        MAX(mid_price) as max_mid_price_24h
      FROM price_history
      WHERE market_id = $1 AND timestamp >= NOW() - INTERVAL '24 hours'
    `, [id]);

    // Get price volatility (standard deviation of mid_price)
    const volatility = await query(`
      SELECT 
        STDDEV(mid_price) as price_volatility
      FROM price_history
      WHERE market_id = $1 AND timestamp >= NOW() - INTERVAL '24 hours'
    `, [id]);

    // Get current prices from Redis
    const outcomes = await query('SELECT id, token_id, outcome FROM outcomes WHERE market_id = $1', [id]);
    const currentPrices = await Promise.all(
      outcomes.rows.map(async (outcome) => {
        try {
          const redisKey = `market:${id}:price:${outcome.token_id}`;
          const cached = await redis.get(redisKey);
          if (cached) {
            return JSON.parse(cached);
          }
        } catch (error) {
          // Ignore Redis errors
        }
        return null;
      })
    );

    const hasCurrentPrice = currentPrices.some(p => p !== null);

    const stats = {
      market: {
        id: market.id,
        question: market.question,
        category: market.category,
      },
      outcomes: {
        total: parseInt(outcomeCount.rows[0].count, 10),
      },
      priceHistory: {
        totalRecords: parseInt(priceStats.rows[0].total_records, 10),
        outcomesWithHistory: parseInt(priceStats.rows[0].outcomes_with_history, 10),
        firstRecord: priceStats.rows[0].first_record,
        lastRecord: priceStats.rows[0].last_record,
        allTime: {
          avgMidPrice: priceStats.rows[0].avg_mid_price ? parseFloat(priceStats.rows[0].avg_mid_price) : null,
          minMidPrice: priceStats.rows[0].min_mid_price ? parseFloat(priceStats.rows[0].min_mid_price) : null,
          maxMidPrice: priceStats.rows[0].max_mid_price ? parseFloat(priceStats.rows[0].max_mid_price) : null,
          avgProbability: priceStats.rows[0].avg_probability ? parseFloat(priceStats.rows[0].avg_probability) : null,
        },
        last24Hours: {
          recordCount: parseInt(recentStats.rows[0].records_24h, 10),
          avgMidPrice: recentStats.rows[0].avg_mid_price_24h ? parseFloat(recentStats.rows[0].avg_mid_price_24h) : null,
          minMidPrice: recentStats.rows[0].min_mid_price_24h ? parseFloat(recentStats.rows[0].min_mid_price_24h) : null,
          maxMidPrice: recentStats.rows[0].max_mid_price_24h ? parseFloat(recentStats.rows[0].max_mid_price_24h) : null,
          volatility: volatility.rows[0].price_volatility ? parseFloat(volatility.rows[0].price_volatility) : null,
        },
      },
      realTime: {
        hasCurrentPrice,
        activeOutcomes: currentPrices.filter(p => p !== null).length,
      },
      timestamp: new Date().toISOString(),
    };

    return res.json(stats);
  } catch (error) {
    console.error('Error fetching market statistics:', error);
    return res.status(500).json({
      error: 'Failed to fetch market statistics',
      details: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : undefined,
    });
  }
});

export default router;
