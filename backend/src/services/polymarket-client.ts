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
    if (typeof message === 'object' && message !== null) {
      const msg = message as Record<string, any>;
      const eventType = (msg.event_type || msg.type) as string;

      // Log specific interesting messages
      if (eventType !== 'info' && eventType !== 'pong') {
        console.log(`[WebSocket Handler] Processing ${eventType} for ${msg.asset_id || 'multiple assets'}`);
      }

      if (eventType === 'price_change' || eventType === 'book' || eventType === 'price_changed' || eventType === 'update') {
        if (Array.isArray(msg.price_changes)) {
          for (const pc of msg.price_changes) {
            const assetId = (pc.asset_id || pc.token_id) as string;
            const bid = parseFloat(String(pc.best_bid || pc.bid || 0));
            const ask = parseFloat(String(pc.best_ask || pc.ask || 0));
            if (assetId && (bid > 0 || ask > 0)) {
              this.emitPriceEvent(assetId, bid, ask, (eventType === 'book' ? 'order_book_changed' : 'price_changed'));
            }
          }
          return;
        }

        const assetId = (msg.asset_id || msg.token_id || msg.id) as string;
        if (!assetId) return;

        let bid = 0;
        let ask = 0;
        if (msg.best_bid !== undefined) bid = typeof msg.best_bid === 'string' ? parseFloat(msg.best_bid) : msg.best_bid;
        else if (msg.bid !== undefined) bid = typeof msg.bid === 'string' ? parseFloat(msg.bid) : msg.bid;

        if (msg.best_ask !== undefined) ask = typeof msg.best_ask === 'string' ? parseFloat(msg.best_ask) : msg.best_ask;
        else if (msg.ask !== undefined) ask = typeof msg.ask === 'string' ? parseFloat(msg.ask) : msg.ask;
        
        if (bid > 0 || ask > 0) {
          this.emitPriceEvent(assetId, bid, ask, (eventType === 'book' ? 'order_book_changed' : 'price_changed'));
        }
        return;
      }
      
      if (eventType === 'last_trade_price' || eventType === 'trade') {
        const assetId = (msg.asset_id || msg.token_id || msg.id) as string;
        if (!assetId) return;
        const price = msg.price ? (typeof msg.price === 'string' ? parseFloat(msg.price) : msg.price) : 0;
        if (price > 0) {
          this.emitPriceEvent(assetId, price, price, 'price_changed');
        }
        return;
      }
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

  private sendSubscription(): void {
    if (!this.isConnected || !this.ws || this.subscribedAssetIds.size === 0) {
      return;
    }

    // The /ws/market endpoint expects a literal array of token ID strings
    // This replaces any previous subscription list on this connection
    const assetIdsArray = Array.from(this.subscribedAssetIds);
    
    try {
      const msg = JSON.stringify(assetIdsArray);
      // Log only the first few IDs to avoid log bloat
      const logIds = assetIdsArray.length > 5 
        ? `[${assetIdsArray.slice(0, 5).join(', ')}... (+${assetIdsArray.length - 5} more)]`
        : msg;
      
      console.log(`[WebSocket Subscribe] Sending full list of ${assetIdsArray.length} assets: ${logIds}`);
      this.ws.send(msg);
    } catch (error) {
      console.error(`Error sending subscription array:`, error);
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
