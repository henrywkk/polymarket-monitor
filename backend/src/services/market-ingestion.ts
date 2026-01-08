import { query } from '../config/database';
import { PolymarketWebSocketClient, PolymarketPriceEvent } from './polymarket-client';
import { calculateImpliedProbability, calculateMidPrice, isValidPrice } from '../utils/probability';
import { Market, Outcome } from '../models/Market';
import { redis } from '../config/redis';
import { WebSocketServer } from './websocket-server';

export class MarketIngestionService {
  private wsClient: PolymarketWebSocketClient;
  private wsServer?: WebSocketServer;
  private activeMarkets = new Map<string, Set<string>>(); // marketId -> Set of outcomeIds
  private lastPersistedPrices = new Map<string, { price: number; timestamp: number }>(); // outcomeId -> { price, timestamp }
  private PERSIST_INTERVAL_MS = 60000; // Persist at most once per minute per outcome
  private PRICE_CHANGE_THRESHOLD = 0.01; // OR if price changes by more than 1%

  constructor(wsClient: PolymarketWebSocketClient, wsServer?: WebSocketServer) {
    this.wsClient = wsClient;
    this.wsServer = wsServer;
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Listen to all price events
    this.wsClient.onMessage('*', (event: PolymarketPriceEvent) => {
      this.handlePriceEvent(event);
    });
  }

  /**
   * Fetch initial market metadata from Polymarket REST API
   * Note: This is a placeholder - actual implementation depends on Polymarket REST API
   */
  async fetchMarketMetadata(marketId: string): Promise<Market | null> {
    try {
      // TODO: Implement actual REST API call to Polymarket
      // For now, return null - markets should be inserted via other means
      // or we'll implement the REST client separately
      console.log(`Fetching metadata for market: ${marketId}`);
      return null;
    } catch (error) {
      console.error(`Error fetching market metadata for ${marketId}:`, error);
      return null;
    }
  }

  /**
   * Store or update market in database
   */
  async upsertMarket(market: Omit<Market, 'createdAt' | 'updatedAt'>): Promise<void> {
    try {
      await query(
        `INSERT INTO markets (id, question, slug, category, end_date, image_url, volume, volume_24h, liquidity)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) 
         DO UPDATE SET 
           question = EXCLUDED.question,
           slug = EXCLUDED.slug,
           category = EXCLUDED.category,
           end_date = EXCLUDED.end_date,
           image_url = EXCLUDED.image_url,
           volume = EXCLUDED.volume,
           volume_24h = EXCLUDED.volume_24h,
           liquidity = EXCLUDED.liquidity,
           updated_at = CURRENT_TIMESTAMP`,
        [
          market.id,
          market.question,
          market.slug,
          market.category,
          market.endDate,
          market.imageUrl,
          market.volume || 0,
          market.volume24h || 0,
          market.liquidity || 0,
        ]
      );
      // Removed verbose logging to reduce Railway log rate limit
    } catch (error) {
      console.error(`Error upserting market ${market.id}:`, error);
      throw error;
    }
  }

  /**
   * Take a snapshot of market statistics (volume, liquidity, price)
   * This is used for alert detection (e.g., volume spikes)
   */
  async takeStatsSnapshot(): Promise<number> {
    try {
      console.log('[Stats] Taking snapshots of market statistics...');
      
      // We'll take snapshots of all markets that have recent price activity
      // or at least have some volume
      const result = await query(`
        INSERT INTO market_stats_history (market_id, volume, volume_24h, liquidity, avg_price)
        SELECT 
          m.id, 
          m.volume, 
          m.volume_24h, 
          m.liquidity,
          (
            SELECT AVG(mid_price) 
            FROM price_history ph 
            WHERE ph.market_id = m.id 
            AND ph.timestamp >= NOW() - INTERVAL '1 hour'
          ) as avg_price
        FROM markets m
        WHERE m.volume > 0 OR m.volume_24h > 0
      `);

      const snapshotCount = result.rowCount || 0;
      console.log(`[Stats] Successfully took ${snapshotCount} market stats snapshots.`);
      return snapshotCount;
    } catch (error) {
      console.error('[Stats] Error taking market stats snapshots:', error);
      return 0;
    }
  }

