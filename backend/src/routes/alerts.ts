/**
 * Alert API Routes
 * 
 * Endpoints for querying and managing alerts
 */

import { Router, Request, Response } from 'express';
import { apiLimiter } from '../middleware/rateLimiter';
import { redis } from '../config/redis';
import { query } from '../config/database';
import { AlertEvent } from '../services/anomaly-detector';

const router = Router();

// Apply rate limiting
router.use(apiLimiter);

/**
 * GET /api/alerts
 * List recent alerts (from Redis)
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const marketId = req.query.marketId as string | undefined;
    const alertType = req.query.type as string | undefined;

    let alerts: AlertEvent[] = [];

    if (marketId) {
      // Get alerts for specific market
      const marketAlertKey = `alerts:market:${marketId}`;
      const alertJsons = await redis.lrange(marketAlertKey, 0, limit - 1);
      alerts = alertJsons
        .map(json => {
          try {
            return JSON.parse(json) as AlertEvent;
          } catch {
            return null;
          }
        })
        .filter((alert): alert is AlertEvent => alert !== null);
    } else {
      // Get all recent alerts from pending queue
      const alertKey = 'alerts:pending';
      const alertJsons = await redis.lrange(alertKey, 0, limit - 1);
      alerts = alertJsons
        .map(json => {
          try {
            return JSON.parse(json) as AlertEvent;
          } catch {
            return null;
          }
        })
        .filter((alert): alert is AlertEvent => alert !== null);
    }

    // Filter by type if specified
    if (alertType) {
      alerts = alerts.filter(alert => alert.type === alertType);
    }

    // Sort by timestamp (newest first)
    alerts.sort((a, b) => b.timestamp - a.timestamp);

    // Limit results
    alerts = alerts.slice(0, limit);

    // Enrich with market names
    const enrichedAlerts = await Promise.all(
      alerts.map(async (alert) => {
        try {
          const marketResult = await query(
            'SELECT question, category, slug FROM markets WHERE id = $1',
            [alert.marketId]
          );

          return {
            ...alert,
            marketName: marketResult.rows[0]?.question,
            marketCategory: marketResult.rows[0]?.category,
            marketSlug: marketResult.rows[0]?.slug,
            polymarketUrl: marketResult.rows[0]?.slug
              ? `https://polymarket.com/event/${marketResult.rows[0].slug}`
              : undefined,
          };
        } catch {
          return alert;
        }
      })
    );

    return res.json({
      success: true,
      count: enrichedAlerts.length,
      alerts: enrichedAlerts,
    });
  } catch (error) {
    console.error('Error fetching alerts:', error);
    return res.status(500).json({
      error: 'Failed to fetch alerts',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/alerts/stats
 * Get alert statistics
 */
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const alertKey = 'alerts:pending';
    const totalAlerts = await redis.llen(alertKey);

    // Count by type
    const alertJsons = await redis.lrange(alertKey, 0, 999); // Get up to 1000 alerts for stats
    const alerts = alertJsons
      .map(json => {
        try {
          return JSON.parse(json) as AlertEvent;
        } catch {
          return null;
        }
      })
      .filter((alert): alert is AlertEvent => alert !== null);

    const byType = alerts.reduce((acc, alert) => {
      acc[alert.type] = (acc[alert.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const bySeverity = alerts.reduce((acc, alert) => {
      acc[alert.severity] = (acc[alert.severity] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Get recent alerts (last hour)
    const oneHourAgo = Date.now() - 3600000;
    const recentAlerts = alerts.filter(alert => alert.timestamp >= oneHourAgo);

    return res.json({
      success: true,
      stats: {
        total: totalAlerts,
        recent: recentAlerts.length,
        byType,
        bySeverity,
      },
    });
  } catch (error) {
    console.error('Error fetching alert stats:', error);
    return res.status(500).json({
      error: 'Failed to fetch alert stats',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/alerts/:marketId
 * Get alerts for a specific market
 */
router.get('/:marketId', async (req: Request, res: Response) => {
  try {
    const { marketId } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    const marketAlertKey = `alerts:market:${marketId}`;
    const alertJsons = await redis.lrange(marketAlertKey, 0, limit - 1);

    const alerts = alertJsons
      .map(json => {
        try {
          return JSON.parse(json) as AlertEvent;
        } catch {
          return null;
        }
      })
      .filter((alert): alert is AlertEvent => alert !== null)
      .sort((a, b) => b.timestamp - a.timestamp);

    // Get market info
    const marketResult = await query(
      'SELECT question, category, slug FROM markets WHERE id = $1',
      [marketId]
    );

    const market = marketResult.rows[0];

    return res.json({
      success: true,
      market: market ? {
        id: marketId,
        name: market.question,
        category: market.category,
        slug: market.slug,
      } : null,
      count: alerts.length,
      alerts,
    });
  } catch (error) {
    console.error('Error fetching market alerts:', error);
    return res.status(500).json({
      error: 'Failed to fetch market alerts',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
