import { Router, Request, Response } from 'express';
import { strictLimiter } from '../middleware/rateLimiter';
import { PolymarketRestClient } from '../services/polymarket-rest';

const router = Router();

// Store sync service reference (set from index.ts)
let syncServiceRef: { syncMarkets: (limit: number) => Promise<number>; syncMarket: (market: any) => Promise<void> } | undefined;
let restClientRef: PolymarketRestClient | undefined;

export const setSyncService = (service: { syncMarkets: (limit: number) => Promise<number>; syncMarket: (market: any) => Promise<void> }) => {
  syncServiceRef = service;
};

export const setRestClient = (client: PolymarketRestClient) => {
  restClientRef = client;
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

export default router;

