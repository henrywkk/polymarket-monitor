import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { RedisSlidingWindow } from '../services/redis-storage';

const router = Router();

/**
 * GET /api/trades/:marketId
 * Get trade history for a market, grouped by outcome
 * Each outcome has its own orderbook and trades (identified by token_id/assetId)
 */
router.get('/:marketId', async (req: Request, res: Response) => {
  try {
    const { marketId } = req.params;
    const { limit = '100', groupBy = 'outcome' } = req.query;
    const limitNum = parseInt(String(limit), 10);
    const shouldGroup = groupBy === 'outcome';
    
    // Get outcome token IDs for this market
    const outcomes = await query(
      'SELECT id, token_id, outcome FROM outcomes WHERE market_id = $1 ORDER BY outcome',
      [marketId]
    );
    
    if (outcomes.rows.length === 0) {
      return res.json({ 
        data: shouldGroup ? {} : [],
        byOutcome: {},
        message: 'No outcomes found for this market'
      });
    }
    
    // Get trades from Redis for each outcome (each outcome has its own token_id/assetId)
    const tradesByOutcome: Record<string, any[]> = {};
    const allTrades: any[] = [];
    
    for (const outcome of outcomes.rows) {
      // Each outcome has its own token_id, so trades are stored per outcome
      const trades = await RedisSlidingWindow.getLatest(
        `trades:${outcome.token_id}`, // Key is per token_id (which is per outcome)
        limitNum
      );
      
      const enrichedTrades = trades.map(t => ({
        ...t,
        tokenId: outcome.token_id,
        outcomeId: outcome.id,
        outcomeName: outcome.outcome,
      }));
      
      if (shouldGroup) {
        tradesByOutcome[outcome.outcome] = enrichedTrades;
      } else {
        allTrades.push(...enrichedTrades);
      }
    }
    
    // If not grouping, sort all trades by timestamp descending
    if (!shouldGroup) {
      allTrades.sort((a, b) => b.timestamp - a.timestamp);
    }
    
    // Get stats per outcome
    const statsByOutcome: Record<string, any> = {};
    for (const outcome of outcomes.rows) {
      const stats = await RedisSlidingWindow.getStats(`trades:${outcome.token_id}`);
      statsByOutcome[outcome.outcome] = {
        ...stats,
        tokenId: outcome.token_id,
        outcomeId: outcome.id,
      };
    }
    
    return res.json({
      data: shouldGroup ? tradesByOutcome : allTrades.slice(0, limitNum),
      byOutcome: tradesByOutcome, // Always include grouped view
      stats: {
        totalTrades: allTrades.length,
        oldestTrade: allTrades.length > 0 ? Math.min(...allTrades.map(t => t.timestamp)) : null,
        newestTrade: allTrades.length > 0 ? Math.max(...allTrades.map(t => t.timestamp)) : null,
        byOutcome: statsByOutcome,
      },
      outcomes: outcomes.rows.map(o => ({
        outcomeId: o.id,
        outcomeName: o.outcome,
        tokenId: o.token_id,
      })),
    });
  } catch (error) {
    console.error('Error fetching trade history:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch trade history',
      details: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : undefined,
    });
  }
});

/**
 * GET /api/trades/:marketId/stats
 * Get trade statistics for a market, grouped by outcome
 * Each outcome has its own trade statistics
 */
router.get('/:marketId/stats', async (req: Request, res: Response) => {
  try {
    const { marketId } = req.params;
    
    // Get outcome token IDs for this market
    const outcomes = await query(
      'SELECT id, token_id, outcome FROM outcomes WHERE market_id = $1 ORDER BY outcome',
      [marketId]
    );
    
    if (outcomes.rows.length === 0) {
      return res.json({ 
        stats: {},
        byOutcome: {},
        message: 'No outcomes found for this market'
      });
    }
    
    // Get trade stats for each outcome (each outcome has its own token_id)
    const statsByOutcome: Record<string, any> = {};
    const allStats: any[] = [];
    
    for (const outcome of outcomes.rows) {
      // Each outcome has its own token_id, so trades are stored per outcome
      const trades = await RedisSlidingWindow.getLatest(
        `trades:${outcome.token_id}`, // Key is per token_id (which is per outcome)
        1000 // Get all available trades
      );
      
      if (trades.length > 0) {
        const totalVolume = trades.reduce((sum, t) => sum + (t.size || 0), 0);
        const avgPrice = trades.reduce((sum, t) => sum + (t.price || 0), 0) / trades.length;
        const whaleTrades = trades.filter(t => (t.size || 0) >= 10000);
        
        const outcomeStats = {
          outcomeId: outcome.id,
          outcomeName: outcome.outcome,
          tokenId: outcome.token_id,
          tradeCount: trades.length,
          totalVolume,
          avgPrice,
          whaleTradeCount: whaleTrades.length,
          largestTrade: trades.length > 0 ? Math.max(...trades.map(t => t.size || 0)) : 0,
        };
        
        statsByOutcome[outcome.outcome] = outcomeStats;
        allStats.push(outcomeStats);
      } else {
        // Include outcome even if no trades
        statsByOutcome[outcome.outcome] = {
          outcomeId: outcome.id,
          outcomeName: outcome.outcome,
          tokenId: outcome.token_id,
          tradeCount: 0,
          totalVolume: 0,
          avgPrice: 0,
          whaleTradeCount: 0,
          largestTrade: 0,
        };
      }
    }
    
    return res.json({
      stats: allStats,
      byOutcome: statsByOutcome, // Grouped by outcome name
    });
  } catch (error) {
    console.error('Error fetching trade stats:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch trade stats',
      details: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : undefined,
    });
  }
});

