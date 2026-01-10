/**
 * New Market/Outcome Detection Service
 * 
 * Detects new markets and outcomes during sync and generates alerts.
 * Responsibilities:
 * - Track known market IDs in Redis
 * - Detect new markets during sync
 * - Detect new outcomes in existing markets
 * - Keyword filtering for relevant markets
 * - Generate alerts for new markets/outcomes
 */

import { redis } from '../config/redis';
import { query } from '../config/database';
import { AlertEvent } from './anomaly-detector';
import { PolymarketMarket } from './polymarket-rest';

export class NewMarketDetector {
  private readonly KNOWN_MARKETS_KEY = 'known_markets';
  private readonly KNOWN_OUTCOMES_KEY_PREFIX = 'known_outcomes:';
  private readonly KEYWORD_FILTERS = [
    'war', 'conflict', 'attack', 'invasion',
    'launch', 'release', 'announcement',
    'hack', 'breach', 'exploit', 'vulnerability',
    'election', 'vote', 'poll',
    'ipo', 'merger', 'acquisition',
    'regulation', 'ban', 'approval',
    'disaster', 'crisis', 'emergency',
  ];

  constructor() {}

  /**
   * Initialize known markets set from database
   * Should be called on startup to populate Redis with existing markets
   */
  async initializeKnownMarkets(): Promise<number> {
    try {
      const result = await query('SELECT id FROM markets');
      const marketIds = result.rows.map((row: { id: string }) => row.id);
      
      if (marketIds.length === 0) {
        console.log('[New Market Detector] No existing markets found in database');
        return 0;
      }

      // Add all market IDs to Redis set
      if (marketIds.length > 0) {
        await redis.sadd(this.KNOWN_MARKETS_KEY, ...marketIds);
        // Set expiration to 30 days (refresh periodically)
        await redis.expire(this.KNOWN_MARKETS_KEY, 2592000);
      }

      console.log(`[New Market Detector] Initialized ${marketIds.length} known markets`);
      return marketIds.length;
    } catch (error) {
      console.error('[New Market Detector] Error initializing known markets:', error);
      return 0;
    }
  }

  /**
   * Check if a market is new (not in known markets set)
   */
  async isNewMarket(marketId: string): Promise<boolean> {
    try {
      const exists = await redis.sismember(this.KNOWN_MARKETS_KEY, marketId);
      return exists === 0; // 0 means not in set (new market)
    } catch (error) {
      console.error(`[New Market Detector] Error checking if market ${marketId} is new:`, error);
      // On error, assume it's not new to avoid false positives
      return false;
    }
  }

  /**
   * Mark a market as known (add to Redis set)
   */
  async markMarketAsKnown(marketId: string): Promise<void> {
    try {
      await redis.sadd(this.KNOWN_MARKETS_KEY, marketId);
      await redis.expire(this.KNOWN_MARKETS_KEY, 2592000); // 30 days
    } catch (error) {
      console.error(`[New Market Detector] Error marking market ${marketId} as known:`, error);
    }
  }

  /**
   * Get known outcomes for a market
   */
  private async getKnownOutcomes(marketId: string): Promise<Set<string>> {
    try {
      const key = `${this.KNOWN_OUTCOMES_KEY_PREFIX}${marketId}`;
      const outcomeIds = await redis.smembers(key);
      return new Set(outcomeIds);
    } catch (error) {
      console.error(`[New Market Detector] Error getting known outcomes for ${marketId}:`, error);
      return new Set();
    }
  }

  /**
   * Mark outcomes as known for a market
   */
  private async markOutcomesAsKnown(marketId: string, outcomeIds: string[]): Promise<void> {
    try {
      if (outcomeIds.length === 0) return;
      
      const key = `${this.KNOWN_OUTCOMES_KEY_PREFIX}${marketId}`;
      await redis.sadd(key, ...outcomeIds);
      await redis.expire(key, 2592000); // 30 days
    } catch (error) {
      console.error(`[New Market Detector] Error marking outcomes as known for ${marketId}:`, error);
    }
  }

  /**
   * Check if market matches keyword filters
   */
  private matchesKeywords(market: PolymarketMarket): boolean {
    const question = (market.question || '').toLowerCase();
    
    // Handle category - can be string, object, or null
    let categoryStr = '';
    if (market.category) {
      if (typeof market.category === 'string') {
        categoryStr = market.category.toLowerCase();
      } else if (typeof market.category === 'object' && market.category !== null) {
        const catObj = market.category as any;
        categoryStr = (catObj.label || catObj.slug || String(catObj.id || '')).toLowerCase();
      } else {
        categoryStr = String(market.category).toLowerCase();
      }
    }
    
    const tags = (market.tags || []).map(t => 
      typeof t === 'string' ? t.toLowerCase() : String(t).toLowerCase()
    ).join(' ');

    const searchText = `${question} ${categoryStr} ${tags}`;

    return this.KEYWORD_FILTERS.some(keyword => 
      searchText.includes(keyword.toLowerCase())
    );
  }

