import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { pool } from './config/database';
import { logger } from './middleware/logger';
import healthRoutes, { setWebSocketClient } from './routes/health';
import marketsRoutes from './routes/markets';
import { PolymarketWebSocketClient } from './services/polymarket-client';
import { MarketIngestionService } from './services/market-ingestion';
import { WebSocketServer } from './services/websocket-server';

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

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// Initialize Polymarket WebSocket client
const wsClient = new PolymarketWebSocketClient(
  process.env.POLYMARKET_WS_URL || 'wss://clob.polymarket.com'
);
const marketIngestion = new MarketIngestionService(wsClient, wsServer);

// Set WebSocket client reference for health check
setWebSocketClient(wsClient);

// Start server
const startServer = async () => {
  try {
    // Test database connection
    await pool.query('SELECT NOW()');
    console.log('Database connected successfully');

    // Connect to Polymarket WebSocket
    try {
      await wsClient.connect();
      console.log('Polymarket WebSocket client connected');
    } catch (error) {
      console.error('Failed to connect to Polymarket WebSocket:', error);
      console.log('Server will continue without WebSocket connection');
    }

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
  wsClient.disconnect();
  pool.end();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  wsClient.disconnect();
  pool.end();
  process.exit(0);
});

startServer();

// Export for testing
export { wsClient, marketIngestion };

export default app;

