import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { PolymarketPriceEvent } from './polymarket-client';

export class WebSocketServer {
  private io: SocketIOServer;

  constructor(httpServer: HTTPServer) {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: (origin, callback) => {
          // Allow requests with no origin (like mobile apps or curl requests)
          if (!origin) return callback(null, true);
          
          const allowedOrigins = [
            'http://localhost:5173',
            process.env.FRONTEND_URL,
            // Allow all Vercel preview deployments
            /\.vercel\.app$/,
          ].filter(Boolean);
          
          // Check if origin matches any allowed pattern
          const isAllowed = allowedOrigins.some(allowed => {
            if (typeof allowed === 'string') {
              return origin === allowed;
            }
            if (allowed instanceof RegExp) {
              return allowed.test(origin);
            }
            return false;
          });
          
          if (isAllowed) {
            callback(null, true);
          } else {
            callback(new Error('Not allowed by CORS'));
          }
        },
        methods: ['GET', 'POST'],
        credentials: true,
      },
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.io.on('connection', (socket) => {
      console.log(`Client connected: ${socket.id}`);

      socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
      });

      socket.on('subscribe_market', (marketId: string) => {
        socket.join(`market:${marketId}`);
        console.log(`Client ${socket.id} subscribed to market ${marketId}`);
      });

      socket.on('unsubscribe_market', (marketId: string) => {
        socket.leave(`market:${marketId}`);
        console.log(`Client ${socket.id} unsubscribed from market ${marketId}`);
      });
    });
  }

  broadcastPriceUpdate(event: PolymarketPriceEvent): void {
    const update = {
      marketId: event.market,
      outcomeId: event.outcome,
      bidPrice: event.price.bid,
      askPrice: event.price.ask,
      midPrice: (event.price.bid + event.price.ask) / 2,
      impliedProbability: ((event.price.bid + event.price.ask) / 2) * 100,
      timestamp: new Date().toISOString(),
    };

    // Broadcast to all clients subscribed to this market
    this.io.to(`market:${event.market}`).emit('price_update', update);
  }

  getIO(): SocketIOServer {
    return this.io;
  }
}

