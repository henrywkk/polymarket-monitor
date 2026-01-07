import axios from 'axios';

const POLYMARKET_API_BASE = 'https://clob.polymarket.com';

export interface PolymarketMarket {
  id: string;
  question: string;
  slug: string;
  description?: string;
  image?: string;
  endDate?: string;
  endDateISO?: string;
  outcomes?: Array<{
    id: string;
    outcome: string;
    price?: string;
  }>;
  conditionId?: string;
  tokenId?: string;
  category?: string;
  liquidity?: string;
  volume?: string;
}

export interface PolymarketMarketsResponse {
  data?: PolymarketMarket[];
  markets?: PolymarketMarket[];
}

export class PolymarketRestClient {
  private baseURL: string;

  constructor(baseURL: string = POLYMARKET_API_BASE) {
    this.baseURL = baseURL;
  }

  /**
   * Fetch markets from Polymarket API
   * Note: This uses a generic endpoint - adjust based on actual Polymarket API
   */
  async fetchMarkets(params?: {
    limit?: number;
    offset?: number;
    category?: string;
    active?: boolean;
  }): Promise<PolymarketMarket[]> {
    try {
      // Try common Polymarket API endpoints
      const endpoints = [
        '/markets',
        '/v2/markets',
        '/api/v2/markets',
        '/markets/active',
      ];

      for (const endpoint of endpoints) {
        try {
          const response = await axios.get<PolymarketMarketsResponse>(
            `${this.baseURL}${endpoint}`,
            {
              params: {
                limit: params?.limit || 100,
                offset: params?.offset || 0,
                ...params,
              },
              timeout: 10000,
            }
          );

          // Handle different response formats
          const markets = response.data?.data || response.data?.markets || [];
          if (markets.length > 0) {
            console.log(`Successfully fetched ${markets.length} markets from ${endpoint}`);
            return markets;
          }
        } catch (error) {
          // Try next endpoint
          continue;
        }
      }

      console.warn('Could not fetch markets from any known endpoint');
      return [];
    } catch (error) {
      console.error('Error fetching markets from Polymarket API:', error);
      if (axios.isAxiosError(error)) {
        console.error('Response status:', error.response?.status);
        console.error('Response data:', error.response?.data);
      }
      return [];
    }
  }

  /**
   * Fetch a single market by ID
   */
  async fetchMarket(marketId: string): Promise<PolymarketMarket | null> {
    try {
      const endpoints = [
        `/markets/${marketId}`,
        `/v2/markets/${marketId}`,
        `/api/v2/markets/${marketId}`,
      ];

      for (const endpoint of endpoints) {
        try {
          const response = await axios.get<PolymarketMarket>(
            `${this.baseURL}${endpoint}`,
            { timeout: 10000 }
          );
          return response.data;
        } catch (error) {
          continue;
        }
      }

      return null;
    } catch (error) {
      console.error(`Error fetching market ${marketId}:`, error);
      return null;
    }
  }
}

export const polymarketRest = new PolymarketRestClient();