  /**
   * Store or update outcome in database
   * Handles conflicts on primary key (id/token_id) to allow updating outcome names
   * from "Yes"/"No" to bucket names like "<0.5%"
   */
  async upsertOutcome(outcome: Omit<Outcome, 'createdAt'>): Promise<void> {
    try {
      // Handle conflict on primary key (id/token_id)
      // This allows us to update outcome names when the same token_id exists
      // with a different outcome name (e.g., "Yes" -> "<0.5%")
      await query(
        `INSERT INTO outcomes (id, market_id, outcome, token_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) 
         DO UPDATE SET 
           market_id = EXCLUDED.market_id,
           outcome = EXCLUDED.outcome,
           token_id = EXCLUDED.token_id`,
        [outcome.id, outcome.marketId, outcome.outcome, outcome.tokenId]
      );
    } catch (error) {
      // If conflict on (market_id, outcome) unique constraint, try to update by that
      if ((error as any).code === '23505' && (error as any).constraint === 'outcomes_market_id_outcome_key') {
        try {
          await query(
            `UPDATE outcomes 
             SET id = $1, token_id = $4
             WHERE market_id = $2 AND outcome = $3`,
            [outcome.id, outcome.marketId, outcome.outcome, outcome.tokenId]
          );
        } catch (updateError) {
          console.error(`Error updating outcome ${outcome.id} by (market_id, outcome):`, updateError);
          throw updateError;
        }
      } else {
        console.error(`Error upserting outcome ${outcome.id}:`, error);
        throw error;
      }
    }
  }

  /**
   * Handle price change events from WebSocket
   */
  private async handlePriceEvent(event: PolymarketPriceEvent): Promise<void> {
    try {
      let { market: marketId, outcome: outcomeId, price } = event;
      
      console.log(`[Price Event] Handling price update for asset_id: ${outcomeId}, bid: ${price.bid}, ask: ${price.ask}`);

      // Validate prices
      if (!isValidPrice(price.bid) || !isValidPrice(price.ask)) {
        console.warn(`Invalid price data for ${marketId}-${outcomeId}:`, price);
        return;
      }

      // Calculate mid price and implied probability
      const midPrice = calculateMidPrice(price.bid, price.ask);
      const impliedProbability = calculateImpliedProbability(price.bid, price.ask);

      // Get outcome record to get the outcome ID
      // Note: outcomeId here is the asset_id (token_id) from CLOB WebSocket
      let outcome: { id: string; market_id: string; token_id: string };
      const outcomeResult = await query(
        'SELECT id, market_id, token_id FROM outcomes WHERE token_id = $1',
        [outcomeId] // outcomeId is the asset_id (token_id)
      );

      if (outcomeResult.rows.length === 0) {
        // Try alternative lookup by market_id if asset_id lookup fails
        const altResult = await query(
          'SELECT id, market_id, token_id FROM outcomes WHERE market_id = $1 AND token_id = $2',
          [marketId, outcomeId]
        );
        if (altResult.rows.length === 0) {
          console.warn(`Outcome not found for asset_id ${outcomeId} (market: ${marketId})`);
          return;
        }
        outcome = altResult.rows[0];
      } else {
        outcome = outcomeResult.rows[0];
        // Update marketId from database if it differs
        marketId = outcome.market_id;
      }

      // Store Last Traded Price in Redis for fast frontend access
      // Key format: market:{marketId}:price:{tokenId}
      const priceKey = `market:${marketId}:price:${outcome.token_id}`;
      const lastPrice = {
        bid: price.bid,
        ask: price.ask,
        mid: midPrice,
        probability: impliedProbability,
        timestamp: Date.now(),
      };
      await redis.setex(priceKey, 3600, JSON.stringify(lastPrice)); // Expire after 1 hour
      
      // Also store by token_id for direct lookup
      const tokenPriceKey = `token:${outcome.token_id}:price`;
      await redis.setex(tokenPriceKey, 3600, JSON.stringify(lastPrice));

      // Also store in a market-level cache for quick lookup
      await redis.hset(`market:${marketId}:prices`, outcome.token_id, JSON.stringify(lastPrice));
      await redis.expire(`market:${marketId}:prices`, 3600);

      // Throttled price history persistence
      const now = Date.now();
      const lastPersisted = this.lastPersistedPrices.get(outcome.id);
      const priceChangedSignificantly = !lastPersisted || 
        Math.abs((midPrice - lastPersisted.price) / lastPersisted.price) > this.PRICE_CHANGE_THRESHOLD;
      const intervalPassed = !lastPersisted || (now - lastPersisted.timestamp) > this.PERSIST_INTERVAL_MS;

      if (priceChangedSignificantly || intervalPassed) {
        // Store price history in database
        await this.storePriceHistory({
          marketId,
          outcomeId: outcome.id,
          bidPrice: price.bid,
          askPrice: price.ask,
          midPrice,
          impliedProbability,
        });
        
        // Update last persisted state
        this.lastPersistedPrices.set(outcome.id, {
          price: midPrice,
          timestamp: now
        });
      }

      // Track active market
      if (!this.activeMarkets.has(marketId)) {
        this.activeMarkets.set(marketId, new Set());
      }
      this.activeMarkets.get(marketId)!.add(outcome.id);

      // Broadcast to connected clients (use database market ID, not Polymarket market ID)
      if (this.wsServer) {
        console.log(`Broadcasting price update for market ${marketId} (from database)`);
        this.wsServer.broadcastPriceUpdate(event, marketId);
      }

      // Invalidate cache for this market
      const { cacheService } = await import('./cache-service');
      await cacheService.invalidateMarket(marketId);
    } catch (error) {
      console.error('Error handling price event:', error);
    }
  }

