import { useEffect, useState } from 'react';
import { wsService } from '../services/websocket';
import { Trade } from '../services/api';

export interface TradeUpdate {
  marketId: string;
  outcomeId: string;
  tokenId: string;
  price: number;
  size: number;
  timestamp: number;
  side?: 'buy' | 'sell';
}

/**
 * Hook to receive real-time trade updates for a market
 * Each outcome in a market has its own trades (identified by tokenId/assetId)
 * 
 * @param marketId - The market ID to subscribe to
 * @param outcomeId - Optional: Filter to specific outcome (for bucket markets)
 * @returns Array of recent trades (last 50)
 */
export const useRealtimeTrades = (marketId?: string, outcomeId?: string) => {
  const [trades, setTrades] = useState<TradeUpdate[]>([]);
  
  useEffect(() => {
    if (!marketId) return;
    
    wsService.connect();
    
    // Wait for connection before subscribing
    const checkConnection = () => {
      if (wsService.isConnected()) {
        wsService.emit('subscribe_market', marketId);
      } else {
        setTimeout(checkConnection, 100);
      }
    };
    
    if (wsService.isConnected()) {
      wsService.emit('subscribe_market', marketId);
    } else {
      checkConnection();
    }
    
    const handleTradeUpdate = (data: unknown) => {
      const trade = data as TradeUpdate;
      // Only process trades for the current market
      if (trade.marketId === marketId) {
        // Filter by outcome if specified
        if (outcomeId && trade.outcomeId !== outcomeId) {
          return;
        }
        // Add new trade to the beginning, keep last 50
        setTrades(prev => [trade, ...prev].slice(0, 50));
      }
    };
    
    wsService.on('trade_update', handleTradeUpdate);
    
    return () => {
      wsService.off('trade_update', handleTradeUpdate);
      if (wsService.isConnected()) {
        wsService.emit('unsubscribe_market', marketId);
      }
    };
  }, [marketId, outcomeId]);
  
  return trades;
};
