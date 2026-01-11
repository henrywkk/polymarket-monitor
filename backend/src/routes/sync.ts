import { Router, Request, Response } from 'express';
import { strictLimiter } from '../middleware/rateLimiter';
import { PolymarketRestClient } from '../services/polymarket-rest';
import { MarketIngestionService } from '../services/market-ingestion';
import { query } from '../config/database';

const router = Router();

// Store sync service reference (set from index.ts)
let syncServiceRef: { syncMarkets: (limit: number) => Promise<number>; syncMarket: (market: any) => Promise<void> } | undefined;
let restClientRef: PolymarketRestClient | undefined;
let marketIngestionRef: MarketIngestionService | undefined;

export const setSyncService = (service: { syncMarkets: (limit: number) => Promise<number>; syncMarket: (market: any) => Promise<void> }) => {
  syncServiceRef = service;
};

export const setRestClient = (client: PolymarketRestClient) => {
  restClientRef = client;
};

export const setMarketIngestion = (service: MarketIngestionService) => {
  marketIngestionRef = service;
};

// POST /api/sync - Manually trigger market sync
router.post('/', strictLimiter, async (_req: Request, res: Response) => {
  try {
    if (!syncServiceRef) {
      return res.status(503).json({ error: 'Sync service not available' });
    }

    const limit = parseInt(_req.body.limit as string) || 100;
    const synced = await syncServiceRef.syncMarkets(limit);

    return res.json({
      success: true,
      synced,
      message: `Successfully synced ${synced} markets`,
    });
  } catch (error) {
    console.error('Error syncing markets:', error);
    return res.status(500).json({
      error: 'Failed to sync markets',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// POST /api/sync/by-id/:id - Sync a specific market by ID or slug
router.post('/by-id/:id', strictLimiter, async (req: Request, res: Response) => {
  try {
    if (!syncServiceRef || !restClientRef) {
      return res.status(503).json({ error: 'Sync service or REST client not available' });
    }

    const marketId = req.params.id;
    console.log(`[Manual Sync] Fetching market: ${marketId}`);

    // Fetch market from API
    const pmMarket = await restClientRef.fetchMarket(marketId);
    
    if (!pmMarket) {
      return res.status(404).json({
        error: 'Market not found',
        message: `Could not fetch market with ID/slug: ${marketId}`,
      });
    }

    // Sync the market
    await syncServiceRef.syncMarket(pmMarket);

    return res.json({
      success: true,
      message: `Successfully synced market: ${pmMarket.question || marketId}`,
      market: {
        id: pmMarket.conditionId || pmMarket.questionId || pmMarket.id,
        slug: pmMarket.slug,
        question: pmMarket.question,
      },
    });
  } catch (error) {
    console.error('Error syncing market by ID:', error);
    return res.status(500).json({
      error: 'Failed to sync market',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// GET /api/sync/maintenance/stats - Get price_history statistics
router.get('/maintenance/stats', async (_req: Request, res: Response) => {
  try {
    // Get total count
    const totalCount = await query('SELECT COUNT(*) as count FROM price_history');
    
    // Get oldest and newest timestamps (checking both timestamp and created_at)
    const timeRange = await query(`
      SELECT 
        MIN(timestamp) as oldest_timestamp,
        MAX(timestamp) as newest_timestamp,
        MIN(created_at) as oldest_created_at,
        MAX(created_at) as newest_created_at,
        COUNT(*) FILTER (WHERE timestamp < NOW() - INTERVAL '24 hours') as older_than_24h_by_timestamp,
        COUNT(*) FILTER (WHERE timestamp >= NOW() - INTERVAL '24 hours') as within_24h_by_timestamp,
        COUNT(*) FILTER (WHERE created_at < NOW() - INTERVAL '24 hours') as older_than_24h_by_created_at,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') as within_24h_by_created_at,
        COUNT(*) FILTER (WHERE timestamp < NOW() - INTERVAL '30 hours') as older_than_30h_by_timestamp
      FROM price_history
    `);
    
    // Get table size estimate
    const tableSize = await query(`
      SELECT 
        pg_size_pretty(pg_total_relation_size('price_history')) as total_size,
        pg_size_pretty(pg_relation_size('price_history')) as table_size,
        pg_size_pretty(pg_indexes_size('price_history')) as indexes_size
    `);

    const stats = {
      total_records: parseInt(totalCount.rows[0].count),
      time_range: {
        timestamp: {
          oldest: timeRange.rows[0].oldest_timestamp,
          newest: timeRange.rows[0].newest_timestamp,
        },
        created_at: {
          oldest: timeRange.rows[0].oldest_created_at,
          newest: timeRange.rows[0].newest_created_at,
        },
      },
      retention: {
        // Pruning uses timestamp column
        by_timestamp: {
          older_than_24h: parseInt(timeRange.rows[0].older_than_24h_by_timestamp),
          within_24h: parseInt(timeRange.rows[0].within_24h_by_timestamp),
          older_than_30h: parseInt(timeRange.rows[0].older_than_30h_by_timestamp),
        },
        // For reference - created_at is not used for pruning
        by_created_at: {
          older_than_24h: parseInt(timeRange.rows[0].older_than_24h_by_created_at),
          within_24h: parseInt(timeRange.rows[0].within_24h_by_created_at),
        },
        retention_period_hours: 24,
        note: 'Pruning uses the timestamp column, not created_at',
      },
      storage: {
        total_size: tableSize.rows[0].total_size,
        table_size: tableSize.rows[0].table_size,
        indexes_size: tableSize.rows[0].indexes_size,
      },
      pruning_info: {
        automatic_pruning: 'Runs every 72 sync cycles (approximately every 6 hours at 5-min intervals)',
        last_prune_check: 'Check backend logs for "[Periodic Sync] Running maintenance tasks..."',
      },
    };

    return res.json(stats);
  } catch (error) {
    console.error('Error fetching maintenance stats:', error);
    return res.status(500).json({
      error: 'Failed to fetch maintenance stats',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// POST /api/sync/maintenance/prune - Manually trigger price_history pruning
router.post('/maintenance/prune', strictLimiter, async (req: Request, res: Response) => {
  try {
    if (!marketIngestionRef) {
      return res.status(503).json({ error: 'Market ingestion service not available' });
    }

    // Allow custom daysToKeep via query param, default to 1 day (24 hours)
    const daysToKeep = parseInt(req.body.daysToKeep as string) || parseInt(req.query.daysToKeep as string) || 1;
    
    if (daysToKeep < 0 || daysToKeep > 30) {
      return res.status(400).json({ 
        error: 'Invalid daysToKeep parameter',
        message: 'daysToKeep must be between 0 and 30',
      });
    }

    console.log(`[Maintenance] Manual prune triggered: keeping ${daysToKeep} day(s) of history`);
    
    const prunedCount = await marketIngestionRef.pruneOldHistory(daysToKeep);

    return res.json({
      success: true,
      pruned_count: prunedCount,
      days_kept: daysToKeep,
      message: `Successfully pruned ${prunedCount} old price history records (keeping ${daysToKeep} day(s))`,
    });
  } catch (error) {
    console.error('Error pruning price history:', error);
    return res.status(500).json({
      error: 'Failed to prune price history',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;

