import { query } from '../config/database';
import { PolymarketWebSocketClient, PolymarketPriceEvent, PolymarketTradeEvent, PolymarketOrderbookEvent } from './polymarket-client';
import { PolymarketRestClient } from './polymarket-rest';
import { calculateImpliedProbability, calculateMidPrice, isValidPrice } from '../utils/probability';
import { Market, Outcome } from '../models/Market';
import { redis } from '../config/redis';
import { WebSocketServer } from './websocket-server';
import { RedisSlidingWindow } from './redis-storage';
import { AnomalyDetector } from './anomaly-detector';
import { MarketSyncService } from './market-sync';

export class MarketIngestionService {
  private wsClient: PolymarketWebSocketClient;
  private restClient: PolymarketRestClient;
  private wsServer?: WebSocketServer;
  private anomalyDetector: AnomalyDetector;
  private marketSyncService?: MarketSyncService; // Optional reference to sync service for auto-sync
  private activeMarkets = new Map<string, Set<string>>(); // marketId -> Set of outcomeIds
  private lastPersistedPrices = new Map<string, { price: number; timestamp: number }>(); // outcomeId -> { price, timestamp }
  private warnedAssetIds = new Set<string>(); // Track asset_ids we've warned about to reduce log noise
  private syncingAssetIds = new Set<string>(); // Track asset_ids currently being synced to avoid duplicate syncs
  private orderbookRefreshInterval?: NodeJS.Timeout;
  private PERSIST_INTERVAL_MS = 60000; // Persist at most once per minute per outcome
  private PRICE_CHANGE_THRESHOLD = 0.01; // OR if price changes by more than 1%

  constructor(wsClient: PolymarketWebSocketClient, restClient: PolymarketRestClient, wsServer?: WebSocketServer) {
    this.wsClient = wsClient;
    this.restClient = restClient;
    this.wsServer = wsServer;
    this.anomalyDetector = new AnomalyDetector();
    this.setupEventHandlers();
    this.startOrderbookRefresh();
  }

  /**
   * Set the market sync service reference for auto-syncing unsynced markets
   */
  setMarketSyncService(syncService: MarketSyncService): void {
    this.marketSyncService = syncService;
  }

  /**
   * Start periodic orderbook refresh from REST API
   * Refreshes every 60 seconds to ensure we have accurate orderbook state
   */
  private startOrderbookRefresh(): void {
    // Refresh orderbooks every 60 seconds
    this.orderbookRefreshInterval = setInterval(async () => {
      await this.refreshOrderbooksForActiveMarkets();
    }, 60000); // 60 seconds
    
    // Store interval reference for potential cleanup (e.g., on shutdown)
    // This prevents the interval from being garbage collected
    if (this.orderbookRefreshInterval) {
      // Interval is active and stored
    }
  }
  
  /**
   * Stop periodic orderbook refresh
   */
  public stopOrderbookRefresh(): void {
    if (this.orderbookRefreshInterval) {
      clearInterval(this.orderbookRefreshInterval);
      this.orderbookRefreshInterval = undefined;
    }
  }

  /**
   * Refresh orderbooks for all active markets from REST API
   */
  private async refreshOrderbooksForActiveMarkets(): Promise<void> {
    try {
      // Get all token_ids from active markets
      const result = await query(
        'SELECT DISTINCT token_id FROM outcomes WHERE token_id IS NOT NULL AND token_id != \'\' LIMIT 500'
      );
      
      if (result.rows.length === 0) return;
      
      const tokenIds = result.rows.map(row => row.token_id);
      console.log(`[Orderbook Refresh] Fetching orderbooks for ${tokenIds.length} tokens from REST API...`);
      
      // Fetch orderbooks in batches
      const orderbooks = await this.restClient.fetchOrderBooks(tokenIds);
      
      // Process each orderbook
      for (const [tokenId, orderbook] of orderbooks.entries()) {
        await this.processOrderbookFromRest(tokenId, orderbook);
      }
      
      console.log(`[Orderbook Refresh] Successfully refreshed ${orderbooks.size} orderbooks`);
    } catch (error) {
      console.error('[Orderbook Refresh] Error refreshing orderbooks:', error);
    }
  }

