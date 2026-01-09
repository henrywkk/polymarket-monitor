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

export interface PolymarketTradeEvent {
  assetId: string;
  price: number;
  size: number; // Trade size in USDC
  timestamp: number;
  side?: 'buy' | 'sell'; // If available
}

export interface PolymarketOrderbookEvent {
  assetId: string;
  bids: Array<{ price: number; size: number }>;
  asks: Array<{ price: number; size: number }>;
  timestamp: number;
}

export interface PolymarketSubscription {
  type: 'subscribe' | 'unsubscribe' | 'MARKET' | 'USER';
  assets_ids?: string[];
  channel?: string;
  market?: string;
}

export class PolymarketWebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private isConnected = false;
  private subscriptions = new Set<string>();
  private subscribedAssetIds = new Set<string>();
  private messageHandlers: Map<string, (data: PolymarketPriceEvent) => void> = new Map();
  private tradeHandlers: Map<string, (data: PolymarketTradeEvent) => void> = new Map();
  private orderbookHandlers: Map<string, (data: PolymarketOrderbookEvent) => void> = new Map();
  private pingInterval: NodeJS.Timeout | null = null;
  private heartbeatInterval = 5000;

  constructor(url?: string) {
    // Reverting to the URL that successfully connected in previous logs
    // The /ws/market path appears to be the correct one for the direct market channel
    this.url = url || 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        if (this.reconnectAttempts === 0 || this.reconnectAttempts % 5 === 0) {
          console.log(`Connecting to Polymarket CLOB WebSocket: ${this.url}`);
        }
        
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
          this.startHeartbeat();
          
          if (this.subscribedAssetIds.size > 0) {
            console.log(`[WebSocket] Resubscribing to ${this.subscribedAssetIds.size} assets`);
            this.subscribeToAssets(Array.from(this.subscribedAssetIds));
          }
          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          try {
            const messageStr = data.toString();
            
            // Log raw message for tracing
            const logSnippet = messageStr.length > 300 ? `${messageStr.substring(0, 300)}...` : messageStr;
            console.log(`[WebSocket Raw] Received: ${logSnippet}`);

            if (typeof messageStr === 'string' && !messageStr.trim().startsWith('{') && !messageStr.trim().startsWith('[')) {
              const trimmed = messageStr.trim();
              if (trimmed === 'PONG' || trimmed === 'pong') {
                console.log(`[WebSocket] Received PONG (plain text)`);
                return;
              } else if (trimmed === 'INVALID OPERATION') {
                console.warn('[WebSocket] Server responded with "INVALID OPERATION" - check subscription format');
                return;
              }
              return;
            }
            
            const message = JSON.parse(messageStr);
            if (message.type === 'pong' || message.type === 'PONG' || message === 'pong' || message === 'PONG') {
              console.log(`[WebSocket] Received PONG (JSON)`);
              return;
            }
            
            this.handleMessage(message);
          } catch (error) {
            const messageStr = data.toString();
            if (!messageStr.trim().match(/^(PONG|pong|INVALID OPERATION)$/i)) {
              console.error('Error parsing WebSocket message:', error);
            }
          }
        });

        this.ws.on('error', (error) => {
          const errorMsg = error instanceof Error ? error.message : String(error);
          if (errorMsg.includes('Unexpected server response: 404')) {
            console.error(`[WebSocket 404] Failed to connect to: ${this.url}`);
          } else if (this.reconnectAttempts === 0 || this.reconnectAttempts % 5 === 0) {
            console.error('WebSocket error:', errorMsg);
          }
          this.isConnected = false;
          if (this.reconnectAttempts === 0) resolve();
        });

        this.ws.on('close', (code, reason) => {
          this.stopHeartbeat();
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
    if (Array.isArray(message)) {
      message.forEach(msg => this.handleSingleMessage(msg));
    } else {
      this.handleSingleMessage(message);
    }
  }

  private handleSingleMessage(msg: any): void {
    if (typeof msg !== 'object' || msg === null) return;

    // Log full message structure for analysis (only in development, remove after analysis)
    if (process.env.NODE_ENV === 'development' && process.env.DEBUG_WEBSOCKET === 'true') {
      console.log('[WebSocket Debug] Full message:', JSON.stringify(msg, null, 2));
    }

    // Extract assetId once for reuse
    const assetId = (msg.asset_id || msg.token_id || msg.id) as string;

    // Polymarket CLOB WebSocket events
    // 1. Array of price_changes (most common for updates)
    if (Array.isArray(msg.price_changes)) {
      for (const pc of msg.price_changes) {
        const pcAssetId = (pc.asset_id || pc.token_id) as string;
        const bid = parseFloat(String(pc.best_bid || pc.bid || 0));
        const ask = parseFloat(String(pc.best_ask || pc.ask || 0));
        if (pcAssetId && (bid > 0 || ask > 0)) {
          this.emitPriceEvent(pcAssetId, bid, ask, 'price_changed');
        }
        
        // Check for trade data in price_changes
        const tradeSize = pc.size || pc.volume || pc.trade_size || pc.amount || pc.quantity;
        if (tradeSize && pcAssetId) {
          const tradePrice = bid || ask || parseFloat(String(pc.price || pc.last_price || 0));
          if (tradePrice > 0) {
            this.emitTradeEvent(pcAssetId, {
              price: tradePrice,
              size: parseFloat(String(tradeSize)),
              timestamp: Date.now(),
              side: pc.side || (bid > 0 ? 'buy' : 'sell'),
            });
          }
        }
      }
      return;
    }
    
    // Check for trade data in other message formats
    const tradeSize = msg.size || msg.volume || msg.trade_size || msg.amount || msg.quantity;
    if (tradeSize && assetId) {
      const tradePrice = parseFloat(String(msg.price || msg.last_price || msg.best_bid || msg.best_ask || 0));
      if (tradePrice > 0) {
        this.emitTradeEvent(assetId, {
          price: tradePrice,
          size: parseFloat(String(tradeSize)),
          timestamp: Date.now(),
          side: msg.side || undefined,
        });
      }
    }

    // 2. Orderbook updates (full book with bids and asks)
    if (Array.isArray(msg.bids) && Array.isArray(msg.asks)) {
      if (assetId) {
        // Parse full orderbook
        const bids = this.parseOrderbookSide(msg.bids);
        const asks = this.parseOrderbookSide(msg.asks);
        
        // Log when we receive orderbook data (occasionally for debugging)
        if (Math.random() < 0.01) { // Log 1% of events
          console.log(`[WebSocket] Received orderbook for ${assetId}: ${bids.length} bids, ${asks.length} asks`);
        }
        
        // Emit orderbook event
        this.emitOrderbookEvent(assetId, {
          bids,
          asks,
          timestamp: Date.now(),
        });
        
        // Also emit price event for backward compatibility
        if (bids.length > 0 && asks.length > 0) {
          // Sort before using first element
          const sortedBids = [...bids].sort((a, b) => b.price - a.price);
          const sortedAsks = [...asks].sort((a, b) => a.price - b.price);
          this.emitPriceEvent(assetId, sortedBids[0].price, sortedAsks[0].price, 'order_book_changed');
        }
      }
      return;
    }

    // 3. Direct market messages with best bid/ask
    const eventType = (msg.event_type || msg.type) as string;

    if (!assetId) return;

    let bid = 0;
    let ask = 0;

    if (msg.best_bid !== undefined && msg.best_ask !== undefined) {
      bid = typeof msg.best_bid === 'string' ? parseFloat(msg.best_bid) : msg.best_bid;
      ask = typeof msg.best_ask === 'string' ? parseFloat(msg.best_ask) : msg.best_ask;
    } else if (msg.price !== undefined) {
      const price = typeof msg.price === 'string' ? parseFloat(msg.price) : msg.price;
      bid = price;
      ask = price;
    }

    if (bid > 0 || ask > 0) {
      const type = (eventType === 'book' || msg.bids) ? 'order_book_changed' : 'price_changed';
      this.emitPriceEvent(assetId, bid, ask, type);
    }
  }

  private emitPriceEvent(assetId: string, bid: number, ask: number, eventType: 'price_changed' | 'order_book_changed'): void {
    const event: PolymarketPriceEvent = {
      type: eventType,
      market: assetId,
      outcome: assetId,
      price: { bid, ask },
      timestamp: Date.now(),
    };
    
    console.log(`[WebSocket] Emitting price update: ${assetId} -> ${bid}/${ask}`);
    
    const handler = this.messageHandlers.get(assetId);
    if (handler) handler(event);
    
    const globalHandler = this.messageHandlers.get('*');
    if (globalHandler) globalHandler(event);
  }

  private subscriptionTimeout: NodeJS.Timeout | null = null;

  subscribeToAssets(assetIds: string[]): void {
    // Add to our persistent set of monitored assets
    assetIds.forEach(id => this.subscribedAssetIds.add(id));
    
    // Use a small debounce to batch multiple subscription calls into one
    // This is important because each call now sends the FULL list of IDs
    if (this.subscriptionTimeout) {
      clearTimeout(this.subscriptionTimeout);
    }

    this.subscriptionTimeout = setTimeout(() => {
      this.sendSubscription();
      this.subscriptionTimeout = null;
    }, 500); // 500ms debounce
  }

  private lastSentAssetCount = 0;

  private sendSubscription(): void {
    if (!this.isConnected || !this.ws || this.subscribedAssetIds.size === 0) {
      return;
    }

    // Only send if the count has changed or we haven't sent anything yet
    // This prevents spamming the server with the same subscription list
    if (this.subscribedAssetIds.size === this.lastSentAssetCount) {
      // console.log(`[WebSocket Subscribe] Skipping: asset count unchanged (${this.lastSentAssetCount})`);
      return;
    }

    // According to Polymarket post-connection subscription documentation
    // once connected, the 'operation' field should be used.
    const assetIdsArray = Array.from(this.subscribedAssetIds);
    
    const subscription = {
      operation: 'subscribe',
      assets_ids: assetIdsArray
    };

    try {
      const msg = JSON.stringify(subscription);
      
      // Clean up logging to show valid JSON-like format even for long lists
      const logIds = assetIdsArray.length > 5 
        ? `{"operation":"subscribe","assets_ids":["${assetIdsArray.slice(0, 5).join('", "')}"... (+${assetIdsArray.length - 5} more)]}`
        : msg;
      
      console.log(`[WebSocket Subscribe] Sending update: ${logIds}`);
      this.ws.send(msg);
      this.lastSentAssetCount = this.subscribedAssetIds.size;
    } catch (error) {
      console.error(`Error sending subscription:`, error);
    }
  }

  subscribe(assetId: string): void {
    this.subscribeToAssets([assetId]);
  }

  unsubscribeFromAssets(assetIds: string[]): void {
    let changed = false;
    assetIds.forEach(id => {
      if (this.subscribedAssetIds.delete(id)) {
        changed = true;
      }
    });

    if (changed) {
      this.sendSubscription();
    }
  }

  unsubscribe(assetId: string): void {
    this.unsubscribeFromAssets([assetId]);
  }

  onMessage(channel: string, handler: (data: PolymarketPriceEvent) => void): void {
    this.messageHandlers.set(channel, handler);
  }

  offMessage(channel: string): void {
    this.messageHandlers.delete(channel);
  }

  onTrade(assetId: string, handler: (data: PolymarketTradeEvent) => void): void {
    this.tradeHandlers.set(assetId, handler);
  }

  offTrade(assetId: string): void {
    this.tradeHandlers.delete(assetId);
  }

  onOrderbook(assetId: string, handler: (data: PolymarketOrderbookEvent) => void): void {
    this.orderbookHandlers.set(assetId, handler);
  }

  offOrderbook(assetId: string): void {
    this.orderbookHandlers.delete(assetId);
  }

  /**
   * Parse orderbook side (bids or asks) into array of {price, size}
   */
  private parseOrderbookSide(side: any[]): Array<{ price: number; size: number }> {
    return side.map(item => {
      if (typeof item === 'object' && item !== null) {
        return {
          price: parseFloat(String(item.price || item[0] || 0)),
          size: parseFloat(String(item.size || item.amount || item.quantity || item[1] || 0)),
        };
      } else if (Array.isArray(item)) {
        // Array format: [price, size]
        return {
          price: parseFloat(String(item[0] || 0)),
          size: parseFloat(String(item[1] || 0)),
        };
      } else {
        // Single value (price only, size assumed to be 1)
        return {
          price: parseFloat(String(item || 0)),
          size: 1,
        };
      }
    }).filter(item => item.price > 0);
  }

  private emitTradeEvent(assetId: string, trade: { price: number; size: number; timestamp: number; side?: 'buy' | 'sell' }): void {
    const event: PolymarketTradeEvent = {
      assetId,
      price: trade.price,
      size: trade.size,
      timestamp: trade.timestamp,
      side: trade.side,
    };
    
    const handler = this.tradeHandlers.get(assetId);
    if (handler) handler(event);
    
    const globalHandler = this.tradeHandlers.get('*');
    if (globalHandler) globalHandler(event);
  }

  private emitOrderbookEvent(assetId: string, orderbook: { bids: Array<{ price: number; size: number }>; asks: Array<{ price: number; size: number }>; timestamp: number }): void {
    const event: PolymarketOrderbookEvent = {
      assetId,
      bids: orderbook.bids,
      asks: orderbook.asks,
      timestamp: orderbook.timestamp,
    };
    
    const handler = this.orderbookHandlers.get(assetId);
    if (handler) handler(event);
    
    const globalHandler = this.orderbookHandlers.get('*');
    if (globalHandler) globalHandler(event);
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;
    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), this.maxReconnectDelay);
    if (this.reconnectAttempts <= 3 || this.reconnectAttempts % 5 === 0) {
      console.log(`Attempting reconnect in ${delay}ms (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    }
    setTimeout(() => {
      this.connect().catch((error) => console.error('Reconnect failed:', error));
    }, delay);
  }

  private startHeartbeat(): void {
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.pingInterval = setInterval(() => {
      if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          // Some Polymarket endpoints expect a simple string "ping" instead of JSON
          // The poly-websockets library and standard CLOB often use this
          this.ws.send('ping');
          if (this.reconnectAttempts === 0) console.log(`[WebSocket Ping] Sent: ping`);
        } catch (error) {
          console.error('Error sending ping:', error);
          this.isConnected = false;
          this.attemptReconnect();
        }
      }
    }, this.heartbeatInterval);
  }

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