/**
 * GET /api/trades/orderbook/:marketId
 * Get orderbook metrics for a market, grouped by outcome
 * Each outcome has its own orderbook (identified by token_id/assetId)
 */
router.get('/orderbook/:marketId', async (req: Request, res: Response) => {
  try {
    const { marketId } = req.params;
    const { limit = '100', groupBy = 'outcome' } = req.query;
    const limitNum = parseInt(String(limit), 10);
    const shouldGroup = groupBy === 'outcome';
    
    // Get outcome token IDs for this market
    const outcomes = await query(
      'SELECT id, token_id, outcome FROM outcomes WHERE market_id = $1 ORDER BY outcome',
      [marketId]
    );
    
    if (outcomes.rows.length === 0) {
      return res.json({ 
        data: shouldGroup ? {} : [],
        byOutcome: {},
        latest: {},
        message: 'No outcomes found for this market'
      });
    }
    
    // Get orderbook metrics from Redis for each outcome (each outcome has its own token_id)
    const metricsByOutcome: Record<string, any[]> = {};
    const latestByOutcome: Record<string, any> = {};
    const allMetrics: any[] = [];
    
    for (const outcome of outcomes.rows) {
      // Each outcome has its own token_id, so orderbook is stored per outcome
      const metrics = await RedisSlidingWindow.getLatest(
        `orderbook:${outcome.token_id}`, // Key is per token_id (which is per outcome)
        limitNum
      );
      
      const enrichedMetrics = metrics.map(m => ({
        ...m,
        tokenId: outcome.token_id,
        outcomeId: outcome.id,
        outcomeName: outcome.outcome,
      }));
      
      if (shouldGroup) {
        metricsByOutcome[outcome.outcome] = enrichedMetrics;
        latestByOutcome[outcome.outcome] = enrichedMetrics.length > 0 ? enrichedMetrics[0] : null;
      } else {
        allMetrics.push(...enrichedMetrics);
      }
    }
    
    // If not grouping, sort all metrics by timestamp descending
    if (!shouldGroup) {
      allMetrics.sort((a, b) => b.timestamp - a.timestamp);
    }
    
    // Get latest metrics across all outcomes
    const latest = allMetrics.length > 0 ? allMetrics[0] : null;
    
    return res.json({
      data: shouldGroup ? metricsByOutcome : allMetrics.slice(0, limitNum),
      byOutcome: metricsByOutcome, // Always include grouped view
      latest: shouldGroup ? latestByOutcome : latest,
      outcomes: outcomes.rows.map(o => ({
        outcomeId: o.id,
        outcomeName: o.outcome,
        tokenId: o.token_id,
      })),
    });
  } catch (error) {
    console.error('Error fetching orderbook metrics:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch orderbook metrics',
      details: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : undefined,
    });
  }
});

/**
 * GET /api/trades/orderbook/:marketId/:outcomeId
 * Get orderbook metrics for a specific outcome
 */
router.get('/orderbook/:marketId/:outcomeId', async (req: Request, res: Response) => {
  try {
    const { marketId, outcomeId } = req.params;
    const { limit = '100' } = req.query;
    const limitNum = parseInt(String(limit), 10);
    
    // Get the specific outcome
    const outcomeResult = await query(
      'SELECT id, token_id, outcome FROM outcomes WHERE id = $1 AND market_id = $2',
      [outcomeId, marketId]
    );
    
    if (outcomeResult.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Outcome not found',
        message: `Outcome ${outcomeId} not found for market ${marketId}`
      });
    }
    
    const outcome = outcomeResult.rows[0];
    
    // Get orderbook metrics for this specific outcome
    const metrics = await RedisSlidingWindow.getLatest(
      `orderbook:${outcome.token_id}`, // Key is per token_id (which is per outcome)
      limitNum
    );
    
    const enrichedMetrics = metrics.map(m => ({
      ...m,
      tokenId: outcome.token_id,
      outcomeId: outcome.id,
      outcomeName: outcome.outcome,
    }));
    
    return res.json({
      outcome: {
        outcomeId: outcome.id,
        outcomeName: outcome.outcome,
        tokenId: outcome.token_id,
      },
      data: enrichedMetrics,
      latest: enrichedMetrics.length > 0 ? enrichedMetrics[0] : null,
      stats: await RedisSlidingWindow.getStats(`orderbook:${outcome.token_id}`),
    });
  } catch (error) {
    console.error('Error fetching orderbook metrics for outcome:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch orderbook metrics',
      details: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : undefined,
    });
  }
});

export default router;
