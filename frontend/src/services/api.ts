import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// Log API URL in development
if (import.meta.env.DEV) {
  console.log('API Client initialized with URL:', API_URL);
}

export const apiClient = axios.create({
  baseURL: `${API_URL}/api`,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add request interceptor for debugging
apiClient.interceptors.request.use(
  (config) => {
    if (import.meta.env.DEV) {
      console.log('API Request:', config.method?.toUpperCase(), config.url);
    }
    return config;
  },
  (error) => {
    console.error('API Request Error:', error);
    return Promise.reject(error);
  }
);

// Add response interceptor for error handling
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('API Response Error:', error.response?.status, error.response?.data || error.message);
    return Promise.reject(error);
  }
);

export interface Market {
  id: string;
  question: string;
  slug: string;
  category: string;
  end_date: string | null;
  image_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Outcome {
  id: string;
  market_id: string;
  outcome: string;
  token_id: string;
  created_at: string;
  currentPrice?: {
    bid_price: number;
    ask_price: number;
    mid_price: number;
    implied_probability: number;
  };
}

export interface MarketWithOutcomes extends Market {
  outcomes?: Outcome[];
}

export interface PriceHistory {
  id: number;
  market_id: string;
  outcome_id: string;
  timestamp: string;
  bid_price: number;
  ask_price: number;
  mid_price: number;
  implied_probability: number;
  created_at: string;
  outcome?: string;
}

export interface MarketsResponse {
  data: Market[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface MarketHistoryResponse {
  data: PriceHistory[];
  timeframe: string;
}

export const marketsApi = {
  getMarkets: async (params?: {
    page?: number;
    limit?: number;
    search?: string;
    category?: string;
    sortBy?: string;
  }): Promise<MarketsResponse> => {
    const response = await apiClient.get<MarketsResponse>('/markets', { params });
    return response.data;
  },

  getMarket: async (id: string): Promise<MarketWithOutcomes> => {
    const response = await apiClient.get<MarketWithOutcomes>(`/markets/${id}`);
    return response.data;
  },

  getMarketHistory: async (
    id: string,
    timeframe: '24h' | '7d' | '30d' = '24h'
  ): Promise<MarketHistoryResponse> => {
    const response = await apiClient.get<MarketHistoryResponse>(
      `/markets/${id}/history`,
      { params: { timeframe } }
    );
    return response.data;
  },
};

