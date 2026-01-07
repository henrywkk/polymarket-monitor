import axios from 'axios';

// Polymarket API endpoints
const POLYMARKET_API_BASE = 'https://clob.polymarket.com';
const POLYMARKET_API_V2 = 'https://api.polymarket.com';
const POLYMARKET_GAMMA_API = 'https://gamma-api.polymarket.com';

// Known tag IDs for categories (can be fetched from /tags endpoint)
export const TAG_IDS = {
  CRYPTO: '100181', // User provided, verify with /tags endpoint
  POLITICS: '21', // Example, verify with /tags endpoint
  SPORTS: '22', // Example, verify with /tags endpoint
} as const;

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
  events?: PolymarketMarketRaw[];
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
   * Fetch tags from Polymarket Gamma API
   */
  async fetchTags(): Promise<Array<{ id: string; label: string; slug: string }>> {
    try {
      const response = await axios.get(`${POLYMARKET_GAMMA_API}/tags`, {
        params: { limit: 100 },
        timeout: 10000,
      });
      return response.data?.data || response.data || [];
    } catch (error) {
      console.error('Error fetching tags:', error);
      return [];
    }
  }

  /**
   * Fetch markets from Polymarket Gamma API using tag_id
   */
  async fetchMarkets(params?: {
    limit?: number;
    offset?: number;
    tagId?: string;
    active?: boolean;
    closed?: boolean;
  }): Promise<PolymarketMarket[]> {
    try {
      // Try Gamma API /events first (supports tag_id), then fallback to other endpoints
      // Note: Gamma API /events returns array directly, not wrapped in an object
      const endpoints = [
        { 
          base: POLYMARKET_GAMMA_API, 
          path: '/events',
          supportsTagId: true,
          isGammaEvents: true // Gamma /events returns array directly: [{...}, {...}]
        },
        { 
          base: POLYMARKET_API_V2, 
          path: '/v2/markets',
          supportsTagId: false 
        },
        { 
          base: POLYMARKET_API_V2, 
          path: '/markets',
          supportsTagId: false 
        },
      ];

      for (const { base, path, supportsTagId, isGammaEvents } of endpoints) {
        const requestParams: Record<string, unknown> = {
          limit: params?.limit || 100,
          offset: params?.offset || 0,
        };

        // Only add tag_id if endpoint supports it
        // Convert to number if it's a string (Gamma API expects number)
        if (supportsTagId && params?.tagId) {
          requestParams.tag_id = typeof params.tagId === 'string' ? parseInt(params.tagId, 10) : params.tagId;
        }
        
        // Add active/closed filters for Gamma API
        if (supportsTagId) {
          if (params?.active !== undefined) {
            requestParams.active = params.active;
          } else {
            requestParams.active = true; // Default to active markets
          }
          if (params?.closed !== undefined) {
            requestParams.closed = params.closed;
          } else {
            requestParams.closed = false; // Default to non-closed markets
          }
        }

        try {
          const fullUrl = `${base}${path}`;
          console.log(`Attempting to fetch from ${fullUrl} with params:`, JSON.stringify(requestParams));
          
          const response = await axios.get<PolymarketMarketsResponse | PolymarketMarketRaw[]>(
            fullUrl,
            {
              params: requestParams,
              timeout: 10000,
            }
          );

          // Handle different response formats
          // Gamma API /events returns array directly, not wrapped in an object
          let rawMarkets: PolymarketMarketRaw[] = [];
          
          if (isGammaEvents) {
            // Gamma /events endpoint returns array directly: [market1, market2, ...]
            if (Array.isArray(response.data)) {
              rawMarkets = response.data;
            } else {
              // Fallback: try wrapped format (shouldn't happen but just in case)
              rawMarkets = (response.data as any)?.data || (response.data as any)?.events || [];
            }
          } else if (Array.isArray(response.data)) {
            // Some other endpoints return array directly
            rawMarkets = response.data;
          } else {
            // Wrapped responses: { data: [...] } or { markets: [...] }
            const wrapped = response.data as PolymarketMarketsResponse;
            rawMarkets = wrapped?.data || wrapped?.markets || wrapped?.events || [];
          }

          if (rawMarkets.length > 0) {
            const tagInfo = params?.tagId ? ` with tag_id=${params.tagId}` : '';
            console.log(`Successfully fetched ${rawMarkets.length} markets from ${base}${path}${tagInfo}`);
            // Normalize snake_case to camelCase
            const normalizedMarkets = rawMarkets.map(normalizeMarket);
            return normalizedMarkets;
          } else {
            if (base === POLYMARKET_GAMMA_API) {
              console.log(`Gamma API returned empty result from ${fullUrl}. Response type: ${Array.isArray(response.data) ? 'array' : typeof response.data}, length: ${Array.isArray(response.data) ? response.data.length : 'N/A'}`);
            }
            console.log(`No markets found in response from ${fullUrl} (trying next endpoint...)`);
          }
        } catch (error) {
          // Log all errors for debugging
          if (axios.isAxiosError(error)) {
            const status = error.response?.status;
            const statusText = error.response?.statusText;
            const url = `${base}${path}`;
            if (status === 404) {
              // Silently skip 404s
              continue;
            } else {
              const requestParamsStr = JSON.stringify(requestParams).substring(0, 200);
              console.warn(`Failed to fetch from ${url}: ${status} ${statusText || ''}`, {
                params: requestParamsStr,
                responseData: error.response?.data ? JSON.stringify(error.response.data).substring(0, 200) : undefined,
              });
            }
          } else {
            console.warn(`Failed to fetch from ${base}${path}:`, error instanceof Error ? error.message : String(error));
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

