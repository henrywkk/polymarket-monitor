import { Router, Request, Response } from 'express';
import { getHealthStatus } from '../monitoring/health-check';

const router = Router();

// Store wsClient reference (set from index.ts)
let wsClientRef: { isConnectionActive: () => boolean } | undefined;

export const setWebSocketClient = (client: { isConnectionActive: () => boolean }) => {
  wsClientRef = client;
};

router.get('/', async (_req: Request, res: Response) => {
  try {
    const healthStatus = await getHealthStatus(wsClientRef);
    const statusCode = healthStatus.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(healthStatus);
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;

