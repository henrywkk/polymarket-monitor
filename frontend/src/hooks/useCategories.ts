import { useQuery } from '@tanstack/react-query';
import { categoriesApi, CategoriesResponse } from '../services/api';

export const useCategories = () => {
  return useQuery<CategoriesResponse>({
    queryKey: ['categories'],
    queryFn: async () => {
      return await categoriesApi.getCategories();
    },
    staleTime: 60000, // 1 minute
    retry: 2,
  });
};
