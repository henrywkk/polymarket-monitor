import { pool } from '../config/database';
import redis from '../config/redis';

export interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  services: {
    database: 'healthy' | 'unhealthy';
    redis: 'healthy' | 'unhealthy';
    websocket: 'healthy' | 'unhealthy';
  };
  metrics?: {
    lastPriceUpdate?: string;
    activeConnections?: number;
  };
}

export const getHealthStatus = async (
  wsClient?: { isConnectionActive: () => boolean }
): Promise<HealthStatus> => {
  const status: HealthStatus = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      database: 'unhealthy',
      redis: 'unhealthy',
      websocket: 'unhealthy',
    },
  };

  // Check database
  try {
    await pool.query('SELECT NOW()');
    status.services.database = 'healthy';
  } catch (error) {
    console.error('Database health check failed:', error);
    status.status = 'unhealthy';
  }

  // Check Redis
  try {
    await redis.ping();
    status.services.redis = 'healthy';
  } catch (error) {
    console.error('Redis health check failed:', error);
    status.status = 'unhealthy';
  }

  // Check WebSocket
  try {
    if (wsClient?.isConnectionActive()) {
      status.services.websocket = 'healthy';
    } else {
      status.services.websocket = 'unhealthy';
      // Don't mark overall as unhealthy if WebSocket is down (it's not critical)
    }
  } catch (error) {
    console.error('WebSocket health check failed:', error);
    status.services.websocket = 'unhealthy';
  }

  return status;
};

