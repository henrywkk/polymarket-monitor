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
  volume24h?: string;
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
  volume24h?: string;
  markets?: any[]; // For multi-outcome events
  [key: string]: any;
}

export interface MarketToken {
  token_id: string;
  outcome: string;
  price?: number;
  volume?: number;
  volume24h?: number;
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
        volume: token.volume ? parseFloat(String(token.volume)) : undefined,
        volume24h: token.volume24h ? parseFloat(String(token.volume24h)) : undefined,
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
    volume24h: raw.volume24hr || raw.volume24h || raw['24hr_volume'] || undefined,
    markets: raw.markets, // Pass through nested markets for multi-outcome events
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
  async fetchMarketTokens(id: string): Promise<MarketToken[]> {
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
          // Log first token to see structure
          if (tokens.length > 0 && Math.random() < 0.1) {
            console.log(`[Sync Debug] Sample token structure from ${endpoint}:`, {
              firstToken: tokens[0],
              allTokenKeys: tokens.length > 0 ? Object.keys(tokens[0]) : [],
              tokenCount: tokens.length,
            });
          }
          
          const result: MarketToken[] = tokens.map((t: any, idx: number) => {
            // Try to get price from various fields
            let price: number | undefined = undefined;
            const rawPrice = t.price || (data.outcomePrices && data.outcomePrices[idx]) || data.lastTradePrice;
            if (rawPrice) {
              price = parseFloat(rawPrice);
            }

            return {
              token_id: t.token_id || t.asset_id || t.id,
              outcome: t.outcome || t.label || t.name || t.title || '',
              price: !isNaN(price as number) ? (price as number) : undefined,
            } as MarketToken;
          }).filter(t => t.token_id);
          
          if (result.length > 0) {
            console.log(`[Sync] Found ${result.length} tokens via ${endpoint}`);
            // Log outcomes to see if we're getting bucket names or Yes/No
            if (result.length > 2 && Math.random() < 0.2) {
              console.log(`[Sync Debug] Token outcomes:`, result.map(r => r.outcome));
            }
            return result;
          }
        }

        // 2. Check for nested markets (common in Gamma /events)
        // For multi-outcome markets, the event might have multiple sub-markets
        // Each sub-market represents a bucket (e.g., "<0.5%", "0.5-1.0%")
        // The bucket name is in groupItemTitle field, and tokens are in clobTokenIds
        if (data.markets && Array.isArray(data.markets) && data.markets.length > 0) {
          console.log(`[Sync] Found ${data.markets.length} nested markets in event. Structure:`, {
            eventQuestion: data.question || data.title,
            markets: data.markets.map((m: any) => ({
              question: m.question || m.title,
              groupItemTitle: m.groupItemTitle, // This is the bucket name!
              conditionId: m.conditionId || m.condition_id,
              clobTokenIds: m.clobTokenIds ? (typeof m.clobTokenIds === 'string' ? JSON.parse(m.clobTokenIds) : m.clobTokenIds) : [],
            })),
          });
          
          // For multi-outcome markets, collect all sub-markets with their bucket names
          const allTokens: MarketToken[] = [];
          
          for (const subMarket of data.markets) {
            // Get bucket name from groupItemTitle (e.g., "<0.5%", "0.5-1.0%", ">2.5%")
            const bucketName = subMarket.groupItemTitle || subMarket.question || subMarket.title || '';
            
            // Get token IDs from clobTokenIds (JSON string array)
            let tokenIds: string[] = [];
            if (subMarket.clobTokenIds) {
              if (typeof subMarket.clobTokenIds === 'string') {
                try {
                  tokenIds = JSON.parse(subMarket.clobTokenIds);
                } catch (e) {
                  // If parsing fails, try to extract as array
                  tokenIds = Array.isArray(subMarket.clobTokenIds) ? subMarket.clobTokenIds : [];
                }
              } else if (Array.isArray(subMarket.clobTokenIds)) {
                tokenIds = subMarket.clobTokenIds;
              }
            }
            
            // If we have bucket name and token IDs, create one outcome per bucket
            // Each sub-market typically has 2 tokens (Yes/No), but we store the bucket name
            // We'll use the first token ID (typically the "Yes" token)
            if (bucketName && tokenIds.length > 0) {
              // Extract price if available from outcomePrices or lastTradePrice
              let price: number | undefined = undefined;
              if (subMarket.outcomePrices && Array.isArray(subMarket.outcomePrices) && subMarket.outcomePrices.length > 0) {
                price = parseFloat(subMarket.outcomePrices[0]);
              } else if (subMarket.lastTradePrice) {
                price = parseFloat(subMarket.lastTradePrice);
              }

              // Extract volume
              const outcomeVolume = subMarket.volumeNum || (subMarket.volume ? parseFloat(String(subMarket.volume)) : undefined);
              const outcomeVolume24h = subMarket.volume24hr || (subMarket.volume24h ? parseFloat(String(subMarket.volume24h)) : undefined);

              // Create one outcome per bucket using the first token ID
              // The bucket name (e.g., "<0.5%") is what we want to display
              const token: MarketToken = {
                token_id: tokenIds[0], // Use first token (Yes token)
                outcome: bucketName, // Use bucket name instead of Yes/No
                price: !isNaN(price as number) ? (price as number) : undefined,
                volume: outcomeVolume,
                volume24h: outcomeVolume24h,
              };
              allTokens.push(token);
            } else if (bucketName) {
              // If we have bucket name but no token IDs, we still want to store the bucket
              // We'll need to fetch token IDs separately using conditionId
              if (subMarket.conditionId) {
                console.log(`[Sync] Found bucket "${bucketName}" but no token IDs. Will fetch from conditionId ${subMarket.conditionId}`);
                // For now, we'll return what we have and let the caller handle it
              }
            }
          }
          
          if (allTokens.length > 0) {
            console.log(`[Sync] Extracted ${allTokens.length} tokens from ${data.markets.length} sub-markets`);
            // Log unique bucket names
            const uniqueBuckets = [...new Set(allTokens.map(t => t.outcome).filter(Boolean))];
            if (uniqueBuckets.length > 0) {
              console.log(`[Sync] Bucket names found:`, uniqueBuckets);
            }
            return allTokens;
          }
          
          // Fallback: if we have bucket names but no token IDs, try to get tokens from conditionId
          // This might happen if clobTokenIds is not available
          const firstMarket = data.markets[0];
          if (firstMarket.conditionId && firstMarket.conditionId !== id) {
            console.log(`[Sync] Found conditionId ${firstMarket.conditionId} in event. Recursive call...`);
            const tokens = await this.fetchMarketTokens(firstMarket.conditionId);
            // If we got tokens, map them to bucket names
            if (tokens.length > 0 && data.markets.length > 0) {
              // Map tokens to their corresponding bucket
              const tokensWithBuckets: MarketToken[] = tokens.map((token, idx) => {
                const marketIdx = Math.floor(idx / 2); // Assuming 2 tokens per market (Yes/No)
                const bucketName = data.markets[marketIdx]?.groupItemTitle || token.outcome;
                return {
                  token_id: token.token_id,
                  outcome: bucketName,
                  price: token.price,
                };
              });
              return tokensWithBuckets;
            }
            return tokens;
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

