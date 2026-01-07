import axios from 'axios';

// Try Polymarket's actual API endpoints
const POLYMARKET_API_BASE = 'https://clob.polymarket.com';
const POLYMARKET_API_V2 = 'https://api.polymarket.com';

// Raw API response (snake_case)
export interface PolymarketMarketRaw {
  id?: string;
  question_id?: string;
  condition_id?: string;
  question?: string;
  market_slug?: string;
  slug?: string;
  description?: string;
  image?: string;
  icon?: string;
  end_date?: string;
  end_date_iso?: string;
  endDate?: string;
  endDateISO?: string;
  tokens?: Array<{
    token_id?: string;
    outcome?: string;
    price?: string;
    winner?: boolean;
  }>;
  outcomes?: Array<{
    id?: string;
    outcome: string;
    price?: string;
  }>;
  tokenId?: string;
  category?: string;
  tags?: string[];
  liquidity?: string;
  volume?: string;
  // Additional fields
  [key: string]: any;
}

// Normalized interface (camelCase)
export interface PolymarketMarket {
  id?: string;
  questionId?: string;
  conditionId?: string;
  question?: string;
  slug?: string;
  description?: string;
  image?: string;
  endDate?: string;
  endDateISO?: string;
  outcomes?: Array<{
    id?: string;
    tokenId?: string;
    outcome: string;
    price?: string;
  }>;
  tokenId?: string;
  category?: string;
  tags?: string[];
  liquidity?: string;
  volume?: string;
  [key: string]: any;
}

export interface PolymarketMarketsResponse {
  data?: PolymarketMarketRaw[];
  markets?: PolymarketMarketRaw[];
}

/**
 * Normalize snake_case API response to camelCase
 */
function normalizeMarket(raw: PolymarketMarketRaw): PolymarketMarket {
  // Map outcomes from tokens array if available
  const outcomes = raw.tokens
    ? raw.tokens.map((token) => ({
        id: token.token_id,
        tokenId: token.token_id,
        outcome: token.outcome || '',
        price: token.price,
      }))
    : raw.outcomes || [];

  return {
    id: raw.id || raw.question_id,
    questionId: raw.question_id,
    conditionId: raw.condition_id,
    question: raw.question,
    slug: raw.market_slug || raw.slug,
    description: raw.description,
    image: raw.image || raw.icon,
    endDate: raw.end_date_iso || raw.end_date || raw.endDate,
    endDateISO: raw.end_date_iso || raw.endDateISO,
    outcomes,
    tokenId: raw.tokenId,
    category: raw.category || (raw.tags && raw.tags[0]) || undefined,
    tags: raw.tags,
    liquidity: raw.liquidity,
    volume: raw.volume,
  };
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
      // Try Polymarket API endpoints (try v2 API first, then CLOB API)
      const endpoints = [
        { base: POLYMARKET_API_V2, path: '/v2/markets' },
        { base: POLYMARKET_API_V2, path: '/markets' },
        { base: this.baseURL, path: '/markets' },
        { base: this.baseURL, path: '/v2/markets' },
      ];

      for (const { base, path } of endpoints) {
        try {
          const response = await axios.get<PolymarketMarketsResponse>(
            `${base}${path}`,
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
          const rawMarkets = response.data?.data || response.data?.markets || [];
          if (rawMarkets.length > 0) {
            console.log(`Successfully fetched ${rawMarkets.length} markets from ${base}${path}`);
            // Normalize snake_case to camelCase
            const normalizedMarkets = rawMarkets.map(normalizeMarket);
            return normalizedMarkets;
          }
        } catch (error) {
          // Try next endpoint
          if (axios.isAxiosError(error) && error.response?.status !== 404) {
            console.warn(`Failed to fetch from ${base}${path}:`, error.response?.status || error.message);
          }
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
          const response = await axios.get<PolymarketMarketRaw>(
            `${this.baseURL}${endpoint}`,
            { timeout: 10000 }
          );
          return normalizeMarket(response.data);
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

