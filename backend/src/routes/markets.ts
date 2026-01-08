import { Router, Request, Response } from 'express';
import { apiLimiter } from '../middleware/rateLimiter';
import { query } from '../config/database';
import { Market, MarketWithOutcomes, Outcome } from '../models/Market';
import { cacheService } from '../services/cache-service';
import { redis } from '../config/redis';

const router = Router();

// Apply rate limiting to all routes
router.use(apiLimiter);

// GET /api/markets/trending - Most active/volatile markets (last 24h)
router.get('/trending', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const timeframe = req.query.timeframe as string || '24h';

    let timeFilter = "timestamp >= NOW() - INTERVAL '24 hours'";
    if (timeframe === '7d') {
      timeFilter = "timestamp >= NOW() - INTERVAL '7 days'";
    } else if (timeframe === '1h') {
      timeFilter = "timestamp >= NOW() - INTERVAL '1 hour'";
    }

    // Calculate trending score based on:
    // 1. Price volatility (standard deviation)
    // 2. Update frequency
    // 3. Price change magnitude
    const trendingQuery = `
      SELECT 
        m.id,
        m.question,
        m.slug,
        m.category,
        m.end_date,
        m.image_url,
        m.created_at,
        m.updated_at,
        COUNT(ph.id) as update_count,
        STDDEV(ph.mid_price) as volatility,
        MAX(ph.mid_price) - MIN(ph.mid_price) as price_range,
        MAX(ph.timestamp) as last_update,
        AVG(ph.mid_price) as avg_price
      FROM markets m
      INNER JOIN price_history ph ON m.id = ph.market_id
      WHERE ${timeFilter}
        AND (m.end_date IS NULL OR m.end_date > NOW())
      GROUP BY m.id, m.question, m.slug, m.category, m.end_date, m.image_url, m.created_at, m.updated_at
      HAVING COUNT(ph.id) >= 5 -- At least 5 updates to be considered trending
      ORDER BY 
        (STDDEV(ph.mid_price) * COUNT(ph.id)) DESC, -- Volatility * frequency
        COUNT(ph.id) DESC, -- Then by update count
        MAX(ph.timestamp) DESC -- Then by recency
      LIMIT $1
    `;

    const result = await query(trendingQuery, [limit]);
    
    // Enrich with current prices from Redis
    const marketsWithPrices = await Promise.all(
      result.rows.map(async (market) => {
        const outcomes = await query(
          'SELECT token_id FROM outcomes WHERE market_id = $1 LIMIT 1',
          [market.id]
        );
        
        let currentPrice = null;
        if (outcomes.rows.length > 0) {
          try {
            const redisKey = `market:${market.id}:price:${outcomes.rows[0].token_id}`;
            const cached = await redis.get(redisKey);
            if (cached) {
              currentPrice = JSON.parse(cached);
            }
          } catch (error) {
            // Ignore Redis errors
          }
        }

        return {
          ...market,
          updateCount: parseInt(market.update_count, 10),
          volatility: market.volatility ? parseFloat(market.volatility) : 0,
          priceRange: market.price_range ? parseFloat(market.price_range) : 0,
          avgPrice: market.avg_price ? parseFloat(market.avg_price) : null,
          currentPrice,
          trendingScore: market.volatility 
            ? parseFloat(market.volatility) * parseInt(market.update_count, 10)
            : 0,
        };
      })
    );

    return res.json({
      data: marketsWithPrices,
      timeframe,
      limit,
    });
  } catch (error) {
    console.error('Error fetching trending markets:', error);
    return res.status(500).json({
      error: 'Failed to fetch trending markets',
      details: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : undefined,
    });
  }
});