  /**
   * Detect new markets and generate alerts
   */
  async detectNewMarkets(markets: PolymarketMarket[]): Promise<AlertEvent[]> {
    const alerts: AlertEvent[] = [];

    for (const market of markets) {
      try {
        const marketId = market.conditionId || market.questionId || market.id;
        if (!marketId) continue;

        const isNew = await this.isNewMarket(marketId);
        if (!isNew) continue;

        // Check keyword filters (optional - can be made configurable)
        // For now, we'll alert on all new markets, but can filter by keywords if needed
        const matchesKeywords = this.matchesKeywords(market);
        
        // Generate alert for new market
        const alert: AlertEvent = {
          type: 'new_market',
          marketId,
          severity: matchesKeywords ? 'high' : 'medium',
          message: `NEW MARKET: ${market.question || 'Untitled Market'}`,
          data: {
            marketTitle: market.question,
            category: market.category,
            slug: market.slug,
            matchesKeywords,
            isNewMarket: true,
          },
          timestamp: Date.now(),
        };

        alerts.push(alert);
      } catch (error) {
        // Log error but continue processing other markets
        console.error(`[New Market Detector] Error processing market ${market.id || 'unknown'}:`, error);
        continue;
      }
      
      // Mark market as known
      await this.markMarketAsKnown(marketId);
    }

    return alerts;
  }

  /**
   * Detect new outcomes in existing markets
   */
  async detectNewOutcomes(marketId: string, currentOutcomes: Array<{ id: string; outcome: string }>): Promise<AlertEvent[]> {
    const alerts: AlertEvent[] = [];

    try {
      // Get known outcomes from Redis
      const knownOutcomes = await this.getKnownOutcomes(marketId);
      
      // Find new outcomes
      const newOutcomes = currentOutcomes.filter(outcome => !knownOutcomes.has(outcome.id));

      if (newOutcomes.length === 0) {
        return alerts;
      }

      // Get market info for alert
      const marketResult = await query(
        'SELECT question, category, slug FROM markets WHERE id = $1',
        [marketId]
      );

      const marketInfo = marketResult.rows[0] || {};
      const matchesKeywords = this.matchesKeywords({
        question: marketInfo.question,
        category: marketInfo.category,
        tags: [],
      } as PolymarketMarket);

      // Generate alert for new outcomes
      for (const outcome of newOutcomes) {
        const alert: AlertEvent = {
          type: 'new_outcome',
          marketId,
          outcomeId: outcome.id,
          outcomeName: outcome.outcome,
          severity: matchesKeywords ? 'high' : 'medium',
          message: `NEW OUTCOME: ${outcome.outcome} in ${marketInfo.question || 'Market'}`,
          data: {
            marketTitle: marketInfo.question,
            category: marketInfo.category,
            newOutcome: outcome.outcome,
            matchesKeywords,
            isNewOutcome: true,
          },
          timestamp: Date.now(),
        };

        alerts.push(alert);
      }

      // Mark all current outcomes as known
      const allOutcomeIds = currentOutcomes.map(o => o.id);
      await this.markOutcomesAsKnown(marketId, allOutcomeIds);

    } catch (error) {
      console.error(`[New Market Detector] Error detecting new outcomes for ${marketId}:`, error);
    }

    return alerts;
  }

  /**
   * Initialize known outcomes for all markets from database
   */
  async initializeKnownOutcomes(): Promise<number> {
    try {
      const result = await query(
        'SELECT market_id, id FROM outcomes'
      );

      const outcomesByMarket = new Map<string, string[]>();
      
      for (const row of result.rows) {
        const marketId = row.market_id;
        const outcomeId = row.id;
        
        if (!outcomesByMarket.has(marketId)) {
          outcomesByMarket.set(marketId, []);
        }
        outcomesByMarket.get(marketId)!.push(outcomeId);
      }

      // Mark outcomes as known for each market
      for (const [marketId, outcomeIds] of outcomesByMarket.entries()) {
        await this.markOutcomesAsKnown(marketId, outcomeIds);
      }

      console.log(`[New Market Detector] Initialized known outcomes for ${outcomesByMarket.size} markets`);
      return outcomesByMarket.size;
    } catch (error) {
      console.error('[New Market Detector] Error initializing known outcomes:', error);
      return 0;
    }
  }
}
