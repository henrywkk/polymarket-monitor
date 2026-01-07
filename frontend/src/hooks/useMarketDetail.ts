import { useQuery } from '@tanstack/react-query';
import { marketsApi, MarketWithOutcomes } from '../services/api';

export const useMarketDetail = (id: string) => {
  return useQuery<MarketWithOutcomes>({
    queryKey: ['market', id],
    queryFn: () => marketsApi.getMarket(id),
    enabled: !!id,
    staleTime: 30000,
  });
};