  /**
   * Process orderbook data from REST API
   */
  private async processOrderbookFromRest(
    tokenId: string,
    orderbook: {
      bids: Array<{ price: string; size: string }>;
      asks: Array<{ price: string; size: string }>;
      timestamp: string;
    }
  ): Promise<void> {
    try {
      // Convert string prices/sizes to numbers
      const bids = orderbook.bids.map(b => ({
        price: parseFloat(b.price),
        size: parseFloat(b.size),
      }));
      const asks = orderbook.asks.map(a => ({
        price: parseFloat(a.price),
        size: parseFloat(a.size),
      }));
      
      if (bids.length === 0 || asks.length === 0) {
        return;
      }
      
      // Find the outcome by token_id
      const outcomeResult = await query(
        'SELECT id, market_id, token_id FROM outcomes WHERE token_id = $1',
        [tokenId]
      );
      
      if (outcomeResult.rows.length === 0) {
        return;
      }
      
      const outcome = outcomeResult.rows[0];
      const marketId = outcome.market_id;
      
      // Calculate orderbook metrics
      const metrics = this.calculateOrderbookMetrics(bids, asks);
      
      // Validate metrics
      if (metrics.spreadPercent > 50 || metrics.bestBid <= 0 || metrics.bestAsk <= 0 || metrics.bestBid >= 1 || metrics.bestAsk >= 1) {
        return;
      }
      
      // Store in Redis
      await RedisSlidingWindow.add(
        `orderbook:${tokenId}`,
        {
          ...metrics,
          timestamp: Date.now(),
          marketId,
          outcomeId: outcome.id,
        },
        3600000, // 60 minutes
        3600 // Max 3600 data points
      );
    } catch (error) {
      console.error(`Error processing orderbook from REST for token ${tokenId}:`, error);
    }
  }

