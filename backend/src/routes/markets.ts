import { Router, Request, Response } from 'express';
import { apiLimiter } from '../middleware/rateLimiter';
import { query } from '../config/database';
import { Market, MarketWithOutcomes, Outcome } from '../models/Market';
import { cacheService } from '../services/cache-service';
import { redis } from '../config/redis';
import { calculateLiquidityScore } from '../utils/liquidity';

const router = Router();

// Apply rate limiting to all routes
router.use(apiLimiter);

// GET /api/markets - Paginated list with search/filter
router.get('/', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = (page - 1) * limit;
    const search = req.query.search as string;
    const category = req.query.category as string;
    const sortBy = req.query.sortBy as string || 'updated_at';

    // Check cache for top markets (only if no filters applied and page 1)
    if (!search && !category && page === 1 && sortBy === 'updated_at') {
      const cached = await cacheService.getCachedTopMarkets();
      if (cached) {
        return res.json(cached);
      }
    }

    let whereClause = 'WHERE 1=1';
    const params: unknown[] = [];
    let paramIndex = 1;

    if (search) {
      whereClause += ` AND (question ILIKE $${paramIndex} OR slug ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (category) {
      whereClause += ` AND category = $${paramIndex}`;
      params.push(category);
      paramIndex++;
    }

    let orderBy = 'ORDER BY updated_at DESC';
    if (sortBy === 'liquidity') {
      // Calculate liquidity scores and sort by them
      // We'll use a subquery to calculate liquidity based on recent price activity
      orderBy = `ORDER BY (
        SELECT COALESCE(
          (
            LEAST(COUNT(*)::numeric / 100 * 40, 40) + -- Frequency score
            GREATEST(0, 30 * (1 - AVG(ask_price - bid_price) * 10)) + -- Spread score
            LEAST(COUNT(DISTINCT outcome_id)::numeric * 10, 20) + -- Outcomes score
            CASE 
              WHEN MAX(timestamp) > NOW() - INTERVAL '1 hour' THEN 10
              WHEN MAX(timestamp) > NOW() - INTERVAL '6 hours' THEN 5
              WHEN MAX(timestamp) > NOW() - INTERVAL '24 hours' THEN 2
              ELSE 0
            END
          ) / 10,
          0
        )
        FROM price_history
        WHERE market_id = markets.id
          AND timestamp >= NOW() - INTERVAL '24 hours'
      ) DESC NULLS LAST, updated_at DESC`;
    } else if (sortBy === 'endingSoon') {
      orderBy = 'ORDER BY end_date ASC NULLS LAST';
    }

    // Get total count
    const countQuery = `SELECT COUNT(*) FROM markets ${whereClause}`;
    const countResult = await query(countQuery, params);
    const total = parseInt(countResult.rows[0].count, 10);

    // Get markets
    const marketsQuery = `
      SELECT * FROM markets 
      ${whereClause} 
      ${orderBy} 
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(limit, offset);
    const marketsResult = await query(marketsQuery, params);

    const response = {
      data: marketsResult.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };

    // Cache top markets if no filters
    if (!search && !category && page === 1 && sortBy === 'updated_at') {
      await cacheService.cacheTopMarkets(response);
    }

    return res.json(response);
  } catch (error) {
    console.error('Error fetching markets:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error details:', errorMessage);
    return res.status(500).json({ 
      error: 'Failed to fetch markets',
      details: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
    });
  }
});

// GET /api/markets/:id - Single market with current odds
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Check cache
    const cached = await cacheService.getCachedMarketDetail(id);
    if (cached) {
      return res.json(cached);
    }

    // Get market
    const marketResult = await query(
      'SELECT * FROM markets WHERE id = $1',
      [id]
    );

    if (marketResult.rows.length === 0) {
      return res.status(404).json({ error: 'Market not found' });
    }

    const market = marketResult.rows[0] as Market;

    // Get outcomes
    const outcomesResult = await query(
      'SELECT * FROM outcomes WHERE market_id = $1',
      [id]
    );

    // Get latest price for each outcome
    // First try Redis (Last Traded Price), then fallback to database
    const pricesPromises = outcomesResult.rows.map(async (outcome: Outcome) => {
      // Try Redis first for fast access
      const redisKey = `market:${id}:price:${outcome.tokenId}`;
      let currentPrice = null;
      
      try {
        const cachedPrice = await redis.get(redisKey);
        if (cachedPrice) {
          currentPrice = JSON.parse(cachedPrice);
        }
      } catch (error) {
        // Redis lookup failed, fallback to database
      }
      
      // Fallback to database if Redis doesn't have it
      if (!currentPrice) {
        const priceResult = await query(
          `SELECT * FROM price_history 
           WHERE outcome_id = $1 
           ORDER BY timestamp DESC 
           LIMIT 1`,
          [outcome.id]
        );
        if (priceResult.rows.length > 0) {
          currentPrice = priceResult.rows[0];
        }
      }
      
      return {
        ...outcome,
        currentPrice,
      };
    });

    const outcomesWithPrices = await Promise.all(pricesPromises);

    // Calculate liquidity score
    const liquidityScore = await calculateLiquidityScore(id);

    const marketWithOutcomes: MarketWithOutcomes = {
      ...market,
      outcomes: outcomesWithPrices,
      liquidityScore, // Add liquidity score to response
    };

    // Cache the result
    await cacheService.cacheMarketDetail(id, marketWithOutcomes);

    return res.json(marketWithOutcomes);
  } catch (error) {
    console.error('Error fetching market:', error);
    return res.status(500).json({ error: 'Failed to fetch market' });
  }
});

// GET /api/markets/:id/history - Time-series data for charts
router.get('/:id/history', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const timeframe = req.query.timeframe as string || '24h';
    
    // Check cache
    const cached = await cacheService.getCachedMarketHistory(id, timeframe);
    if (cached) {
      return res.json(cached);
    }
    
    let timeFilter = "timestamp >= NOW() - INTERVAL '24 hours'";
    if (timeframe === '7d') {
      timeFilter = "timestamp >= NOW() - INTERVAL '7 days'";
    } else if (timeframe === '30d') {
      timeFilter = "timestamp >= NOW() - INTERVAL '30 days'";
    }

    const historyResult = await query(
      `SELECT ph.*, o.outcome 
       FROM price_history ph
       JOIN outcomes o ON ph.outcome_id = o.id
       WHERE ph.market_id = $1 AND ${timeFilter}
       ORDER BY ph.timestamp ASC`,
      [id]
    );

    const response = {
      data: historyResult.rows,
      timeframe,
    };

    // Cache the result (longer TTL for history)
    await cacheService.cacheMarketHistory(id, timeframe, response, 60);

    return res.json(response);
  } catch (error) {
    console.error('Error fetching market history:', error);
    return res.status(500).json({ error: 'Failed to fetch market history' });
  }
});

export default router;

