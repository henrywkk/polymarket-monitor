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
        `INSERT INTO markets (id, question, slug, category, end_date, image_url)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) 
         DO UPDATE SET 
           question = EXCLUDED.question,
           slug = EXCLUDED.slug,
           category = EXCLUDED.category,
           end_date = EXCLUDED.end_date,
           image_url = EXCLUDED.image_url,
           updated_at = CURRENT_TIMESTAMP`,
        [
          market.id,
          market.question,
          market.slug,
          market.category,
          market.endDate,
          market.imageUrl,
        ]
      );
      // Removed verbose logging to reduce Railway log rate limit
    } catch (error) {
      console.error(`Error upserting market ${market.id}:`, error);
      throw error;
    }
  }

  /**
   * Store or update outcome in database
   */
  async upsertOutcome(outcome: Omit<Outcome, 'createdAt'>): Promise<void> {
    try {
      await query(
        `INSERT INTO outcomes (id, market_id, outcome, token_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (market_id, outcome) 
         DO UPDATE SET token_id = EXCLUDED.token_id`,
        [outcome.id, outcome.marketId, outcome.outcome, outcome.tokenId]
      );
    } catch (error) {
      console.error(`Error upserting outcome ${outcome.id}:`, error);
      throw error;
    }
  }

  /**
   * Handle price change events from WebSocket
   */
  private async handlePriceEvent(event: PolymarketPriceEvent): Promise<void> {
    try {
      let { market: marketId, outcome: outcomeId, price } = event;

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

      // Store price history in database
      await this.storePriceHistory({
        marketId,
        outcomeId: outcome.id,
        bidPrice: price.bid,
        askPrice: price.ask,
        midPrice,
        impliedProbability,
      });

      // Track active market
      if (!this.activeMarkets.has(marketId)) {
        this.activeMarkets.set(marketId, new Set());
      }
      this.activeMarkets.get(marketId)!.add(outcome.id);

      // Broadcast to connected clients
      if (this.wsServer) {
        this.wsServer.broadcastPriceUpdate(event);
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
        this.wsClient.subscribeToAssets(assetIds);
        console.log(`Subscribed to ${marketIds.length} markets with ${assetIds.length} total asset(s)`);
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
}