  /**
   * Store price history in database
   */
  private async storePriceHistory(priceData: {
    marketId: string;
    outcomeId: string;
    bidPrice: number;
    askPrice: number;
    midPrice: number;
    impliedProbability: number;
  }): Promise<void> {
    try {
      await query(
        `INSERT INTO price_history 
         (market_id, outcome_id, bid_price, ask_price, mid_price, implied_probability)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          priceData.marketId,
          priceData.outcomeId,
          priceData.bidPrice,
          priceData.askPrice,
          priceData.midPrice,
          priceData.impliedProbability,
        ]
      );
    } catch (error) {
      console.error('Error storing price history:', error);
      throw error;
    }
  }

  /**
   * Subscribe to market updates using asset_ids (token IDs)
   * This is the correct format for CLOB WebSocket
   */
  async subscribeToMarket(marketId: string): Promise<void> {
    try {
      // Get all token_ids (asset_ids) for this market
      const result = await query(
        'SELECT DISTINCT token_id FROM outcomes WHERE market_id = $1 AND token_id IS NOT NULL AND token_id != \'\'',
        [marketId]
      );

      if (result.rows.length > 0) {
        const assetIds = result.rows.map(row => row.token_id);
        this.wsClient.subscribeToAssets(assetIds);
        // Only log if we have assets to avoid spam
        if (assetIds.length > 0) {
          console.log(`Subscribed to market ${marketId} with ${assetIds.length} asset(s)`);
        }
      } else {
        // Only log warning occasionally to avoid spam (10% of the time)
        if (Math.random() < 0.1) {
          console.warn(`No token_ids found for market ${marketId} - market may not have outcomes yet`);
        }
      }
    } catch (error) {
      console.error(`Error subscribing to market ${marketId}:`, error);
    }
  }

  /**
   * Subscribe to multiple markets at once (batch subscription)
   */
  async subscribeToMarkets(marketIds: string[]): Promise<void> {
    try {
      // Get all token_ids for all markets
      const result = await query(
        'SELECT DISTINCT token_id FROM outcomes WHERE market_id = ANY($1) AND token_id IS NOT NULL AND token_id != \'\'',
        [marketIds]
      );

      if (result.rows.length > 0) {
        const assetIds = result.rows.map(row => row.token_id);
        // Batch subscribe to all asset_ids at once
        console.log(`[Subscription] Found ${assetIds.length} asset_ids for ${marketIds.length} markets`);
        console.log(`[Subscription] Sample asset_ids:`, assetIds.slice(0, 5));
        this.wsClient.subscribeToAssets(assetIds);
        console.log(`[Subscription] Successfully subscribed to ${marketIds.length} markets with ${assetIds.length} total asset(s)`);
      } else {
        console.warn(`[Subscription] No token_ids found for markets:`, marketIds.slice(0, 5));
      }
    } catch (error) {
      console.error(`Error subscribing to markets:`, error);
    }
  }

  /**
   * Unsubscribe from market updates
   */
  async unsubscribeFromMarket(marketId: string): Promise<void> {
    try {
      const result = await query(
        'SELECT DISTINCT token_id FROM outcomes WHERE market_id = $1 AND token_id IS NOT NULL AND token_id != \'\'',
        [marketId]
      );

      if (result.rows.length > 0) {
        const assetIds = result.rows.map(row => row.token_id);
        this.wsClient.unsubscribeFromAssets(assetIds);
      }
    } catch (error) {
      console.error(`Error unsubscribing from market ${marketId}:`, error);
    }
  }

  /**
   * Get active markets being tracked
   */
  getActiveMarkets(): string[] {
    return Array.from(this.activeMarkets.keys());
  }

  /**
   * Prune old price history records to save storage space
   * Default: keeps data for the last 7 days
   */
  async pruneOldHistory(daysToKeep: number = 7): Promise<number> {
    try {
      console.log(`Pruning price history older than ${daysToKeep} days...`);
      const result = await query(
        "DELETE FROM price_history WHERE timestamp < NOW() - ($1 || ' days')::INTERVAL",
        [daysToKeep]
      );
      const prunedCount = result.rowCount || 0;
      console.log(`Pruned ${prunedCount} old price history records.`);
      return prunedCount;
    } catch (error) {
      console.error('Error pruning price history:', error);
      return 0;
    }
  }
}