// GET /api/markets/top - Top markets by liquidity/activity
router.get('/top', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const sortBy = req.query.sortBy as string || 'liquidity'; // 'liquidity' or 'activity'

    let orderClause = '';
    if (sortBy === 'activity') {
      // Sort by recent update frequency
      orderClause = `
        ORDER BY (
          SELECT COUNT(*)
          FROM price_history
          WHERE market_id = m.id
            AND timestamp >= NOW() - INTERVAL '24 hours'
        ) DESC,
        m.updated_at DESC
      `;
    } else {
      // Sort by liquidity score (default)
      orderClause = `
        ORDER BY (
          SELECT COALESCE(
            (
              LEAST(COUNT(*)::numeric / 100 * 40, 40) +
              GREATEST(0, 30 * (1 - AVG(ask_price - bid_price) * 10)) +
              LEAST(COUNT(DISTINCT outcome_id)::numeric * 10, 20) +
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
          WHERE market_id = m.id
            AND timestamp >= NOW() - INTERVAL '24 hours'
        ) DESC NULLS LAST,
        m.updated_at DESC
      `;
    }

    const topMarketsQuery = `
      SELECT 
        m.*,
        (
          SELECT COUNT(*)
          FROM price_history
          WHERE market_id = m.id
            AND timestamp >= NOW() - INTERVAL '24 hours'
        ) as recent_updates
      FROM markets m
      WHERE (m.end_date IS NULL OR m.end_date > NOW())
      ${orderClause}
      LIMIT $1
    `;

    const result = await query(topMarketsQuery, [limit]);

    // Calculate liquidity scores for top markets
    const marketIds = result.rows.map((row: Market) => row.id);
    const { calculateLiquidityScores } = await import('../utils/liquidity');
    const liquidityScores = await calculateLiquidityScores(marketIds);

    // Enrich with prices and liquidity scores
    const marketsWithData = await Promise.all(
      result.rows.map(async (market: Market) => {
        const outcomes = await query(
          'SELECT token_id FROM outcomes WHERE market_id = $1 LIMIT 1',
          [market.id]
        );
        
        let currentPrice = null;
        if (outcomes.rows.length > 0) {
          try {
            const redisKey = `market:${market.id}:price:${outcomes.rows[0].token_id}`;
            const cached = await redis.get(redisKey);
            if (cached) {
              currentPrice = JSON.parse(cached);
            }
          } catch (error) {
            // Ignore Redis errors
          }
        }

        return {
          ...market,
          liquidityScore: liquidityScores.get(market.id) || 0,
          recentUpdates: parseInt((market as any).recent_updates, 10),
          currentPrice,
        };
      })
    );

    return res.json({
      data: marketsWithData,
      sortBy,
      limit,
    });
  } catch (error) {
    console.error('Error fetching top markets:', error);
    return res.status(500).json({
      error: 'Failed to fetch top markets',
      details: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : undefined,
    });
  }
});

