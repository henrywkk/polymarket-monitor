import { Router, Request, Response } from 'express';
import { strictLimiter } from '../middleware/rateLimiter';

const router = Router();

// Store sync service reference (set from index.ts)
let syncServiceRef: { syncMarkets: (limit: number) => Promise<number> } | undefined;

export const setSyncService = (service: { syncMarkets: (limit: number) => Promise<number> }) => {
  syncServiceRef = service;
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
    res.status(500).json({
      error: 'Failed to sync markets',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;

