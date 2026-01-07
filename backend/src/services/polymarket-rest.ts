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

  // Gamma API may use different field names - check multiple possibilities
  const question = raw.question || raw.title || raw.name || raw.eventTitle || 
                   (raw as any).event?.title || (raw as any).event?.question || 
                   (raw as any).event?.name || undefined;

  return {
    id: raw.id || raw.question_id,
    questionId: raw.question_id,
    conditionId: raw.condition_id,
    question: question,
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
   * Fetch markets from Polymarket Gamma API using tag_id or tag_slug
   */
  async fetchMarkets(params?: {
    limit?: number;
    offset?: number;
    tagId?: string;
    tagSlug?: string;
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

        // Only add tag_id or tag_slug if endpoint supports it
        // Gamma API supports both tag_id (number) and tag_slug (string)
        if (supportsTagId) {
          if (params?.tagSlug) {
            // Prefer tag_slug over tag_id (more reliable)
            requestParams.tag_slug = params.tagSlug;
          } else if (params?.tagId) {
            // Fallback to tag_id (convert to number if string)
            requestParams.tag_id = typeof params.tagId === 'string' ? parseInt(params.tagId, 10) : params.tagId;
          }
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
          const response = await axios.get<PolymarketMarketsResponse | PolymarketMarketRaw[]>(
            `${base}${path}`,
            {
              params: requestParams,
              timeout: 10000,
            }
          );

          // Handle different response formats
          let rawMarkets: PolymarketMarketRaw[] = [];
          
          if (isGammaEvents) {
            if (Array.isArray(response.data)) {
              rawMarkets = response.data;
            } else {
              rawMarkets = (response.data as any)?.data || (response.data as any)?.events || [];
            }
          } else if (Array.isArray(response.data)) {
            rawMarkets = response.data;
          } else {
            const wrapped = response.data as PolymarketMarketsResponse;
            rawMarkets = wrapped?.data || wrapped?.markets || wrapped?.events || [];
          }

          if (rawMarkets.length > 0) {
            // Normalize snake_case to camelCase
            const normalizedMarkets = rawMarkets.map(normalizeMarket);
            return normalizedMarkets;
          }
            } catch (error) {
              // Only log non-404 errors
              if (axios.isAxiosError(error) && error.response?.status !== 404) {
                // Silently skip 404s and other common errors
                continue;
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

  /**
   * Fetch market order book from CLOB API to get token_ids (asset_ids)
   * CLOB API: GET /book?token_id={token_id}
   * We can also get market info from: GET /markets/{condition_id}
   * 
   * Note: For Gamma API events, the "id" field is often the condition_id
   */
  async fetchMarketTokens(id: string): Promise<Array<{ token_id: string; outcome: string }>> {
    try {
      console.log(`[Sync] Fetching tokens for ID: ${id}`);
      
    // Use clob.polymarket.com for CLOB-specific data as requested
    const clobEndpoints = [
      `${POLYMARKET_API_BASE}/markets/${id}`, // POLYMARKET_API_BASE is clob.polymarket.com
      `${POLYMARKET_API_BASE}/v2/markets/${id}`,
    ];

    // Use gamma-api.polymarket.com for market metadata and linking
    const gammaEndpoints = [
      `${POLYMARKET_GAMMA_API}/markets/${id}`,
      `${POLYMARKET_GAMMA_API}/events/${id}`,
    ];

    const allEndpoints = [...clobEndpoints, ...gammaEndpoints];

    for (const endpoint of allEndpoints) {
      try {
        const isClob = endpoint.includes('clob.polymarket.com');
        console.log(`[${isClob ? 'CLOB' : 'Gamma'} API] Fetching from: ${endpoint}`);
        
        const response = await axios.get<any>(endpoint, { timeout: 10000 });
        const data = response.data;

        console.log(`[${isClob ? 'CLOB' : 'Gamma'} API] Success from ${endpoint}. Keys:`, Object.keys(data).slice(0, 15));

        // 1. Check for tokens array (common in CLOB and Gamma /markets)
        const tokens = data.tokens || data.outcomes;
        if (tokens && Array.isArray(tokens) && tokens.length > 0) {
          const result = tokens.map((t: any) => ({
            token_id: t.token_id || t.asset_id || t.id,
            outcome: t.outcome || t.label || '',
          })).filter(t => t.token_id);
          
          if (result.length > 0) {
            console.log(`[Sync] Found ${result.length} tokens via ${endpoint}`);
            return result;
          }
        }

        // 2. Check for nested markets (common in Gamma /events)
        if (data.markets && Array.isArray(data.markets) && data.markets.length > 0) {
          console.log(`[Sync] Found ${data.markets.length} nested markets in event. Checking first market for tokens...`);
          const firstMarket = data.markets[0];
          const marketTokens = firstMarket.tokens || firstMarket.outcomes;
          if (marketTokens && Array.isArray(marketTokens)) {
            return marketTokens.map((t: any) => ({
              token_id: t.token_id || t.asset_id || t.id,
              outcome: t.outcome || t.label || '',
            })).filter(t => t.token_id);
          }
          
          // If no tokens in market object, maybe it has a conditionId we can use
          if (firstMarket.conditionId && firstMarket.conditionId !== id) {
            console.log(`[Sync] Found conditionId ${firstMarket.conditionId} in event. Recursive call...`);
            return this.fetchMarketTokens(firstMarket.conditionId);
          }
        }
      } catch (error) {
        // Silently continue to next endpoint
        continue;
      }
    }

      console.warn(`[Sync] No tokens found for ID ${id} from any endpoint`);
      return [];
    } catch (error) {
      console.warn(`[Sync] Could not fetch tokens for ID ${id}:`, error instanceof Error ? error.message : String(error));
      return [];
    }
  }
}

export const polymarketRest = new PolymarketRestClient();

