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
  channel: string;
  market?: string;
}

export class PolymarketWebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000; // Start with 1 second
  private maxReconnectDelay = 30000; // Max 30 seconds
  private isConnected = false;
  private subscriptions = new Set<string>();
  private messageHandlers: Map<string, (data: PolymarketPriceEvent) => void> = new Map();

  constructor(url: string = 'wss://clob.polymarket.com') {
    this.url = url;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Only log connection attempts occasionally to reduce log spam
        if (this.reconnectAttempts === 0 || this.reconnectAttempts % 5 === 0) {
          console.log(`Connecting to Polymarket WebSocket: ${this.url}`);
        }
        this.ws = new WebSocket(this.url);

        this.ws.on('open', () => {
          console.log('Polymarket WebSocket connected');
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.reconnectDelay = 1000;
          
          // Resubscribe to all previous subscriptions
          this.subscriptions.forEach((channel) => {
            this.subscribe(channel);
          });
          
          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          try {
            const message = JSON.parse(data.toString());
            this.handleMessage(message);
          } catch (error) {
            console.error('Error parsing WebSocket message:', error);
          }
        });

        this.ws.on('error', (error) => {
          // Only log errors occasionally to avoid log spam
          if (this.reconnectAttempts === 0 || this.reconnectAttempts % 5 === 0) {
            console.error('WebSocket error:', error instanceof Error ? error.message : String(error));
          }
          this.isConnected = false;
          if (this.reconnectAttempts === 0) {
            reject(error);
          }
        });

        this.ws.on('close', (code, reason) => {
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
    // Handle different message types from Polymarket
    if (typeof message === 'object' && message !== null) {
      const msg = message as Record<string, unknown>;
      
      // Handle price_changed events
      if (msg.type === 'price_changed' || msg.type === 'order_book_changed') {
        const event = msg as unknown as PolymarketPriceEvent;
        const channel = `${event.market}-${event.outcome}`;
        
        // Call registered handlers
        const handler = this.messageHandlers.get(channel);
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

  subscribe(marketId: string, outcome?: string): void {
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

  unsubscribe(marketId: string, outcome?: string): void {
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

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.subscriptions.clear();
    this.messageHandlers.clear();
  }

  isConnectionActive(): boolean {
    return this.isConnected && this.ws?.readyState === WebSocket.OPEN;
  }
}

