import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { apiLimiter } from '../middleware/rateLimiter';

const router = Router();

// Apply rate limiting
router.use(apiLimiter);

/**
 * GET /api/categories
 * Returns all available categories with market counts
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT 
        category,
        COUNT(*) as market_count,
        COUNT(CASE WHEN end_date IS NULL OR end_date > NOW() THEN 1 END) as active_count,
        COUNT(CASE WHEN end_date IS NOT NULL AND end_date <= NOW() THEN 1 END) as closed_count
       FROM markets
       GROUP BY category
       ORDER BY market_count DESC`
    );

    const categories = result.rows.map((row) => ({
      name: row.category,
      marketCount: parseInt(row.market_count, 10),
      activeCount: parseInt(row.active_count, 10),
      closedCount: parseInt(row.closed_count, 10),
    }));

    return res.json({
      data: categories,
      total: categories.length,
    });
  } catch (error) {
    console.error('Error fetching categories:', error);
    return res.status(500).json({
      error: 'Failed to fetch categories',
      details: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : undefined,
    });
  }
});

export default router;
