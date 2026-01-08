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
    queryFn: async () => {
      try {
        const response = await marketsApi.getMarkets(params);
        console.log('Markets response:', response);
        return response;
      } catch (error) {
        console.error('Error fetching markets:', error);
        throw error;
      }
    },
    staleTime: 30000, // 30 seconds
    retry: 2,
  });
};

