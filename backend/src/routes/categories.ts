import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { apiLimiter } from '../middleware/rateLimiter';

const router = Router();

// Apply rate limiting
router.use(apiLimiter);

/**
 * GET /api/categories
 * Returns all available categories with market counts
 * Returns fixed order categories first (ALL, CRYPTO, POLITICS, SPORTS), then dynamic categories sorted by active/live count
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

    const allCategories = result.rows.map((row) => ({
      name: row.category,
      marketCount: parseInt(row.market_count, 10),
      activeCount: parseInt(row.active_count, 10),
      closedCount: parseInt(row.closed_count, 10),
    }));

    // Fixed order categories
    const fixedOrder = ['All', 'Crypto', 'Politics', 'Sports'];
    const fixedCategories: typeof allCategories = [];
    const dynamicCategories: typeof allCategories = [];

    // Separate fixed and dynamic categories
    for (const cat of allCategories) {
      const normalizedName = cat.name.trim();
      const fixedIndex = fixedOrder.findIndex(f => f.toLowerCase() === normalizedName.toLowerCase());
      if (fixedIndex >= 0) {
        fixedCategories.push({ ...cat, name: fixedOrder[fixedIndex] }); // Use canonical name
      } else {
        dynamicCategories.push(cat);
      }
    }

    // Sort fixed categories by fixed order
    fixedCategories.sort((a, b) => {
      const aIndex = fixedOrder.indexOf(a.name);
      const bIndex = fixedOrder.indexOf(b.name);
      return aIndex - bIndex;
    });

    // Sort dynamic categories by active count (descending), then by total count
    dynamicCategories.sort((a, b) => {
      if (b.activeCount !== a.activeCount) {
        return b.activeCount - a.activeCount;
      }
      return b.marketCount - a.marketCount;
    });

    // Combine: fixed first, then dynamic
    const categories = [...fixedCategories, ...dynamicCategories];

    return res.json({
      data: categories,
      total: categories.length,
      fixed: fixedCategories.length,
      dynamic: dynamicCategories.length,
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
