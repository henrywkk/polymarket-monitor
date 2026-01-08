import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../services/api';

export interface GlobalStats {
  markets: {
    total: number;
    active: number;
    closed: number;
    categories: number;
    recentlyUpdated: number;
  };
  outcomes: {
    total: number;
  };
  priceHistory: {
    totalRecords: number;
    marketsWithHistory: number;
    earliestRecord: string;
    latestRecord: string;
  };
  realTime: {
    activePriceCaches: number;
  };
  timestamp: string;
}

export const useGlobalStats = () => {
  return useQuery<GlobalStats>({
    queryKey: ['globalStats'],
    queryFn: async () => {
      const response = await apiClient.get<GlobalStats>('/stats');
      return response.data;
    },
    refetchInterval: 30000, // Refetch every 30 seconds
  });
};
