import { useQuery } from '@tanstack/react-query';
import { marketsApi, MarketHistoryResponse } from '../services/api';

export const useMarketHistory = (
  id: string,
  timeframe: '24h' | '7d' | '30d' = '24h'
) => {
  return useQuery<MarketHistoryResponse>({
    queryKey: ['market-history', id, timeframe],
    queryFn: () => marketsApi.getMarketHistory(id, timeframe),
    enabled: !!id,
    staleTime: 60000, // 1 minute
  });
};

