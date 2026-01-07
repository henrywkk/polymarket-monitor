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
  type: 'subscribe' | 'unsubscribe';
  channel?: string;
  asset_ids?: string[]; // Token IDs (asset IDs) for CLOB WebSocket
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
  private heartbeatInterval = 8000; // 8 seconds (between 5-10 seconds)

  constructor(url: string = 'wss://ws-subscriptions-clob.polymarket.com/ws/') {
    this.url = url;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Only log connection attempts occasionally to reduce log spam
        if (this.reconnectAttempts === 0 || this.reconnectAttempts % 5 === 0) {
          console.log(`Connecting to Polymarket WebSocket: ${this.url}`);
        }
        
        // Add headers to help with WebSocket upgrade
        this.ws = new WebSocket(this.url, {
          headers: {
            'User-Agent': 'Polymarket-Monitor/1.0',
          },
        });

        this.ws.on('open', () => {
          console.log('Polymarket CLOB WebSocket connected');
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.reconnectDelay = 1000;
          
          // Start ping/pong heartbeat
          this.startHeartbeat();
          
          // Resubscribe to all previous asset_ids
          if (this.subscribedAssetIds.size > 0) {
            this.subscribeToAssets(Array.from(this.subscribedAssetIds));
          }
          
          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          try {
            const message = JSON.parse(data.toString());
            
            // Handle pong responses
            if (message.type === 'pong' || message === 'pong') {
              // Heartbeat acknowledged, connection is alive
              return;
            }
            
            this.handleMessage(message);
          } catch (error) {
            console.error('Error parsing WebSocket message:', error);
          }
        });

        this.ws.on('error', (error) => {
          // Only log errors occasionally to avoid log spam
          if (this.reconnectAttempts === 0 || this.reconnectAttempts % 5 === 0) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            // Don't treat "Unexpected server response: 200" as a critical error
            // This often means the endpoint doesn't support WebSocket or requires auth
            if (errorMsg.includes('Unexpected server response: 200')) {
              console.warn('WebSocket endpoint may not support WebSocket protocol. Continuing without real-time updates.');
            } else {
              console.error('WebSocket error:', errorMsg);
            }
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
      
      // CLOB WebSocket sends updates in format:
      // { type: 'update', asset_id: '...', price: {...}, ... }
      // or { type: 'price_update', asset_id: '...', ... }
      // or { type: 'price', asset_id: '...', bid: ..., ask: ..., ... }
      if (msg.type === 'update' || msg.type === 'price_update' || msg.type === 'price' || msg.type === 'price_changed' || msg.type === 'order_book_changed') {
        // Extract asset_id (token_id) and price data
        const assetId = (msg.asset_id || msg.token_id || msg.id) as string;
        
        // Price can be in different formats:
        // 1. { price: { bid: ..., ask: ... } }
        // 2. { bid: ..., ask: ... } (directly on message)
        // 3. { best_bid: ..., best_ask: ... }
        let bid = 0;
        let ask = 0;
        
        if (msg.price && typeof msg.price === 'object') {
          const priceObj = msg.price as Record<string, unknown>;
          bid = (priceObj.bid as number) || (priceObj.best_bid as number) || 0;
          ask = (priceObj.ask as number) || (priceObj.best_ask as number) || 0;
        } else {
          bid = (msg.bid as number) || (msg.best_bid as number) || 0;
          ask = (msg.ask as number) || (msg.best_ask as number) || 0;
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
   * This is the correct format for CLOB WebSocket
   */
  subscribeToAssets(assetIds: string[]): void {
    if (!this.isConnected || !this.ws) {
      // Queue for later subscription
      assetIds.forEach(id => this.subscribedAssetIds.add(id));
      return;
    }

    // CLOB WebSocket expects: { type: 'subscribe', asset_ids: [...] }
    const subscription: PolymarketSubscription = {
      type: 'subscribe',
      asset_ids: assetIds,
    };

    try {
      this.ws.send(JSON.stringify(subscription));
      assetIds.forEach(id => {
        this.subscribedAssetIds.add(id);
        this.subscriptions.add(id);
      });
      console.log(`Subscribed to ${assetIds.length} asset(s): ${assetIds.slice(0, 3).join(', ')}${assetIds.length > 3 ? '...' : ''}`);
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
   */
  private startHeartbeat(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    this.pingInterval = setInterval(() => {
      if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          // Send ping message
          this.ws.send(JSON.stringify({ type: 'ping' }));
        } catch (error) {
          console.error('Error sending ping:', error);
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

