import { useQuery } from '@tanstack/react-query';
import { marketsApi, MarketsResponse } from '../services/api';

export const useMarkets = (params?: {
  page?: number;
  limit?: number;
  search?: string;
  category?: string;
  sortBy?: string;
}) => {
  return useQuery<MarketsResponse>({
    queryKey: ['markets', params],
    queryFn: () => marketsApi.getMarkets(params),
    staleTime: 30000, // 30 seconds
  });
};

