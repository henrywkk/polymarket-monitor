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

export const useRealtimePrice = (marketId?: string) => {
  const [priceUpdate, setPriceUpdate] = useState<PriceUpdate | null>(null);

  useEffect(() => {
    if (!marketId) return;

    wsService.connect();

    // Subscribe to market updates
    wsService.emit('subscribe_market', marketId);

    const handlePriceUpdate = (data: unknown) => {
      const update = data as PriceUpdate;
      if (update.marketId === marketId) {
        setPriceUpdate(update);
      }
    };

    wsService.on('price_update', handlePriceUpdate);

    return () => {
      wsService.off('price_update', handlePriceUpdate);
      wsService.emit('unsubscribe_market', marketId);
    };
  }, [marketId]);

  return priceUpdate;
};

