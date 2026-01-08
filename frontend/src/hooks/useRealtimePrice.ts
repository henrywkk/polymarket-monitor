import { useEffect, useState } from 'react';
import { wsService } from '../services/websocket';

export interface PriceUpdate {
  marketId: string;
  outcomeId: string;
  bidPrice: number;
  askPrice: number;
  midPrice: number;
  impliedProbability: number;
}

export const useRealtimePrice = (marketId?: string, primaryOutcomeId?: string) => {
  const [priceUpdate, setPriceUpdate] = useState<PriceUpdate | null>(null);

  useEffect(() => {
    if (!marketId) return;

    console.log('Setting up real-time price for market:', marketId, 'primary outcome:', primaryOutcomeId);
    wsService.connect();

    // Wait for connection before subscribing
    const checkConnection = () => {
      if (wsService.isConnected()) {
        console.log('WebSocket connected, subscribing to market:', marketId);
        wsService.emit('subscribe_market', marketId);
      } else {
        console.log('WebSocket not connected yet, retrying...');
        setTimeout(checkConnection, 100);
      }
    };

    // Try to subscribe immediately, or wait for connection
    if (wsService.isConnected()) {
      wsService.emit('subscribe_market', marketId);
    } else {
      checkConnection();
    }

    const handlePriceUpdate = (data: unknown) => {
      const update = data as PriceUpdate;
      // Only process updates for the current market and its primary outcome
      if (update.marketId === marketId) {
        if (primaryOutcomeId && update.outcomeId !== primaryOutcomeId) {
          // Filter to only primary outcome if specified
          return;
        }
        console.log('Received price update for primary outcome:', update);
        setPriceUpdate(update);
      }
      // Silently ignore updates for other markets (no need to log)
    };

    wsService.on('price_update', handlePriceUpdate);

    return () => {
      console.log('Cleaning up real-time price for market:', marketId);
      wsService.off('price_update', handlePriceUpdate);
      if (wsService.isConnected()) {
        wsService.emit('unsubscribe_market', marketId);
      }
    };
  }, [marketId, primaryOutcomeId]);

  return priceUpdate;
};