  private setupEventHandlers(): void {
    // Listen to all price events
    this.wsClient.onMessage('*', (event: PolymarketPriceEvent) => {
      this.handlePriceEvent(event);
    });
    
    // Listen to all trade events
    this.wsClient.onTrade('*', (event: PolymarketTradeEvent) => {
      this.handleTradeEvent(event);
    });
    
    // Listen to all orderbook events
    this.wsClient.onOrderbook('*', (event: PolymarketOrderbookEvent) => {
      this.handleOrderbookEvent(event);
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
      // Check if a market with the same slug but different ID exists
      const existingMarket = await query(
        'SELECT id FROM markets WHERE slug = $1 AND id != $2',
        [market.slug, market.id]
      );

      let finalSlug = market.slug;
      if (existingMarket.rows.length > 0) {
        // Slug conflict: append market ID to make it unique
        console.warn(`[Upsert Market] Slug conflict for "${market.slug}", appending market ID to make it unique`);
        finalSlug = `${market.slug}-${market.id.substring(0, 8)}`;
      }

      // Cap activity_score to fit DECIMAL(10, 5) - max value is 99999.99999
      // But activity score should be 0-100, so we cap at 100 for safety
      const activityScore = Math.min(Math.max(market.activityScore || 0, 0), 100);

      await query(
        `INSERT INTO markets (id, question, slug, category, end_date, image_url, volume, volume_24h, liquidity, activity_score, question_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
           activity_score = EXCLUDED.activity_score,
           question_id = EXCLUDED.question_id,
           updated_at = CURRENT_TIMESTAMP`,
        [
          market.id,
          market.question,
          finalSlug,
          market.category,
          market.endDate,
          market.imageUrl,
          market.volume || 0,
          market.volume24h || 0,
          market.liquidity || 0,
          activityScore,
          market.questionId || null,
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
        `INSERT INTO outcomes (id, market_id, outcome, token_id, volume, volume_24h)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) 
         DO UPDATE SET 
           market_id = EXCLUDED.market_id,
           outcome = EXCLUDED.outcome,
           token_id = EXCLUDED.token_id,
           volume = EXCLUDED.volume,
           volume_24h = EXCLUDED.volume_24h`,
        [
          outcome.id, 
          outcome.marketId, 
          outcome.outcome, 
          outcome.tokenId,
          outcome.volume || 0,
          outcome.volume24h || 0
        ]
      );
    } catch (error) {
      // If conflict on (market_id, outcome) unique constraint, try to update by that
      if ((error as any).code === '23505' && (error as any).constraint === 'outcomes_market_id_outcome_key') {
        try {
          await query(
            `UPDATE outcomes 
             SET id = $1, token_id = $4, volume = $5, volume_24h = $6
             WHERE market_id = $2 AND outcome = $3`,
            [
              outcome.id, 
              outcome.marketId, 
              outcome.outcome, 
              outcome.tokenId,
              outcome.volume || 0,
              outcome.volume24h || 0
            ]
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
  public async handlePriceEvent(event: PolymarketPriceEvent): Promise<void> {
    try {
      let { market: marketId, outcome: outcomeId, price } = event;
      
      console.log(`[Price Event] Handling price update for asset_id: ${outcomeId}, bid: ${price.bid}, ask: ${price.ask}`);

      // Validate prices (must be 0-1 range)
      if (!isValidPrice(price.bid) || !isValidPrice(price.ask)) {
        // Log at debug level since this can happen during initial price setup
        // and is often corrected by subsequent price updates
        console.log(`[Debug] Invalid price data for ${marketId}-${outcomeId}:`, price, '(prices must be 0-1 range)');
        return;
      }

      // Calculate mid price and implied probability
      const midPrice = calculateMidPrice(price.bid, price.ask);
      const impliedProbability = calculateImpliedProbability(price.bid, price.ask);

      // Get outcome record to get the outcome ID
      // Note: outcomeId here is the asset_id (token_id) from CLOB WebSocket
      // Note: marketId in the event is actually also an assetId (from WebSocket client),
      //       so we only lookup by token_id
      let outcome: { id: string; market_id: string; token_id: string };
      const outcomeResult = await query(
        'SELECT id, market_id, token_id FROM outcomes WHERE token_id = $1',
        [outcomeId] // outcomeId is the asset_id (token_id)
      );

      if (outcomeResult.rows.length === 0) {
        // Outcome not in database - likely from a market we haven't synced yet
        // Try to auto-sync the market if we have the sync service available
        if (this.marketSyncService && !this.syncingAssetIds.has(outcomeId)) {
          this.syncingAssetIds.add(outcomeId);
          console.log(`[Auto-Sync] Attempting to sync market for asset_id ${outcomeId}`);
          
          // Attempt to sync the market asynchronously (don't block price processing)
          this.attemptAutoSync(outcomeId).catch((error) => {
            console.error(`[Auto-Sync] Failed to sync market for asset_id ${outcomeId}:`, error);
            this.syncingAssetIds.delete(outcomeId);
          });
        } else if (!this.warnedAssetIds.has(outcomeId)) {
          // Only log once per asset_id to reduce log noise
          // Changed to info level since auto-sync will handle it
          console.log(`[Info] Outcome not found for asset_id ${outcomeId} (auto-sync will handle if market is active)`);
          this.warnedAssetIds.add(outcomeId);
          // Clear warning after 1 hour to allow re-logging if issue persists
          setTimeout(() => this.warnedAssetIds.delete(outcomeId), 3600000);
        }
        return;
      }
      
      outcome = outcomeResult.rows[0];
      // Update marketId from database (the event's marketId is actually an assetId)
      marketId = outcome.market_id;

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

      // Create minimal orderbook metrics from best bid/ask if we don't have full orderbook data
      // This provides basic spread information even when full orderbook isn't available
      if (price.bid > 0 && price.ask > 0) {
        const spread = price.ask - price.bid;
        const spreadPercent = midPrice > 0 ? (spread / midPrice) * 100 : 0;
        
        // Only store if spread is reasonable (not obviously bad data)
        if (spreadPercent <= 50 && price.bid > 0 && price.ask > 0 && price.bid < 1 && price.ask < 1) {
          // Create minimal orderbook entry from price data
          const minimalOrderbook = {
            spread,
            spreadPercent,
            depth2Percent: 0, // Can't calculate without full orderbook
            bestBid: price.bid,
            bestAsk: price.ask,
            midPrice,
            totalBidDepth: 0,
            totalAskDepth: 0,
            timestamp: Date.now(),
            marketId,
            outcomeId: outcome.id,
          };
          
          // Store in Redis with shorter TTL since it's less complete
          await RedisSlidingWindow.add(
            `orderbook:${outcome.token_id}`,
            minimalOrderbook,
            300000, // 5 minutes (shorter than full orderbook)
            60 // Max 60 data points
          );
        }
      }
      
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

      // Run anomaly detection on price update
      // Store price in Redis for velocity tracking
      const priceHistoryKey = `prices:${marketId}:${outcome.id}`;
      await RedisSlidingWindow.add(
        priceHistoryKey,
        {
          price: midPrice,
          timestamp: Date.now(),
        },
        7200000, // 2 hours TTL
        3600 // Max 3600 data points (1 per second for 1 hour)
      );

      // Detect price velocity and insider moves
      const priceVelocityAlert = await this.anomalyDetector.detectPriceVelocity(
        marketId,
        outcome.id,
        outcome.token_id,
        midPrice
      );

      if (priceVelocityAlert) {
        // Check for volume acceleration to confirm insider move
        // Get recent volume from trade history (last 1 minute)
        const recentTrades = await RedisSlidingWindow.getRange(
          `trades:${outcome.token_id}`,
          Date.now() - 60000, // Last 1 minute
          Date.now()
        );
        
        const recentVolume = recentTrades.reduce((sum: number, trade: any) => {
          return sum + (trade.size || 0);
        }, 0);

        // Only check insider move if we have meaningful volume (> $100)
        // This prevents false positives from tiny trades
        if (recentVolume > 100) {
          const insiderMoveAlert = await this.anomalyDetector.detectInsiderMove(
            marketId,
            outcome.id,
            outcome.token_id,
            midPrice,
            recentVolume,
            priceVelocityAlert // Pass the already-detected price velocity alert
          );

          if (insiderMoveAlert) {
            await this.anomalyDetector.storeAlert(insiderMoveAlert);
          }
        }
        // Note: We don't store price velocity alerts separately if volume is too low
        // This prevents meaningless alerts. Price velocity alone without volume is not actionable.
      }

      // Update last_trade_at and recalculate activity_score for the market
      // Activity score should reflect recent trading activity (price updates)
      // Calculate based on: recent price update frequency and recency of last trade
      const activityScoreResult = await query(
        `SELECT 
          COUNT(*) as recent_updates,
          MAX(timestamp) as last_update
        FROM price_history
        WHERE market_id = $1
          AND timestamp >= NOW() - INTERVAL '24 hours'`,
        [marketId]
      );
      
      const recentUpdates = parseInt(activityScoreResult.rows[0]?.recent_updates || '0', 10);
      const lastUpdate = activityScoreResult.rows[0]?.last_update;
      
      // Calculate activity score:
      // - Base score from recent update count (0-50 points, capped at 100 updates = 50 points)
      // - Recency bonus (0-50 points) based on how recent the last update was
      let activityScore = Math.min(recentUpdates / 100 * 50, 50);
      
      if (lastUpdate) {
        const hoursSinceUpdate = (Date.now() - new Date(lastUpdate).getTime()) / (1000 * 60 * 60);
        if (hoursSinceUpdate < 0.5) {
          activityScore += 50; // Updated in last 30 minutes
        } else if (hoursSinceUpdate < 1) {
          activityScore += 40; // Updated in last hour
        } else if (hoursSinceUpdate < 6) {
          activityScore += 25; // Updated in last 6 hours
        } else if (hoursSinceUpdate < 24) {
          activityScore += 10; // Updated in last 24 hours
        }
      }
      
      // Cap at 100 (activity score should be 0-100, but also ensure it fits DECIMAL(10, 5))
      activityScore = Math.min(100, Math.max(0, activityScore));
      
      await query(
        `UPDATE markets 
         SET last_trade_at = NOW(), 
             activity_score = $2,
             updated_at = NOW()
         WHERE id = $1`,
        [marketId, activityScore]
      );
    } catch (error) {
      console.error('Error handling price event:', error);
    }
  }

  /**
   * Handle trade events from WebSocket
   * 
   * IMPORTANT: Each outcome has its own token_id/assetId, so trades are stored per outcome.
   * For bucket markets (e.g., GDP growth with buckets like "<0.5%", "0.5-1.0%"), each bucket
   * is a separate outcome with its own token_id, and therefore has its own trade history.
   */
  public async handleTradeEvent(event: PolymarketTradeEvent): Promise<void> {
    try {
      const { assetId, price, size, timestamp, side } = event;
      
      // Find the outcome by token_id (assetId)
      // Each outcome has a unique token_id, so this maps to exactly one outcome
      const outcomeResult = await query(
        'SELECT id, market_id, token_id FROM outcomes WHERE token_id = $1',
        [assetId]
      );
      
      if (outcomeResult.rows.length === 0) {
        // Outcome not found - likely from unsynced market
        // Silently ignore (we already warn in handlePriceEvent)
        return;
      }
      
      const outcome = outcomeResult.rows[0];
      const marketId = outcome.market_id;
      
      // IMPORTANT: In Polymarket CLOB WebSocket, 'size' is likely in SHARES, not USDC
      // To get USDC value, we multiply: size (shares) × price (USDC per share)
      // However, if 'size' is already very large (> $1000) and price is small (< 0.1),
      // it's possible 'size' is already in USDC. We'll calculate both and use the more reasonable value.
      const sizeInUSDC = size * price;
      
      // Sanity check: If calculated USDC seems unreasonably large, 'size' might already be in USDC
      // Use size directly if: size > 1000 AND sizeInUSDC > size * 10 (indicates price was incorrectly used)
      const finalSizeInUSDC = (size > 1000 && sizeInUSDC > size * 10) ? size : sizeInUSDC;
      
      // Store trade in Redis sliding window (last 100 trades, 24 hour TTL)
      // Key is per token_id (which is per outcome), so each outcome has its own trade history
      // Store both original size and calculated USDC value
      await RedisSlidingWindow.add(
        `trades:${assetId}`, // assetId is the token_id, unique per outcome
        {
          price,
          size, // Original value from WebSocket
          sizeInUSDC: finalSizeInUSDC, // Calculated USDC value
          timestamp,
          side,
          marketId,
          outcomeId: outcome.id,
        },
        86400000, // 24 hours
        100 // Max 100 trades
      );
      
      // Broadcast trade update to frontend if WebSocket server is available
      if (this.wsServer) {
        this.wsServer.broadcastTradeUpdate({
          marketId,
          outcomeId: outcome.id,
          tokenId: assetId,
          price,
          size: finalSizeInUSDC, // Send USDC value to frontend
          timestamp,
          side,
        });
      }
      
      // Detect whale trades - use USDC value
      const whaleAlert = this.anomalyDetector.detectWhaleTrade(
        marketId,
        outcome.id,
        assetId,
        finalSizeInUSDC // Use USDC value for whale detection
      );

      if (whaleAlert) {
        await this.anomalyDetector.storeAlert(whaleAlert);
        console.log(`[Whale Trade] Asset ${assetId} (Market: ${marketId}): $${finalSizeInUSDC.toFixed(2)} USDC (raw size: ${size.toFixed(2)}, price: ${price.toFixed(4)})`);
      }

      // Detect fat finger (price deviation + reversion)
      const fatFingerAlert = await this.anomalyDetector.detectFatFinger(
        marketId,
        outcome.id,
        assetId,
        price
      );

      if (fatFingerAlert) {
        await this.anomalyDetector.storeAlert(fatFingerAlert);
      }

      // Store volume in Redis for acceleration detection
      // Use USDC value for volume tracking (consistent with how volume is typically measured)
      const volumeKey = `volume:${marketId}:${outcome.id}`;
      await RedisSlidingWindow.add(
        volumeKey,
        {
          volume: finalSizeInUSDC, // Use USDC value for volume
          timestamp: Date.now(),
        },
        7200000, // 2 hours TTL
        3600 // Max 3600 data points
      );

      // Detect volume acceleration - use USDC value
      const volumeAccelerationAlert = await this.anomalyDetector.detectVolumeAcceleration(
        marketId,
        outcome.id,
        assetId,
        finalSizeInUSDC // Use USDC value for volume acceleration detection
      );

      if (volumeAccelerationAlert) {
        await this.anomalyDetector.storeAlert(volumeAccelerationAlert);
      }
      
      // Update last_trade_at and activity_score when a trade occurs
      // Trades are a strong indicator of activity
      const activityScoreResult = await query(
        `SELECT 
          COUNT(*) as recent_updates,
          MAX(timestamp) as last_update
        FROM price_history
        WHERE market_id = $1
          AND timestamp >= NOW() - INTERVAL '24 hours'`,
        [marketId]
      );
      
      const recentUpdates = parseInt(activityScoreResult.rows[0]?.recent_updates || '0', 10);
      
      // Calculate activity score with trade bonus
      // Trades are very recent activity, so give high recency bonus
      let activityScore = Math.min(recentUpdates / 100 * 50, 50);
      activityScore += 50; // Trade just happened - strong activity signal
      
      // Cap at 100 (activity score should be 0-100, but also ensure it fits DECIMAL(10, 5))
      activityScore = Math.min(100, Math.max(0, activityScore));
      
      await query(
        `UPDATE markets 
         SET last_trade_at = NOW(), 
             activity_score = $2,
             updated_at = NOW()
         WHERE id = $1`,
        [marketId, activityScore]
      );
    } catch (error) {
      console.error('Error handling trade event:', error);
    }
  }

  /**
   * Handle orderbook events from WebSocket
   * 
   * IMPORTANT: Each outcome has its own token_id/assetId, so orderbook is stored per outcome.
   * For bucket markets (e.g., GDP growth with buckets like "<0.5%", "0.5-1.0%"), each bucket
   * is a separate outcome with its own token_id, and therefore has its own orderbook.
   */
  public async handleOrderbookEvent(event: PolymarketOrderbookEvent): Promise<void> {
    try {
      const { assetId, bids, asks, timestamp } = event;
      
      if (bids.length === 0 || asks.length === 0) {
        // Empty orderbook, skip
        return;
      }
      
      // Find the outcome by token_id (assetId)
      // Each outcome has a unique token_id, so this maps to exactly one outcome
      const outcomeResult = await query(
        'SELECT id, market_id, token_id FROM outcomes WHERE token_id = $1',
        [assetId]
      );
      
      if (outcomeResult.rows.length === 0) {
        // Outcome not found - likely from unsynced market
        return;
      }
      
      const outcome = outcomeResult.rows[0];
      const marketId = outcome.market_id;
      
      // Calculate orderbook metrics for this specific outcome
      const metrics = this.calculateOrderbookMetrics(bids, asks);
      
      // Validate metrics - filter out obviously incorrect data
      // If spread is > 50% of mid-price, it's likely bad data (e.g., stale or wrong outcome)
      if (metrics.spreadPercent > 50 || metrics.bestBid <= 0 || metrics.bestAsk <= 0 || metrics.bestBid >= 1 || metrics.bestAsk >= 1) {
        console.log(`[Orderbook] Skipping invalid metrics for asset ${assetId}: spread=${(metrics.spread * 100).toFixed(2)}¢ (${metrics.spreadPercent.toFixed(2)}%), bid=${metrics.bestBid}, ask=${metrics.bestAsk}`);
        return;
      }
      
      // Log orderbook data for debugging (only for first few entries to avoid spam)
      if (Math.random() < 0.01) { // Log 1% of events
        console.log(`[Orderbook] Asset ${assetId}: ${bids.length} bids, ${asks.length} asks, spread=${(metrics.spread * 100).toFixed(2)}¢, bid=${metrics.bestBid.toFixed(4)}, ask=${metrics.bestAsk.toFixed(4)}`);
      }
      
      // Store orderbook metrics in Redis sliding window (60 minutes, max 3600 data points)
      // Key is per token_id (which is per outcome), so each outcome has its own orderbook
      await RedisSlidingWindow.add(
        `orderbook:${assetId}`, // assetId is the token_id, unique per outcome
        {
          ...metrics,
          timestamp,
          marketId,
          outcomeId: outcome.id,
        },
        3600000, // 60 minutes
        3600 // Max 3600 data points (1 per second)
      );
      
      // Detect liquidity vacuum using anomaly detector
      const liquidityAlert = await this.anomalyDetector.detectLiquidityVacuum(
        marketId,
        outcome.id,
        assetId,
        metrics.spread,
        metrics.depth2Percent
      );

      if (liquidityAlert) {
        await this.anomalyDetector.storeAlert(liquidityAlert);
        console.log(`[Liquidity Vacuum] Asset ${assetId} (Market: ${marketId}): Spread widened to ${(metrics.spread * 100).toFixed(2)} cents`);
      }
      
    } catch (error) {
      console.error('Error handling orderbook event:', error);
    }
  }

  /**
   * Calculate orderbook metrics: spread, depth, etc.
   */
  private calculateOrderbookMetrics(
    bids: Array<{ price: number; size: number }>,
    asks: Array<{ price: number; size: number }>
  ): {
    spread: number; // bid-ask spread in cents
    spreadPercent: number; // spread as % of mid-price
    depth2Percent: number; // Total depth within 2% of mid-price
    bestBid: number;
    bestAsk: number;
    midPrice: number;
    totalBidDepth: number; // Total depth on bid side
    totalAskDepth: number; // Total depth on ask side
  } {
    if (bids.length === 0 || asks.length === 0) {
      return {
        spread: 0,
        spreadPercent: 0,
        depth2Percent: 0,
        bestBid: 0,
        bestAsk: 0,
        midPrice: 0,
        totalBidDepth: 0,
        totalAskDepth: 0,
      };
    }
    
    // Sort bids descending (highest price first = best bid)
    // Sort asks ascending (lowest price first = best ask)
    const sortedBids = [...bids].sort((a, b) => b.price - a.price);
    const sortedAsks = [...asks].sort((a, b) => a.price - b.price);
    
    const bestBid = sortedBids[0].price;
    const bestAsk = sortedAsks[0].price;
    const midPrice = (bestBid + bestAsk) / 2;
    const spread = bestAsk - bestBid;
    const spreadPercent = midPrice > 0 ? (spread / midPrice) * 100 : 0;
    
    // Calculate depth within 2% of mid-price
    // Use the larger of: 2% of mid-price OR the spread itself
    // This ensures we capture depth even when spread is wider than 2%
    const twoPercentRange = Math.max(midPrice * 0.02, spread);
    const minPrice = midPrice - twoPercentRange;
    const maxPrice = midPrice + twoPercentRange;
    
    let depth2Percent = 0;
    
    // Sum bid depth within range (use sorted bids)
    // Bids should be at or below mid-price, within the range
    for (const bid of sortedBids) {
      if (bid.price >= minPrice && bid.price <= midPrice) {
        depth2Percent += bid.size;
      } else if (bid.price < minPrice) {
        // Stop if we've gone too far below the range
        break;
      }
    }
    
    // Sum ask depth within range (use sorted asks)
    // Asks should be at or above mid-price, within the range
    for (const ask of sortedAsks) {
      if (ask.price >= midPrice && ask.price <= maxPrice) {
        depth2Percent += ask.size;
      } else if (ask.price > maxPrice) {
        // Stop if we've gone too far above the range
        break;
      }
    }
    
    // Calculate total depth on each side (use sorted arrays)
    const totalBidDepth = sortedBids.reduce((sum, bid) => sum + bid.size, 0);
    const totalAskDepth = sortedAsks.reduce((sum, ask) => sum + ask.size, 0);
    
    return {
      spread,
      spreadPercent,
      depth2Percent,
      bestBid,
      bestAsk,
      midPrice,
      totalBidDepth,
      totalAskDepth,
    };
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
   * Also fetches initial orderbook state from REST API
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
        
        // Fetch initial orderbook state from REST API before subscribing to WebSocket
        console.log(`[Subscription] Fetching initial orderbook state for ${assetIds.length} tokens from REST API...`);
        const orderbooks = await this.restClient.fetchOrderBooks(assetIds);
        
        // Process each orderbook
        for (const [tokenId, orderbook] of orderbooks.entries()) {
          await this.processOrderbookFromRest(tokenId, orderbook);
        }
        console.log(`[Subscription] Loaded ${orderbooks.size} initial orderbooks from REST API`);
        
        // Batch subscribe to all asset_ids at once for WebSocket updates
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
   * Attempt to auto-sync a market when we receive price updates for an unsynced market
   */
  private async attemptAutoSync(assetId: string): Promise<void> {
    try {
      // Step 1: Fetch orderbook to get the market ID (condition_id)
      const orderbook = await this.restClient.fetchOrderBook(assetId);
      
      if (!orderbook || !orderbook.market) {
        console.warn(`[Auto-Sync] Could not get market ID from orderbook for asset_id ${assetId}`);
        this.syncingAssetIds.delete(assetId);
        return;
      }

      const marketId = orderbook.market; // This is typically the condition_id
      console.log(`[Auto-Sync] Found market ID ${marketId} for asset_id ${assetId}`);

      // Step 2: Check if market is already in database (race condition check)
      // Note: The market ID in our database is typically the conditionId or questionId from Polymarket
      const existingMarket = await query(
        'SELECT id FROM markets WHERE id = $1',
        [marketId]
      );

      if (existingMarket.rows.length > 0) {
        console.log(`[Auto-Sync] Market ${marketId} already exists in database, subscribing...`);
        // Market exists, just subscribe to it
        await this.subscribeToMarkets([existingMarket.rows[0].id]);
        this.syncingAssetIds.delete(assetId);
        return;
      }

      // Step 3: Fetch full market details from REST API
      console.log(`[Auto-Sync] Fetching market details for ${marketId}...`);
      let pmMarket = await this.restClient.fetchMarket(marketId);
      
      if (!pmMarket) {
        // Try alternative: fetch from Gamma API using condition_id
        console.log(`[Auto-Sync] Trying Gamma API for market ${marketId}...`);
        const tokens = await this.restClient.fetchMarketTokens(marketId);
        if (tokens.length > 0) {
          // We have tokens, create a minimal market object
          pmMarket = {
            conditionId: marketId,
            questionId: marketId,
            question: `Market ${marketId}`,
            outcomes: tokens.map(t => ({
              id: t.token_id,
              tokenId: t.token_id,
              outcome: t.outcome,
            })),
          };
        } else {
          console.warn(`[Auto-Sync] Could not fetch market details for ${marketId}`);
          this.syncingAssetIds.delete(assetId);
          return;
        }
      }

      // Step 4: Check if market is high-volume (sync even if restricted)
      const volume24h = parseFloat(pmMarket.volume24h || '0');
      const totalVolume = parseFloat(pmMarket.volume || '0');
      const HIGH_VOLUME_THRESHOLD = 100000; // $100k 24h volume or $500k total volume
      
      if (volume24h >= HIGH_VOLUME_THRESHOLD || totalVolume >= HIGH_VOLUME_THRESHOLD * 5) {
        console.log(`[Auto-Sync] High-volume market detected: ${volume24h} 24h, ${totalVolume} total - proceeding with sync`);
      }
      
      // Step 5: Sync the market to database
      console.log(`[Auto-Sync] Syncing market ${marketId} to database...`);
      if (this.marketSyncService) {
        await this.marketSyncService.syncMarket(pmMarket);
        
        // Step 6: Get the database market ID and subscribe
        // Note: The market ID in our database is typically the conditionId or questionId from Polymarket
        const syncedMarket = await query(
          'SELECT id FROM markets WHERE id = $1',
          [marketId]
        );

        if (syncedMarket.rows.length > 0) {
          const dbMarketId = syncedMarket.rows[0].id;
          console.log(`[Auto-Sync] Successfully synced market ${marketId} (DB ID: ${dbMarketId}), subscribing...`);
          await this.subscribeToMarkets([dbMarketId]);
          console.log(`[Auto-Sync] Successfully auto-synced and subscribed to market ${marketId}`);
        } else {
          console.warn(`[Auto-Sync] Market ${marketId} was synced but not found in database`);
        }
      }
    } catch (error) {
      console.error(`[Auto-Sync] Error during auto-sync for asset_id ${assetId}:`, error);
    } finally {
      this.syncingAssetIds.delete(assetId);
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

