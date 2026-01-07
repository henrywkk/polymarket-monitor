import { query } from '../config/database';
import { PolymarketWebSocketClient, PolymarketPriceEvent } from './polymarket-client';
import { calculateImpliedProbability, calculateMidPrice, isValidPrice } from '../utils/probability';
import { Market, Outcome } from '../models/Market';

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
      const { market: marketId, outcome: outcomeId, price } = event;

      // Validate prices
      if (!isValidPrice(price.bid) || !isValidPrice(price.ask)) {
        console.warn(`Invalid price data for ${marketId}-${outcomeId}:`, price);
        return;
      }

      // Calculate mid price and implied probability
      const midPrice = calculateMidPrice(price.bid, price.ask);
      const impliedProbability = calculateImpliedProbability(price.bid, price.ask);

      // Get outcome record to get the outcome ID
      const outcomeResult = await query(
        'SELECT id FROM outcomes WHERE market_id = $1 AND token_id = $2',
        [marketId, outcomeId]
      );

      if (outcomeResult.rows.length === 0) {
        console.warn(`Outcome not found for market ${marketId}, outcome ${outcomeId}`);
        return;
      }

      const outcome = outcomeResult.rows[0];

      // Store price history
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

      console.log(
        `Price update: ${marketId}-${outcomeId} | Bid: ${price.bid}, Ask: ${price.ask}, Prob: ${impliedProbability.toFixed(2)}%`
      );

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
   * Subscribe to market updates
   */
  subscribeToMarket(marketId: string, outcomeId?: string): void {
    this.wsClient.subscribe(marketId, outcomeId);
  }

  /**
   * Unsubscribe from market updates
   */
  unsubscribeFromMarket(marketId: string, outcomeId?: string): void {
    this.wsClient.unsubscribe(marketId, outcomeId);
  }

  /**
   * Get active markets being tracked
   */
  getActiveMarkets(): string[] {
    return Array.from(this.activeMarkets.keys());
  }
}