// GET /api/markets/ending-soon - Markets closing in the near future
router.get('/ending-soon', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const hours = Math.min(Math.max(parseInt(req.query.hours as string) || 48, 1), 168); // Default: 48 hours, max 7 days

    // Use parameterized query to prevent SQL injection
    // PostgreSQL requires casting the numeric value to interval
    const endingSoonQuery = `
      SELECT *
      FROM markets
      WHERE end_date IS NOT NULL
        AND end_date > NOW()
        AND end_date <= NOW() + ($1::text || ' hours')::INTERVAL
      ORDER BY end_date ASC
      LIMIT $2
    `;

    const result = await query(endingSoonQuery, [hours.toString(), limit]);

    // Enrich with current prices and liquidity
    const marketIds = result.rows.map((row: Market) => row.id);
    const { calculateLiquidityScores } = await import('../utils/liquidity');
    const liquidityScores = await calculateLiquidityScores(marketIds);

    const marketsWithData = await Promise.all(
      result.rows.map(async (market: Market) => {
        const outcomes = await query(
          'SELECT token_id FROM outcomes WHERE market_id = $1 LIMIT 1',
          [market.id]
        );
        
        let currentPrice = null;
        if (outcomes.rows.length > 0) {
          try {
            const redisKey = `market:${market.id}:price:${outcomes.rows[0].token_id}`;
            const cached = await redis.get(redisKey);
            if (cached) {
              currentPrice = JSON.parse(cached);
            }
          } catch (error) {
            // Ignore Redis errors
          }
        }

        // Calculate hours until end
        const hoursUntilEnd = market.endDate
          ? Math.round((new Date(market.endDate).getTime() - Date.now()) / (1000 * 60 * 60))
          : null;

        return {
          ...market,
          liquidityScore: liquidityScores.get(market.id) || 0,
          currentPrice,
          hoursUntilEnd,
        };
      })
    );

    return res.json({
      data: marketsWithData,
      hours,
      limit,
    });
  } catch (error) {
    console.error('Error fetching ending soon markets:', error);
    return res.status(500).json({
      error: 'Failed to fetch ending soon markets',
      details: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : undefined,
    });
  }
});

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
      // Use the dynamic liquidity calculation for sorting
      // This matches our internal calculateLiquidityScores logic
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
    } else if (sortBy === 'volume') {
      orderBy = 'ORDER BY volume DESC NULLS LAST';
    } else if (sortBy === 'volume24h') {
      orderBy = 'ORDER BY volume_24h DESC NULLS LAST';
    } else if (sortBy === 'activity') {
      orderBy = 'ORDER BY activity_score DESC NULLS LAST, volume_24h DESC NULLS LAST';
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

    // Calculate our better internal liquidity scores for the current page
    const marketIds = marketsResult.rows.map((row: any) => row.id);
    const { calculateLiquidityScores } = await import('../utils/liquidity');
    const internalLiquidityScores = await calculateLiquidityScores(marketIds);

    // Get last updated time for each market from price_history
    const lastUpdateResult = await query(`
      SELECT market_id, MAX(timestamp) as last_update
      FROM price_history
      WHERE market_id = ANY($1)
      GROUP BY market_id
    `, [marketIds]);
    
    const lastUpdates = new Map<string, string>();
    for (const row of lastUpdateResult.rows) {
      lastUpdates.set(row.market_id, row.last_update);
    }

    // Helper function to check if outcome looks like a bucket (continuous range)
    const isBucketOutcome = (outcome: string): boolean => {
      const lower = outcome.toLowerCase();
      return (lower.includes('%') || lower.includes('-') || lower.includes('<') || lower.includes('>')) &&
             !['yes', 'no', 'true', 'false', '1', '0'].includes(lower);
    };

    // Helper function to parse outcome midpoint for expected value calculation
    const parseOutcomeMidpoint = (outcome: string): number | null => {
      const trimmed = outcome.trim();
      
      // Range patterns like "0.5-1.0%" or "2.0–2.5%"
      const rangeMatch = trimmed.match(/^([\d.]+)\s*[–-]\s*([\d.]+)\s*%?$/);
      if (rangeMatch) {
        const min = parseFloat(rangeMatch[1]);
        const max = parseFloat(rangeMatch[2]);
        if (!isNaN(min) && !isNaN(max)) {
          return (min + max) / 2;
        }
      }
      
      // Less-than patterns like "<0.5%"
      const lessThanMatch = trimmed.match(/^<\s*([\d.]+)\s*%?$/);
      if (lessThanMatch) {
        const value = parseFloat(lessThanMatch[1]);
        if (!isNaN(value)) {
          return value / 2;
        }
      }
      
      // Greater-than patterns like ">2.5%"
      const greaterThanMatch = trimmed.match(/^>\s*([\d.]+)\s*%?$/);
      if (greaterThanMatch) {
        const value = parseFloat(greaterThanMatch[1]);
        if (!isNaN(value)) {
          return value + 1.0; // Conservative estimate
        }
      }
      
      return null;
    };

    // Enrich markets with current prices and calculate display probability
    const marketsWithPrices = await Promise.all(
      marketsResult.rows.map(async (market: Market) => {
        // Get all outcomes with their prices
        const allOutcomes = await query(
          'SELECT id, token_id, outcome FROM outcomes WHERE market_id = $1',
          [market.id]
        );
        
        // Get prices for all outcomes
        const outcomesWithPrices: Array<{
          id: string;
          token_id: string;
          outcome: string;
          currentPrice: any;
        }> = [];
        
        for (const outcome of allOutcomes.rows) {
          let currentPrice = null;
          try {
            const redisKey = `market:${market.id}:price:${outcome.token_id}`;
            const cached = await redis.get(redisKey);
            if (cached) {
              const priceData = JSON.parse(cached);
              currentPrice = {
                bid_price: priceData.bid,
                ask_price: priceData.ask,
                mid_price: priceData.mid,
                implied_probability: priceData.probability,
              };
            }
          } catch (error) {
            // Ignore Redis errors
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
              currentPrice = {
                bid_price: priceResult.rows[0].bid_price,
                ask_price: priceResult.rows[0].ask_price,
                mid_price: priceResult.rows[0].mid_price,
                implied_probability: priceResult.rows[0].implied_probability,
              };
            }
          }
          
          if (currentPrice) {
            outcomesWithPrices.push({
              id: outcome.id,
              token_id: outcome.token_id,
              outcome: outcome.outcome,
              currentPrice,
            });
          }
        }

        // Determine if this is a bucket market (continuous outcomes)
        const hasBucketOutcomes = outcomesWithPrices.some(o => isBucketOutcome(o.outcome));
        const isBinaryMarket = outcomesWithPrices.length === 2 && 
          outcomesWithPrices.some(o => ['yes', 'no', 'true', 'false', '1', '0'].includes(o.outcome.toLowerCase()));

        // Calculate display probability
        let probabilityDisplay: { type: 'expectedValue' | 'highestProbability'; value: number; outcome?: string } | null = null;
        let currentPrice = null;

        if (hasBucketOutcomes && !isBinaryMarket) {
          // Calculate expected value for bucket markets
          let totalExpected = 0;
          let hasValidData = false;
          
          for (const outcome of outcomesWithPrices) {
            const probability = outcome.currentPrice?.implied_probability;
            if (probability === undefined || probability === null) continue;
            
            const midpoint = parseOutcomeMidpoint(outcome.outcome);
            if (midpoint === null) continue;
            
            const probDecimal = probability / 100;
            totalExpected += midpoint * probDecimal;
            hasValidData = true;
          }
          
          if (hasValidData) {
            probabilityDisplay = {
              type: 'expectedValue',
              value: totalExpected,
            };
            // Use the outcome with highest probability for currentPrice (for backward compatibility)
            const highestProbOutcome = outcomesWithPrices.reduce((max, o) => 
              (o.currentPrice?.implied_probability || 0) > (max.currentPrice?.implied_probability || 0) ? o : max
            );
            currentPrice = highestProbOutcome.currentPrice;
          }
        } else {
          // For discrete markets, find highest probability outcome
          if (outcomesWithPrices.length > 0) {
            const highestProbOutcome = outcomesWithPrices.reduce((max, o) => 
              (o.currentPrice?.implied_probability || 0) > (max.currentPrice?.implied_probability || 0) ? o : max
            );
            
            if (highestProbOutcome.currentPrice?.implied_probability !== undefined) {
              probabilityDisplay = {
                type: 'highestProbability',
                value: highestProbOutcome.currentPrice.implied_probability,
                outcome: highestProbOutcome.outcome,
              };
              currentPrice = highestProbOutcome.currentPrice;
            }
          }
        }

        // Fallback: use first outcome if no probability display calculated
        if (!currentPrice && outcomesWithPrices.length > 0) {
          currentPrice = outcomesWithPrices[0].currentPrice;
        }

        return {
          ...market,
          currentPrice,
          probabilityDisplay,
          liquidityScore: internalLiquidityScores.get(market.id) || 0, // Use our better internal score
          volume: (market as any).volume || 0,
          volume24h: (market as any).volume_24h || 0,
          lastTradeAt: lastUpdates.get(market.id) || market.updatedAt,
        };
      })
    );

    const response = {
      data: marketsWithPrices,
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

    // Get outcomes - prioritize "Yes" outcome for Yes/No markets
    const outcomesResult = await query(
      `SELECT * FROM outcomes WHERE market_id = $1 
       ORDER BY CASE WHEN LOWER(outcome) IN ('yes', 'true', '1') THEN 0 ELSE 1 END, id`,
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
          const priceData = JSON.parse(cachedPrice);
          // Normalize Redis price format to match database format
          currentPrice = {
            bid_price: priceData.bid || priceData.bid_price,
            ask_price: priceData.ask || priceData.ask_price,
            mid_price: priceData.mid || priceData.mid_price,
            implied_probability: priceData.probability || priceData.implied_probability,
          };
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
          const priceRow = priceResult.rows[0];
          currentPrice = {
            bid_price: priceRow.bid_price,
            ask_price: priceRow.ask_price,
            mid_price: priceRow.mid_price,
            implied_probability: priceRow.implied_probability,
          };
        }
      }
      
      return {
        ...outcome,
        currentPrice,
      };
    });

    const outcomesWithPrices = await Promise.all(pricesPromises);

    const marketWithOutcomes: MarketWithOutcomes = {
      ...market,
      outcomes: outcomesWithPrices,
      liquidityScore: (market as any).liquidity || 0,
      volume: (market as any).volume || 0,
      volume24h: (market as any).volume_24h || 0,
      lastTradeAt: (market as any).last_trade_at,
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

