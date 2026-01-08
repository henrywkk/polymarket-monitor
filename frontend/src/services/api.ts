import axios from 'axios';

// Ensure API URL has protocol, default to https for production
const getApiUrl = () => {
  const envUrl = import.meta.env.VITE_API_URL;
  if (!envUrl) {
    return 'http://localhost:3000';
  }
  // If URL doesn't start with http:// or https://, add https://
  if (!envUrl.startsWith('http://') && !envUrl.startsWith('https://')) {
    return `https://${envUrl}`;
  }
  return envUrl;
};

const API_URL = getApiUrl();

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
  (response) => {
    // Log successful responses in development
    if (import.meta.env.DEV) {
      console.log('API Response:', response.status, response.config.url, response.data);
    }
    return response;
  },
  (error) => {
    console.error('API Response Error:', {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      message: error.message,
      url: error.config?.url,
    });
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
  currentPrice?: {
    bid_price: number;
    ask_price: number;
    mid_price: number;
    implied_probability: number;
  };
  probabilityDisplay?: {
    type: 'expectedValue' | 'highestProbability';
    value: number;
    outcome?: string;
  };
  liquidityScore?: number;
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
    try {
      console.log('Fetching markets with params:', params);
      const response = await apiClient.get<MarketsResponse>('/markets', { params });
      console.log('Markets API response:', response);
      console.log('Response status:', response.status);
      console.log('Response data:', response.data);
      
      if (!response.data) {
        console.error('No data in response');
        throw new Error('No data received from API');
      }
      
      if (!response.data.data) {
        console.error('No data.data in response:', response.data);
        throw new Error('Invalid response format: missing data field');
      }
      
      return response.data;
    } catch (error: any) {
      console.error('getMarkets error:', error);
      console.error('Error details:', {
        message: error.message,
        response: error.response,
        status: error.response?.status,
        data: error.response?.data,
      });
      throw error;
    }
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

