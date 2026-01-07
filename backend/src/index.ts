import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { pool } from './config/database';
import { logger } from './middleware/logger';
import healthRoutes, { setWebSocketClient } from './routes/health';
import marketsRoutes from './routes/markets';
import syncRoutes, { setSyncService } from './routes/sync';
import { PolymarketWebSocketClient } from './services/polymarket-client';
import { MarketIngestionService } from './services/market-ingestion';
import { WebSocketServer } from './services/websocket-server';
import { initializeDatabase } from './db/init-db';
import { PolymarketRestClient } from './services/polymarket-rest';
import { MarketSyncService } from './services/market-sync';
import { PeriodicSyncService } from './services/periodic-sync';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const wsServer = new WebSocketServer(httpServer);
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());
app.use(logger);

// Routes
app.use('/api/health', healthRoutes);
app.use('/api/markets', marketsRoutes);
app.use('/api/sync', syncRoutes);

// Error handling middleware
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// Initialize Polymarket WebSocket client
// Use the correct CLOB WebSocket URL: wss://ws-subscriptions-clob.polymarket.com/ws/
const wsClient = new PolymarketWebSocketClient(
  process.env.POLYMARKET_WS_URL || 'wss://ws-subscriptions-clob.polymarket.com/ws/'
);
const marketIngestion = new MarketIngestionService(wsClient, wsServer);

// Initialize Polymarket REST client and sync service
const restClient = new PolymarketRestClient();
const marketSync = new MarketSyncService(restClient, marketIngestion);

// Initialize periodic sync service
// Default to 5 minutes, configurable via SYNC_INTERVAL_MINUTES env var
const syncIntervalMinutes = parseInt(process.env.SYNC_INTERVAL_MINUTES || '5', 10);
const periodicSync = new PeriodicSyncService(marketSync, syncIntervalMinutes);

// Set WebSocket client reference for health check
setWebSocketClient(wsClient);

// Set sync service reference for sync endpoint
setSyncService(marketSync);

// Start server
const startServer = async () => {
  try {
    // Test database connection
    await pool.query('SELECT NOW()');
    console.log('Database connected successfully');
    
    // Initialize database tables
    await initializeDatabase();

    // Sync markets from Polymarket API (non-blocking)
    // Fetch more markets to ensure we get diverse categories including crypto
    marketSync.syncMarkets(500).catch((error: unknown) => {
      console.error('Error during initial market sync:', error);
    });

    // Start periodic automatic sync (runs in background)
    periodicSync.start();
    console.log(`Periodic sync started (interval: ${syncIntervalMinutes} minutes)`);

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

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  periodicSync.stop();
  wsClient.disconnect();
  pool.end();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  periodicSync.stop();
  wsClient.disconnect();
  pool.end();
  process.exit(0);
});

startServer();

// Export for testing
export { wsClient, marketIngestion };

export default app;

