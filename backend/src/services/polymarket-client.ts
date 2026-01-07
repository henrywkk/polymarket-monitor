import WebSocket from 'ws';

export interface PolymarketPriceEvent {
  type: 'price_changed' | 'order_book_changed';
  market: string;
  outcome: string;
  price: {
    bid: number;
    ask: number;
  };
  timestamp: number;
}

export interface PolymarketSubscription {
  type: 'MARKET' | 'USER' | 'subscribe' | 'unsubscribe'; // MARKET for CLOB WebSocket
  assets_ids?: string[]; // Note: "assets_ids" not "asset_ids" per Polymarket docs
  asset_ids?: string[]; // Legacy support
  channel?: string;
  market?: string; // Legacy support
}

export class PolymarketWebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000; // Start with 1 second
  private maxReconnectDelay = 30000; // Max 30 seconds
  private isConnected = false;
  private subscriptions = new Set<string>(); // Track subscribed asset_ids
  private subscribedAssetIds = new Set<string>(); // Track asset IDs for batch subscription
  private messageHandlers: Map<string, (data: PolymarketPriceEvent) => void> = new Map();
  private pingInterval: NodeJS.Timeout | null = null;
  private heartbeatInterval = 5000; // 5 seconds (required by Polymarket)

  constructor(url?: string) {
    // Default to correct CLOB WebSocket URL if not provided
    // Per poly-websockets library: wss://ws-subscriptions-clob.polymarket.com/ws/market
    this.url = url || 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Only log connection attempts occasionally to reduce log spam
        if (this.reconnectAttempts === 0 || this.reconnectAttempts % 5 === 0) {
          console.log(`Connecting to Polymarket CLOB WebSocket: ${this.url}`);
        }
        
        // Verify URL has correct path
        // Per poly-websockets library, should be: wss://ws-subscriptions-clob.polymarket.com/ws/market
        if (!this.url.includes('/ws/market')) {
          console.warn(`WebSocket URL may be incorrect. Expected to include /ws/market but got: ${this.url}`);
          console.warn(`Correct URL format: wss://ws-subscriptions-clob.polymarket.com/ws/market`);
        }
        
        // Add headers to help with WebSocket upgrade
        this.ws = new WebSocket(this.url, {
          headers: {
            'User-Agent': 'Polymarket-Monitor/1.0',
          },
        });

        this.ws.on('open', () => {
          console.log(`[WebSocket] Successfully connected to: ${this.url}`);
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.reconnectDelay = 1000;
          
          // Start ping/pong heartbeat
          this.startHeartbeat();
          
          // Resubscribe to all previous asset_ids
          if (this.subscribedAssetIds.size > 0) {
            console.log(`[WebSocket] Resubscribing to ${this.subscribedAssetIds.size} previously subscribed assets`);
            this.subscribeToAssets(Array.from(this.subscribedAssetIds));
          }
          
          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          try {
            const messageStr = data.toString();
            
            // Handle plain text messages (e.g., "INVALID OPERATION", "PONG")
            if (typeof messageStr === 'string' && !messageStr.trim().startsWith('{') && !messageStr.trim().startsWith('[')) {
              // Plain text message - could be PONG, error, or status
              if (messageStr.trim() === 'PONG' || messageStr.trim() === 'pong') {
                // Heartbeat acknowledged
                return;
              } else if (messageStr.trim() === 'INVALID OPERATION') {
                // Server is telling us we need to subscribe first (this is normal before subscription)
                // Only log once to avoid spam
                if (this.reconnectAttempts === 0 && !this.subscribedAssetIds.has('_logged_invalid_op')) {
                  console.log('[WebSocket] Server responded with "INVALID OPERATION" - this is normal before subscribing to assets');
                  this.subscribedAssetIds.add('_logged_invalid_op'); // Flag to prevent repeated logging
                }
                return;
              } else {
                // Other plain text messages
                console.log(`[WebSocket] Received plain text message: ${messageStr}`);
                return;
              }
            }
            
            // Try to parse as JSON
            const message = JSON.parse(messageStr);
            
            // Handle PONG responses (Polymarket uses uppercase)
            if (message.type === 'PONG' || message.type === 'pong' || message === 'PONG' || message === 'pong') {
              // Heartbeat acknowledged, connection is alive
              return;
            }
            
            // Log first few messages for debugging
            if (this.reconnectAttempts === 0) {
              console.log(`[WebSocket Message] Received JSON:`, JSON.stringify(message).substring(0, 200));
            }
            
            this.handleMessage(message);
          } catch (error) {
            // If it's not JSON and not plain text we recognize, log it
            const messageStr = data.toString();
            if (!messageStr.trim().match(/^(PONG|pong|INVALID OPERATION)$/i)) {
              console.error('Error parsing WebSocket message:', error);
              console.error('Raw message:', messageStr.substring(0, 200));
            }
          }
        });

        this.ws.on('error', (error) => {
          const errorMsg = error instanceof Error ? error.message : String(error);
          
          // Always log 404 errors with full context
          if (errorMsg.includes('Unexpected server response: 404')) {
            console.error(`[WebSocket 404] Failed to connect to: ${this.url}`);
            console.error('[WebSocket 404] Possible causes:');
            console.error('  1. Incorrect URL - should be: wss://ws-subscriptions-clob.polymarket.com/ws/');
            console.error('  2. Endpoint requires authentication');
            console.error('  3. Endpoint may have changed or been deprecated');
            console.error(`[WebSocket 404] Current URL: ${this.url}`);
            console.error(`[WebSocket 404] Check POLYMARKET_WS_URL environment variable if set`);
          } else if (errorMsg.includes('Unexpected server response: 200')) {
            console.warn('WebSocket endpoint may not support WebSocket protocol. Continuing without real-time updates.');
          } else if (this.reconnectAttempts === 0 || this.reconnectAttempts % 5 === 0) {
            // Only log other errors occasionally to avoid spam
            console.error('WebSocket error:', errorMsg);
          }
          
          this.isConnected = false;
          // Don't reject on first attempt - allow graceful degradation
          if (this.reconnectAttempts === 0) {
            // Resolve instead of reject to allow server to continue
            resolve();
          }
        });

        this.ws.on('close', (code, reason) => {
          this.stopHeartbeat();
          // Only log close events occasionally
          if (this.reconnectAttempts === 0 || this.reconnectAttempts % 5 === 0) {
            console.log(`WebSocket closed: ${code} - ${reason.toString()}`);
          }
          this.isConnected = false;
          this.attemptReconnect();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  private handleMessage(message: unknown): void {
    // Handle different message types from Polymarket CLOB WebSocket
    if (typeof message === 'object' && message !== null) {
      const msg = message as Record<string, unknown>;
      
      // CLOB WebSocket sends updates per migration guide:
      // After migration, uses: { type: 'update', asset_id: '...', best_bid: ..., best_ask: ..., ... }
      // See: https://docs.polymarket.com/developers/CLOB/websocket/market-channel-migration-guide
      if (msg.type === 'update' || msg.type === 'price_update' || msg.type === 'price' || msg.type === 'price_changed' || msg.type === 'order_book_changed') {
        // Extract asset_id (token_id) - this is the key field
        const assetId = (msg.asset_id || msg.token_id || msg.id) as string;
        
        // Per migration guide, use best_bid and best_ask (not bid/ask)
        // Price can be in different formats:
        // 1. { best_bid: ..., best_ask: ... } (new format per migration guide)
        // 2. { price: { best_bid: ..., best_ask: ... } }
        // 3. { bid: ..., ask: ... } (legacy format)
        let bid = 0;
        let ask = 0;
        
        // Prioritize best_bid/best_ask (new format)
        if (msg.best_bid !== undefined || msg.best_ask !== undefined) {
          bid = (msg.best_bid as number) || 0;
          ask = (msg.best_ask as number) || 0;
        } else if (msg.price && typeof msg.price === 'object') {
          const priceObj = msg.price as Record<string, unknown>;
          bid = (priceObj.best_bid as number) || (priceObj.bid as number) || 0;
          ask = (priceObj.best_ask as number) || (priceObj.ask as number) || 0;
        } else {
          // Fallback to legacy format
          bid = (msg.bid as number) || 0;
          ask = (msg.ask as number) || 0;
        }
        
        if (!assetId || (bid === 0 && ask === 0)) {
          // Skip invalid messages
          return;
        }
        
        // Map asset_id to market/outcome
        // asset_id is the token_id, which we'll use to look up the market in handlePriceEvent
        const event: PolymarketPriceEvent = {
          type: msg.type === 'order_book_changed' ? 'order_book_changed' : 'price_changed',
          market: assetId, // Will be resolved to market_id in handlePriceEvent
          outcome: assetId, // This is the asset_id (token_id)
          price: {
            bid,
            ask,
          },
          timestamp: Date.now(),
        };
        
        // Call registered handlers by asset_id
        const handler = this.messageHandlers.get(assetId);
        if (handler) {
          handler(event);
        }
        
        // Also call global handler if exists
        const globalHandler = this.messageHandlers.get('*');
        if (globalHandler) {
          globalHandler(event);
        }
      }
    }
  }

  /**
   * Subscribe to market updates using asset_ids (token IDs)
   * Polymarket CLOB WebSocket format: { "type": "MARKET", "assets_ids": [...] }
   */
  subscribeToAssets(assetIds: string[]): void {
    if (!this.isConnected || !this.ws) {
      // Queue for later subscription
      assetIds.forEach(id => this.subscribedAssetIds.add(id));
      return;
    }

    // CLOB WebSocket expects: { type: 'MARKET', assets_ids: [...] }
    // Note: "assets_ids" (plural) not "asset_ids"
    const subscription: PolymarketSubscription = {
      type: 'MARKET',
      assets_ids: assetIds,
    };

    try {
      const subscriptionMessage = JSON.stringify(subscription);
      console.log(`[WebSocket Subscribe] Sending subscription request:`, {
        url: this.url,
        message: subscriptionMessage,
        assetCount: assetIds.length,
        firstFewAssets: assetIds.slice(0, 5),
      });
      
      this.ws.send(subscriptionMessage);
      assetIds.forEach(id => {
        this.subscribedAssetIds.add(id);
        this.subscriptions.add(id);
      });
      console.log(`Successfully subscribed to ${assetIds.length} asset(s): ${assetIds.slice(0, 3).join(', ')}${assetIds.length > 3 ? '...' : ''}`);
    } catch (error) {
      console.error(`Error subscribing to assets:`, error);
    }
  }

  /**
   * Subscribe to a single asset_id (token ID)
   */
  subscribe(assetId: string): void {
    this.subscribeToAssets([assetId]);
  }

  /**
   * Legacy method for backward compatibility
   * @deprecated Use subscribe(assetId) or subscribeToAssets(assetIds) instead
   */
  subscribeLegacy(marketId: string, outcome?: string): void {
    const channel = outcome ? `${marketId}-${outcome}` : marketId;
    
    if (!this.isConnected || !this.ws) {
      this.subscriptions.add(channel);
      return;
    }

    const subscription: PolymarketSubscription = {
      type: 'subscribe',
      channel: outcome ? 'orderbook' : 'market',
      market: marketId,
    };

    try {
      this.ws.send(JSON.stringify(subscription));
      this.subscriptions.add(channel);
      console.log(`Subscribed to ${channel}`);
    } catch (error) {
      console.error(`Error subscribing to ${channel}:`, error);
    }
  }

  /**
   * Unsubscribe from asset_ids
   */
  unsubscribeFromAssets(assetIds: string[]): void {
    if (!this.ws || !this.isConnected) {
      assetIds.forEach(id => {
        this.subscribedAssetIds.delete(id);
        this.subscriptions.delete(id);
      });
      return;
    }

    const subscription: PolymarketSubscription = {
      type: 'unsubscribe',
      asset_ids: assetIds,
    };

    try {
      this.ws.send(JSON.stringify(subscription));
      assetIds.forEach(id => {
        this.subscribedAssetIds.delete(id);
        this.subscriptions.delete(id);
      });
      console.log(`Unsubscribed from ${assetIds.length} asset(s)`);
    } catch (error) {
      console.error(`Error unsubscribing from assets:`, error);
    }
  }

  /**
   * Unsubscribe from a single asset_id
   */
  unsubscribe(assetId: string): void {
    this.unsubscribeFromAssets([assetId]);
  }

  /**
   * Legacy method for backward compatibility
   */
  unsubscribeLegacy(marketId: string, outcome?: string): void {
    const channel = outcome ? `${marketId}-${outcome}` : marketId;
    
    if (!this.ws || !this.isConnected) {
      this.subscriptions.delete(channel);
      return;
    }

    const subscription: PolymarketSubscription = {
      type: 'unsubscribe',
      channel: outcome ? 'orderbook' : 'market',
      market: marketId,
    };

    try {
      this.ws.send(JSON.stringify(subscription));
      this.subscriptions.delete(channel);
      console.log(`Unsubscribed from ${channel}`);
    } catch (error) {
      console.error(`Error unsubscribing from ${channel}:`, error);
    }
  }

  onMessage(channel: string, handler: (data: PolymarketPriceEvent) => void): void {
    this.messageHandlers.set(channel, handler);
  }

  offMessage(channel: string): void {
    this.messageHandlers.delete(channel);
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.maxReconnectDelay
    );

    // Only log reconnection attempts occasionally
    if (this.reconnectAttempts % 5 === 0 || this.reconnectAttempts <= 3) {
      console.log(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    }

    setTimeout(() => {
      this.connect().catch((error) => {
        console.error('Reconnection failed:', error);
      });
    }, delay);
  }

  /**
   * Start ping/pong heartbeat to maintain connection
   * Polymarket requires PING every 5 seconds
   */
  private startHeartbeat(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    this.pingInterval = setInterval(() => {
      if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          // Send PING message (Polymarket expects uppercase "PING")
          const pingMessage = JSON.stringify({ type: 'PING' });
          this.ws.send(pingMessage);
          // Log first few pings for debugging
          if (this.reconnectAttempts === 0 && this.pingInterval) {
            console.log(`[WebSocket Ping] Sent: ${pingMessage}`);
          }
        } catch (error) {
          console.error('Error sending PING:', error);
          // Connection might be dead, trigger reconnect
          this.isConnected = false;
          this.attemptReconnect();
        }
      }
    }, this.heartbeatInterval);
  }

  /**
   * Stop heartbeat
   */
  private stopHeartbeat(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  disconnect(): void {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.subscriptions.clear();
    this.subscribedAssetIds.clear();
    this.messageHandlers.clear();
  }

  isConnectionActive(): boolean {
    return this.isConnected && this.ws?.readyState === WebSocket.OPEN;
  }
}

