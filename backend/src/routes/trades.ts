import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { RedisSlidingWindow } from '../services/redis-storage';

const router = Router();

/**
 * GET /api/trades/:marketId
 * Get trade history for a market
 */
router.get('/:marketId', async (req: Request, res: Response) => {
  try {
    const { marketId } = req.params;
    const { limit = '100' } = req.query;
    const limitNum = parseInt(String(limit), 10);
    
    // Get outcome token IDs for this market
    const outcomes = await query(
      'SELECT id, token_id, outcome FROM outcomes WHERE market_id = $1',
      [marketId]
    );
    
    if (outcomes.rows.length === 0) {
      return res.json({ 
        data: [],
        message: 'No outcomes found for this market'
      });
    }
    
    // Get trades from Redis for all outcomes
    const allTrades: any[] = [];
    for (const outcome of outcomes.rows) {
      const trades = await RedisSlidingWindow.getLatest(
        `trades:${outcome.token_id}`,
        limitNum
      );
      allTrades.push(...trades.map(t => ({
        ...t,
        tokenId: outcome.token_id,
        outcomeId: outcome.id,
        outcomeName: outcome.outcome,
      })));
    }
    
    // Sort by timestamp descending
    allTrades.sort((a, b) => b.timestamp - a.timestamp);
    
    // Get stats
    const stats = await RedisSlidingWindow.getStats(`trades:${outcomes.rows[0].token_id}`);
    
    return res.json({
      data: allTrades.slice(0, limitNum),
      stats: {
        totalTrades: allTrades.length,
        oldestTrade: allTrades.length > 0 ? Math.min(...allTrades.map(t => t.timestamp)) : null,
        newestTrade: allTrades.length > 0 ? Math.max(...allTrades.map(t => t.timestamp)) : null,
        redisStats: stats,
      },
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
 * Get trade statistics for a market
 */
router.get('/:marketId/stats', async (req: Request, res: Response) => {
  try {
    const { marketId } = req.params;
    
    // Get outcome token IDs for this market
    const outcomes = await query(
      'SELECT token_id FROM outcomes WHERE market_id = $1',
      [marketId]
    );
    
    if (outcomes.rows.length === 0) {
      return res.json({ 
        stats: {},
        message: 'No outcomes found for this market'
      });
    }
    
    // Get trade stats for all outcomes
    const allStats: any[] = [];
    for (const outcome of outcomes.rows) {
      const trades = await RedisSlidingWindow.getLatest(
        `trades:${outcome.token_id}`,
        1000 // Get all available trades
      );
      
      if (trades.length > 0) {
        const totalVolume = trades.reduce((sum, t) => sum + (t.size || 0), 0);
        const avgPrice = trades.reduce((sum, t) => sum + (t.price || 0), 0) / trades.length;
        const whaleTrades = trades.filter(t => (t.size || 0) >= 10000);
        
        allStats.push({
          tokenId: outcome.token_id,
          tradeCount: trades.length,
          totalVolume,
          avgPrice,
          whaleTradeCount: whaleTrades.length,
          largestTrade: trades.length > 0 ? Math.max(...trades.map(t => t.size || 0)) : 0,
        });
      }
    }
    
    return res.json({
      stats: allStats,
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
 * GET /api/orderbook/:marketId
 * Get orderbook metrics for a market
 */
router.get('/orderbook/:marketId', async (req: Request, res: Response) => {
  try {
    const { marketId } = req.params;
    const { limit = '100' } = req.query;
    const limitNum = parseInt(String(limit), 10);
    
    // Get outcome token IDs for this market
    const outcomes = await query(
      'SELECT id, token_id, outcome FROM outcomes WHERE market_id = $1',
      [marketId]
    );
    
    if (outcomes.rows.length === 0) {
      return res.json({ 
        data: [],
        message: 'No outcomes found for this market'
      });
    }
    
    // Get orderbook metrics from Redis for all outcomes
    const allMetrics: any[] = [];
    for (const outcome of outcomes.rows) {
      const metrics = await RedisSlidingWindow.getLatest(
        `orderbook:${outcome.token_id}`,
        limitNum
      );
      allMetrics.push(...metrics.map(m => ({
        ...m,
        tokenId: outcome.token_id,
        outcomeId: outcome.id,
        outcomeName: outcome.outcome,
      })));
    }
    
    // Sort by timestamp descending
    allMetrics.sort((a, b) => b.timestamp - a.timestamp);
    
    // Get latest metrics
    const latest = allMetrics.length > 0 ? allMetrics[0] : null;
    
    return res.json({
      data: allMetrics.slice(0, limitNum),
      latest,
    });
  } catch (error) {
    console.error('Error fetching orderbook metrics:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch orderbook metrics',
      details: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : undefined,
    });
  }
});

export default router;
