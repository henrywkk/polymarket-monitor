import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { pool } from './config/database';
import { logger } from './middleware/logger';
import healthRoutes, { setWebSocketClient } from './routes/health';
import marketsRoutes from './routes/markets';
import categoriesRoutes from './routes/categories';
import statsRoutes from './routes/stats';
import syncRoutes, { setSyncService, setRestClient } from './routes/sync';
import tradesRoutes from './routes/trades';
import alertsRoutes from './routes/alerts';
import { PolymarketWebSocketClient } from './services/polymarket-client';
import { MarketIngestionService } from './services/market-ingestion';
import { WebSocketServer } from './services/websocket-server';
import { initializeDatabase } from './db/init-db';
import { PolymarketRestClient } from './services/polymarket-rest';
import { MarketSyncService } from './services/market-sync';
import { PeriodicSyncService } from './services/periodic-sync';
import { HighVolumeDiscoveryService } from './services/high-volume-discovery';
import { AlertDispatcher } from './services/alert-dispatcher';
import { WebhookChannel, WebSocketChannel, EmailChannel } from './services/notification-channels';
import { AlertThrottle } from './services/alert-throttle';
import { NewMarketDetector } from './services/new-market-detector';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const wsServer = new WebSocketServer(httpServer);
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
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
  credentials: true,
}));
app.use(express.json());
app.use(logger);

// Routes
app.use('/api/health', healthRoutes);
app.use('/api/markets', marketsRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/trades', tradesRoutes);
app.use('/api/alerts', alertsRoutes);

// Error handling middleware
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

    // Initialize Polymarket WebSocket client
    // Use the official CLOB WebSocket URL: wss://ws-subscriptions-clob.polymarket.com/ws/
    // Reference: https://docs.polymarket.com/developers/CLOB/websocket/market-channel
    // Initialize Polymarket REST client first (needed by both ingestion and sync services)
    const restClient = new PolymarketRestClient();
    
    // Initialize Polymarket WebSocket client
    // Use the official CLOB WebSocket URL: wss://ws-subscriptions-clob.polymarket.com/ws/
    // Reference: https://docs.polymarket.com/developers/CLOB/websocket/market-channel
    const wsUrl = process.env.POLYMARKET_WS_URL;
    const wsClient = new PolymarketWebSocketClient(wsUrl); // Defaults to official URL if not provided
    const marketIngestion = new MarketIngestionService(wsClient, restClient, wsServer);

// Initialize new market detector (will be passed to sync service)
const newMarketDetector = new NewMarketDetector();

// Initialize sync service
const marketSync = new MarketSyncService(restClient, marketIngestion, newMarketDetector);

// Enable auto-sync for unsynced markets
marketIngestion.setMarketSyncService(marketSync);

// Initialize periodic sync service
// Default to 5 minutes, configurable via SYNC_INTERVAL_MINUTES env var
const syncIntervalMinutes = parseInt(process.env.SYNC_INTERVAL_MINUTES || '5', 10);
const periodicSync = new PeriodicSyncService(marketSync, syncIntervalMinutes);

// Initialize high-volume discovery service
// Default to 30 minutes, configurable via HIGH_VOLUME_DISCOVERY_INTERVAL_MINUTES env var
const discoveryIntervalMinutes = parseInt(process.env.HIGH_VOLUME_DISCOVERY_INTERVAL_MINUTES || '30', 10);
const highVolumeDiscovery = new HighVolumeDiscoveryService(restClient, marketSync);

// Set WebSocket client reference for health check
setWebSocketClient(wsClient);

// Set sync service reference for sync endpoint
setSyncService(marketSync);
setRestClient(restClient);

// Start server
const startServer = async () => {
  try {
    // Test database connection with retry logic
    let dbConnected = false;
    const maxRetries = 5;
    const retryDelay = 3000; // 3 seconds
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await pool.query('SELECT NOW()');
        console.log('Database connected successfully');
        dbConnected = true;
        break;
      } catch (error) {
        if (attempt < maxRetries) {
          console.log(`Database connection attempt ${attempt}/${maxRetries} failed, retrying in ${retryDelay}ms...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        } else {
          console.error(`Database connection failed after ${maxRetries} attempts:`, error);
          // In production, we might want to continue without DB for health checks
          // But for now, database is required
          throw error;
        }
      }
    }
    
    if (!dbConnected) {
      throw new Error('Failed to connect to database after retries');
    }
    
    // Initialize database tables
    await initializeDatabase();
    
    // Initialize new market detector with known markets from database
    await newMarketDetector.initializeKnownMarkets().catch((error: unknown) => {
      console.error('Error initializing known markets:', error);
    });
    await newMarketDetector.initializeKnownOutcomes().catch((error: unknown) => {
      console.error('Error initializing known outcomes:', error);
    });
    console.log('[New Market Detector] Initialized known markets and outcomes');
    
    // Note: Redis connection is non-blocking and happens in background
    // Server will start even if Redis is unavailable (with degraded functionality)

        // Run initial data maintenance (prune old history)
        marketIngestion.pruneOldHistory(1).catch(err => {
          console.error('Error during initial pruning:', err);
        });

        // Sync markets from Polymarket API (non-blocking)
    // Fetch up to 2000 markets with pagination (no tag filtering - discovers all active markets)
    marketSync.syncMarkets(2000).catch((error: unknown) => {
      console.error('Error during initial market sync:', error);
    });

    // Start periodic automatic sync (runs in background)
    periodicSync.start();
    console.log(`Periodic sync started (interval: ${syncIntervalMinutes} minutes)`);

    // Start high-volume market discovery (runs in background)
    highVolumeDiscovery.start(discoveryIntervalMinutes);
    console.log(`High-volume discovery started (interval: ${discoveryIntervalMinutes} minutes)`);

    // Initialize alert system
    const alertThrottle = new AlertThrottle();
    const webhookChannel = new WebhookChannel();
    const websocketChannel = new WebSocketChannel(wsServer);
    const emailChannel = new EmailChannel();
    
    const alertDispatcher = new AlertDispatcher(
      alertThrottle,
      [webhookChannel, websocketChannel, emailChannel]
    );
    
    // Store reference for graceful shutdown
    alertDispatcherRef = alertDispatcher;
    
    // Start alert dispatcher
    alertDispatcher.start().catch(err => {
      console.error('[Alert System] Error starting alert dispatcher:', err);
    });
    console.log('[Alert System] Alert dispatcher started');

    // Connect to Polymarket WebSocket (non-blocking, graceful failure)
    wsClient.connect().then(() => {
      console.log('Polymarket WebSocket client connected');
    }).catch(() => {
      // WebSocket connection is optional - server continues without it
      console.log('WebSocket connection unavailable, continuing without real-time updates');
    });

    httpServer.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Store alert dispatcher reference for graceful shutdown
let alertDispatcherRef: AlertDispatcher | undefined;

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  periodicSync.stop();
  highVolumeDiscovery.stop();
  if (alertDispatcherRef) {
    alertDispatcherRef.stop();
  }
  wsClient.disconnect();
  pool.end();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  periodicSync.stop();
  highVolumeDiscovery.stop();
  if (alertDispatcherRef) {
    alertDispatcherRef.stop();
  }
  wsClient.disconnect();
  pool.end();
  process.exit(0);
});

startServer();

// Export for testing
export { wsClient, marketIngestion };

export default app;

