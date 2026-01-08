import { query } from '../config/database';
import { redis } from '../config/redis';

/**
 * Calculate liquidity score for a market
 * Higher score = more liquid
 * 
 * Factors:
 * 1. Price update frequency (last 24h) - more updates = more liquid
 * 2. Spread tightness - tighter spread = more liquid
 * 3. Recent activity - active in last hour = more liquid
 * 4. Number of outcomes with price data
 */
export async function calculateLiquidityScore(marketId: string): Promise<number> {
  try {
    // Get price history stats for last 24 hours
    const priceStats = await query(`
      SELECT 
        COUNT(*) as update_count,
        COUNT(DISTINCT outcome_id) as active_outcomes,
        AVG(ask_price - bid_price) as avg_spread,
        MAX(timestamp) as last_update
      FROM price_history
      WHERE market_id = $1 
        AND timestamp >= NOW() - INTERVAL '24 hours'
    `, [marketId]);

    if (priceStats.rows.length === 0 || !priceStats.rows[0].update_count) {
      return 0; // No recent activity = no liquidity
    }

    const stats = priceStats.rows[0];
    const updateCount = parseInt(stats.update_count, 10);
    const activeOutcomes = parseInt(stats.active_outcomes, 10);
    const avgSpread = parseFloat(stats.avg_spread || '0');
    const lastUpdate = stats.last_update;

    // Calculate components
    // 1. Update frequency score (0-40 points)
    // More updates = higher score, capped at 100 updates = 40 points
    const frequencyScore = Math.min(updateCount / 100 * 40, 40);

    // 2. Spread tightness score (0-30 points)
    // Tighter spread = higher score
    // Spread of 0.01 = 30 points, spread of 0.1 = 0 points
    const spreadScore = Math.max(0, 30 * (1 - avgSpread * 10));

    // 3. Active outcomes score (0-20 points)
    // More outcomes with data = higher score
    const outcomesScore = Math.min(activeOutcomes * 10, 20);

    // 4. Recency score (0-10 points)
    // More recent = higher score
    let recencyScore = 0;
    if (lastUpdate) {
      const hoursSinceUpdate = (Date.now() - new Date(lastUpdate).getTime()) / (1000 * 60 * 60);
      if (hoursSinceUpdate < 1) {
        recencyScore = 10; // Updated in last hour
      } else if (hoursSinceUpdate < 6) {
        recencyScore = 5; // Updated in last 6 hours
      } else if (hoursSinceUpdate < 24) {
        recencyScore = 2; // Updated in last 24 hours
      }
    }

    // Check if we have current prices in Redis (real-time activity)
    const outcomes = await query('SELECT token_id FROM outcomes WHERE market_id = $1', [marketId]);
    let redisActivityScore = 0;
    if (outcomes.rows.length > 0) {
      const redisChecks = await Promise.all(
        outcomes.rows.map(async (outcome) => {
          try {
            const key = `market:${marketId}:price:${outcome.token_id}`;
            const exists = await redis.exists(key);
            return exists ? 1 : 0;
          } catch {
            return 0;
          }
        })
      );
      const activeRedisKeys = redisChecks.reduce((sum: number, val: number) => sum + val, 0);
      redisActivityScore = Math.min((activeRedisKeys / outcomes.rows.length) * 5, 5);
    }

    const totalScore = frequencyScore + spreadScore + outcomesScore + recencyScore + redisActivityScore;

    // Normalize to 0-100 scale
    return Math.min(100, Math.round(totalScore * 10) / 10);
  } catch (error) {
    console.error(`Error calculating liquidity for market ${marketId}:`, error);
    return 0;
  }
}

/**
 * Calculate liquidity scores for multiple markets (batch)
 * More efficient than calling calculateLiquidityScore individually
 */
export async function calculateLiquidityScores(marketIds: string[]): Promise<Map<string, number>> {
  const scores = new Map<string, number>();
  
  if (marketIds.length === 0) {
    return scores;
  }

  try {
    // Get aggregated stats for all markets
    const stats = await query(`
      SELECT 
        market_id,
        COUNT(*) as update_count,
        COUNT(DISTINCT outcome_id) as active_outcomes,
        AVG(ask_price - bid_price) as avg_spread,
        MAX(timestamp) as last_update
      FROM price_history
      WHERE market_id = ANY($1)
        AND timestamp >= NOW() - INTERVAL '24 hours'
      GROUP BY market_id
    `, [marketIds]);

    // Calculate scores
    for (const stat of stats.rows) {
      const marketId = stat.market_id;
      const updateCount = parseInt(stat.update_count, 10);
      const activeOutcomes = parseInt(stat.active_outcomes, 10);
      const avgSpread = parseFloat(stat.avg_spread || '0');
      const lastUpdate = stat.last_update;

      // Same calculation as individual function
      const frequencyScore = Math.min(updateCount / 100 * 40, 40);
      const spreadScore = Math.max(0, 30 * (1 - avgSpread * 10));
      const outcomesScore = Math.min(activeOutcomes * 10, 20);

      let recencyScore = 0;
      if (lastUpdate) {
        const hoursSinceUpdate = (Date.now() - new Date(lastUpdate).getTime()) / (1000 * 60 * 60);
        if (hoursSinceUpdate < 1) recencyScore = 10;
        else if (hoursSinceUpdate < 6) recencyScore = 5;
        else if (hoursSinceUpdate < 24) recencyScore = 2;
      }

      // For batch, we'll skip Redis checks (too expensive)
      // Can add it later if needed
      const totalScore = frequencyScore + spreadScore + outcomesScore + recencyScore;
      scores.set(marketId, Math.min(100, Math.round(totalScore * 10) / 10));
    }

    // Set 0 for markets with no recent activity
    for (const marketId of marketIds) {
      if (!scores.has(marketId)) {
        scores.set(marketId, 0);
      }
    }
  } catch (error) {
    console.error('Error calculating liquidity scores:', error);
    // Return 0 for all on error
    marketIds.forEach(id => scores.set(id, 0));
  }

  return scores;
}
