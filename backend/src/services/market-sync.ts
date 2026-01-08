import { MarketIngestionService } from './market-ingestion';
import { PolymarketRestClient, PolymarketMarket, TAG_IDS } from './polymarket-rest';
import { Market, Outcome } from '../models/Market';
import { query } from '../config/database';

export class MarketSyncService {
  private restClient: PolymarketRestClient;
  public ingestionService: MarketIngestionService;

  constructor(
    restClient: PolymarketRestClient,
    ingestionService: MarketIngestionService
  ) {
    this.restClient = restClient;
    this.ingestionService = ingestionService;
  }

  /**
   * Detect category from market data
   */
  private detectCategory(market: PolymarketMarket): string {
    const question = String(market.question || '').toLowerCase();
    // Handle tags - they might be strings, numbers, or objects
    const tags = (market.tags || []).map((t: any) => {
      if (typeof t === 'string') return t.toLowerCase();
      if (typeof t === 'number') return String(t);
      if (t && typeof t === 'object') {
        // Handle tag objects like {id, label, slug}
        return (t.label || t.slug || String(t.id || '')).toLowerCase();
      }
      return String(t || '').toLowerCase();
    });
    // Handle category - might be string, number, object, or null
    let category = '';
    if (market.category) {
      if (typeof market.category === 'string') {
        category = market.category.toLowerCase();
      } else if (typeof market.category === 'object' && market.category !== null) {
        const catObj = market.category as any;
        category = (catObj.label || catObj.slug || String(catObj.id || '')).toLowerCase();
      } else {
        category = String(market.category).toLowerCase();
      }
    }
    
    // Crypto keywords
    const cryptoKeywords = ['bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'cryptocurrency', 
                           'token', 'coin', 'defi', 'nft', 'blockchain', 'solana', 'sol',
                           'price of $', 'will $', 'token price', 'coin price'];
    
    // Politics keywords
    const politicsKeywords = ['president', 'election', 'biden', 'trump', 'democrat', 'republican',
                             'senate', 'congress', 'vote', 'candidate', 'nomination'];
    
    // Sports keywords
    const sportsKeywords = ['nba', 'nfl', 'nhl', 'mlb', 'ufc', 'soccer', 'football', 'basketball',
                           'hockey', 'baseball', 'game', 'match', 'championship', 'tournament'];
    
    // Check tags first
    if (tags.some(t => t.includes('crypto') || t.includes('bitcoin') || t.includes('ethereum'))) {
      return 'Crypto';
    }
    if (tags.some(t => t.includes('politics') || t.includes('election'))) {
      return 'Politics';
    }
    if (tags.some(t => t.includes('sports') || t.includes('nba') || t.includes('nfl'))) {
      return 'Sports';
    }
    
    // Check category field
    if (category.includes('crypto')) return 'Crypto';
    if (category.includes('politic')) return 'Politics';
    if (category.includes('sport')) return 'Sports';
    if (category.includes('entertain')) return 'Entertainment';
    
    // Check question text
    if (cryptoKeywords.some(kw => question.includes(kw))) {
      return 'Crypto';
    }
    if (politicsKeywords.some(kw => question.includes(kw))) {
      return 'Politics';
    }
    if (sportsKeywords.some(kw => question.includes(kw))) {
      return 'Sports';
    }
    
    // Use original category or default
    return market.category || category || 'All';
  }

  /**
   * Sync markets from Polymarket API to database
   * Fetches markets by tag_id to ensure we get diverse categories
   */
  async syncMarkets(limit: number = 100): Promise<number> {
    try {
      console.log(`Starting market sync, fetching up to ${limit} markets...`);
      
      // First, try to fetch tags to verify tag IDs
      const tags = await this.restClient.fetchTags();
      let cryptoTagId: string | undefined = TAG_IDS.CRYPTO;
      let politicsTagId: string | undefined = TAG_IDS.POLITICS;
      let sportsTagId: string | undefined = TAG_IDS.SPORTS;
      
      if (tags.length > 0) {
        // Search for Crypto tag
        const cryptoTag = tags.find(t => {
          const label = (t.label || '').toLowerCase();
          const slug = (t.slug || '').toLowerCase();
          return label === 'crypto' || slug === 'crypto';
        }) || tags.find(t => {
          const label = (t.label || '').toLowerCase();
          const slug = (t.slug || '').toLowerCase();
          return label.includes('crypto') || slug.includes('crypto');
        });
        if (cryptoTag) {
          cryptoTagId = String(cryptoTag.id);
        }
        
        // Search for Politics tag
        const politicsTag = tags.find(t => {
          const label = (t.label || '').toLowerCase();
          const slug = (t.slug || '').toLowerCase();
          return label === 'politics' || slug === 'politics';
        }) || tags.find(t => {
          const label = (t.label || '').toLowerCase();
          const slug = (t.slug || '').toLowerCase();
          return label.includes('politic') || slug.includes('politic') ||
                 label.includes('election') || slug.includes('election');
        });
        if (politicsTag) {
          politicsTagId = String(politicsTag.id);
        }
        
        // Search for Sports tag
        const sportsTag = tags.find(t => {
          const label = (t.label || '').toLowerCase();
          const slug = (t.slug || '').toLowerCase();
          return label === 'sports' || slug === 'sports';
        }) || tags.find(t => {
          const label = (t.label || '').toLowerCase();
          const slug = (t.slug || '').toLowerCase();
          return label.includes('sport') || slug.includes('sport');
        });
        if (sportsTag) {
          sportsTagId = String(sportsTag.id);
        }
      }
      
      // Fetch markets from different categories using tag_slug (more reliable than tag_id)
      // For Crypto, also fetch from sub-tags to get all crypto-related markets
      const cryptoSubTags = ['bitcoin', 'ethereum', 'solana', 'xrp', 'dogecoin', 'microstrategy'];
      
      const categoryConfigs = [
        // Crypto: fetch from main tag + sub-tags
        { tagSlug: 'crypto', tagId: cryptoTagId, category: 'Crypto', subTags: cryptoSubTags },
        { tagSlug: 'politics', tagId: politicsTagId, category: 'Politics', subTags: [] },
        { tagSlug: 'sports', tagId: sportsTagId, category: 'Sports', subTags: [] },
        { tagSlug: undefined, tagId: undefined, category: 'All', subTags: [] }, // Fetch all markets
      ];
      
      // Calculate markets per category (accounting for sub-tags)
      const baseCategories = categoryConfigs.filter(c => c.category !== 'All').length;
      const cryptoSubTagCount = cryptoSubTags.length;
      const totalFetchOperations = baseCategories + cryptoSubTagCount + 1; // +1 for "All"
      const marketsPerOperation = Math.ceil(limit / totalFetchOperations);
      
      let allMarkets: PolymarketMarket[] = [];
      const seenIds = new Set<string>();
      const fetchSummary: Record<string, number> = {};

      for (const { tagSlug, tagId, category, subTags } of categoryConfigs) {
        // Fetch from main tag
        try {
          const categoryMarkets = await this.restClient.fetchMarkets({ 
            limit: marketsPerOperation,
            tagSlug,
            tagId: tagSlug ? undefined : tagId,
            active: true,
            closed: false,
          });
          
          // Deduplicate and categorize markets
          for (const market of categoryMarkets) {
            const marketId = market.conditionId || market.questionId || market.id;
            if (marketId && !seenIds.has(marketId)) {
              seenIds.add(marketId);
              market.category = category;
              allMarkets.push(market);
            }
          }
          
          const tagKey = tagSlug || tagId || 'all';
          fetchSummary[`${category}:${tagKey}`] = categoryMarkets.length;
        } catch (error) {
          console.warn(`Error fetching ${category} markets:`, error instanceof Error ? error.message : String(error));
        }
        
        // For Crypto, also fetch from sub-tags
        if (category === 'Crypto' && subTags.length > 0) {
          const subTagCounts: Record<string, number> = {};
          for (const subTag of subTags) {
            try {
              const subTagMarkets = await this.restClient.fetchMarkets({
                limit: marketsPerOperation,
                tagSlug: subTag,
                active: true,
                closed: false,
              });
              
              // Deduplicate and categorize as Crypto
              for (const market of subTagMarkets) {
                const marketId = market.conditionId || market.questionId || market.id;
                if (marketId && !seenIds.has(marketId)) {
                  seenIds.add(marketId);
                  market.category = 'Crypto';
                  allMarkets.push(market);
                }
              }
              
              subTagCounts[subTag] = subTagMarkets.length;
            } catch (error) {
              // Only log errors, not individual fetches
            }
          }
          if (Object.keys(subTagCounts).length > 0) {
            fetchSummary[`Crypto:sub-tags`] = Object.values(subTagCounts).reduce((a, b) => a + b, 0);
          }
        }
      }
      
      // Log summary of all fetches in one line
      const summaryStr = Object.entries(fetchSummary).map(([key, count]) => `${key}=${count}`).join(', ');
      console.log(`Market fetch summary: ${summaryStr}`);
      
      const cryptoMarketsCount = allMarkets.filter(m => m.category === 'Crypto').length;
      if (cryptoMarketsCount > 0) {
        console.log(`Total unique Crypto markets: ${cryptoMarketsCount}`);
      }

      // If we still don't have enough markets, fetch more without tag filter
      // But only if we haven't exceeded the limit significantly
      if (allMarkets.length < limit && allMarkets.length < limit * 1.2) {
        const additionalMarkets = await this.restClient.fetchMarkets({ 
          limit: limit - allMarkets.length,
          active: true,
          closed: false,
        });
        
        for (const market of additionalMarkets) {
          const marketId = market.conditionId || market.questionId || market.id;
          if (marketId && !seenIds.has(marketId)) {
            seenIds.add(marketId);
            market.category = this.detectCategory(market);
            allMarkets.push(market);
          }
        }
      }
      
      if (allMarkets.length === 0) {
        console.log('No markets fetched from Polymarket API');
        return 0;
      }

      // Count by category - ensure all categories are strings
      const categoryCounts = allMarkets.reduce((acc, m) => {
        let cat: string;
        if (typeof m.category === 'string') {
          cat = m.category;
        } else if (typeof m.category === 'object' && m.category !== null) {
          const catObj = m.category as any;
          cat = catObj.label || catObj.slug || String(catObj.id || 'Uncategorized');
        } else {
          cat = String(m.category || 'Uncategorized');
        }
        acc[cat] = (acc[cat] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      console.log(`Categorized markets:`, categoryCounts);

      let synced = 0;
      let skipped = 0;
      for (const pmMarket of allMarkets) {
        try {
          // Smart sync: only sync if market has changed
          const marketId = pmMarket.conditionId || pmMarket.questionId || pmMarket.id || '';
          if (marketId && await this.hasMarketChanged(pmMarket, marketId)) {
            await this.syncMarket(pmMarket);
            synced++;
          } else {
            skipped++;
          }
        } catch (error) {
          console.error(`Error syncing market ${pmMarket.id}:`, error);
        }
      }
      
      if (skipped > 0) {
        console.log(`Smart sync: ${synced} updated, ${skipped} skipped (no changes)`);
      }

      // Special handling: force update for specific multi-outcome markets if requested
      // or if they are currently showing only one outcome
      console.log(`[Sync] Performing deep sync for multi-outcome markets...`);
      const multiOutcomeMarkets = allMarkets.filter(m => 
        (m.markets && m.markets.length > 1) || 
        (m.outcomes && m.outcomes.length > 2)
      );
      
      for (const m of multiOutcomeMarkets) {
        const id = m.conditionId || m.questionId || m.id || '';
        if (id) {
          await this.syncMarket(m);
        }
      }

      console.log(`Successfully synced ${synced}/${allMarkets.length} markets`);
      
      // After syncing markets, subscribe to WebSocket updates for active markets
      // This ensures we get real-time price updates
      if (synced > 0) {
        const marketIds = allMarkets
          .map(m => m.conditionId || m.questionId || m.id)
          .filter((id): id is string => !!id)
          .slice(0, 100); // Limit to first 100 to avoid overwhelming WebSocket
        
        if (marketIds.length > 0) {
          this.ingestionService.subscribeToMarkets(marketIds).catch((error: unknown) => {
            console.warn('Failed to subscribe to markets after sync:', error);
          });
        }
      }
      
      return synced;
    } catch (error) {
      console.error('Error during market sync:', error);
      return 0;
    }
  }

  /**
   * Check if a market has changed by comparing key fields
   * Returns true if market should be updated
   */
  private async hasMarketChanged(pmMarket: PolymarketMarket, marketId: string): Promise<boolean> {
    try {
      const result = await query(
        'SELECT question, slug, category, end_date, image_url, updated_at FROM markets WHERE id = $1',
        [marketId]
      );

      if (result.rows.length === 0) {
        return true; // New market, needs to be inserted
      }

      const existing = result.rows[0];
      const newQuestion = pmMarket.question || '';
      const newSlug = pmMarket.slug || marketId;
      const newCategory = pmMarket.category || 'Uncategorized';
      const newEndDate = pmMarket.endDateISO 
        ? new Date(pmMarket.endDateISO).toISOString()
        : pmMarket.endDate 
        ? new Date(pmMarket.endDate).toISOString()
        : null;
      const newImageUrl = pmMarket.image || null;

      // Compare fields - if any changed, return true
      if (
        existing.question !== newQuestion ||
        existing.slug !== newSlug ||
        existing.category !== newCategory ||
        (existing.end_date?.toISOString() || null) !== newEndDate ||
        existing.image_url !== newImageUrl
      ) {
        return true;
      }

      return false; // No changes detected
    } catch (error) {
      // On error, assume it needs updating to be safe
      console.warn(`Error checking market changes for ${marketId}:`, error);
      return true;
    }
  }

  /**
   * Sync a single market from Polymarket format to our database
   * Only updates if market has actually changed (smart sync)
   */
  private async syncMarket(pmMarket: PolymarketMarket): Promise<void> {
    // Polymarket uses conditionId or questionId as the primary identifier
    // Use conditionId first, then questionId, then id, then tokenId as fallback
    const marketId = pmMarket.conditionId || pmMarket.questionId || pmMarket.id || pmMarket.tokenId;
    
    if (!marketId) {
      // Only log warning for first few skipped markets to avoid log spam
      if (Math.random() < 0.1) {
        console.warn('Skipping market without ID:', {
          question: pmMarket.question?.substring(0, 50),
          conditionId: pmMarket.conditionId,
          questionId: pmMarket.questionId,
        });
      }
      return;
    }

    // Ensure category is a string and not too long (VARCHAR(100) limit)
    let categoryStr = 'Uncategorized';
    if (pmMarket.category) {
      if (typeof pmMarket.category === 'string') {
        categoryStr = pmMarket.category.substring(0, 100); // Truncate if too long
      } else if (typeof pmMarket.category === 'object' && pmMarket.category !== null) {
        // Handle category as object
        const catObj = pmMarket.category as any;
        categoryStr = (catObj.label || catObj.slug || String(catObj.id || 'Uncategorized')).substring(0, 100);
      } else {
        categoryStr = String(pmMarket.category).substring(0, 100);
      }
    } else if (pmMarket.tags && pmMarket.tags.length > 0) {
      // Use first tag as category if available
      const firstTag = pmMarket.tags[0];
      if (typeof firstTag === 'string') {
        categoryStr = firstTag.substring(0, 100);
      } else if (typeof firstTag === 'object' && firstTag !== null) {
        const tagObj = firstTag as any;
        categoryStr = (tagObj.label || tagObj.slug || String(tagObj.id || 'Uncategorized')).substring(0, 100);
      }
    }

    // Extract question - try multiple sources, fallback to slug-based title
    let question = pmMarket.question;
    if (!question && pmMarket.slug) {
      // Convert slug to readable title as fallback
      // e.g., "will-bitcoin-hit-150k" -> "Will Bitcoin Hit 150k"
      question = pmMarket.slug
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
        .replace(/\b(\w)/g, (char, index) => index === 0 ? char.toUpperCase() : char);
    }
    if (!question) {
      question = 'Untitled Market';
    }

    // Convert Polymarket market to our Market format
    const market: Omit<Market, 'createdAt' | 'updatedAt'> = {
      id: marketId,
      question: question,
      slug: pmMarket.slug || marketId,
      category: categoryStr,
      endDate: pmMarket.endDateISO
        ? new Date(pmMarket.endDateISO)
        : pmMarket.endDate
        ? new Date(pmMarket.endDate)
        : null,
      imageUrl: pmMarket.image || null,
      volume: pmMarket.volume ? parseFloat(String(pmMarket.volume)) : 0,
      volume24h: pmMarket.volume24h ? parseFloat(String(pmMarket.volume24h)) : 0,
      liquidity: pmMarket.liquidity ? parseFloat(String(pmMarket.liquidity)) : 0,
      activityScore: pmMarket.volume24h ? parseFloat(String(pmMarket.volume24h)) : 0,
    };

    // Upsert market
    await this.ingestionService.upsertMarket(market);

    // Log market data to debug token_id extraction
    if (Math.random() < 0.05) {
      console.log(`[Sync Debug] Market data for ${marketId}:`, {
        conditionId: pmMarket.conditionId,
        questionId: pmMarket.questionId,
        id: pmMarket.id,
        tokenId: pmMarket.tokenId,
        hasOutcomes: !!(pmMarket.outcomes && pmMarket.outcomes.length > 0),
        outcomesCount: pmMarket.outcomes?.length || 0,
        outcomesWithTokenIds: pmMarket.outcomes?.filter(o => o.tokenId).length || 0,
      });
    }

    // If outcomes don't have token_ids, try to fetch them from API
    let outcomesWithTokens = pmMarket.outcomes || [];
    
    // NEW: Check if this market has nested sub-markets (common for multi-outcome/bucket markets in Gamma /events)
    // If it does, we can extract the bucket names and token IDs directly without an extra API call
    if (outcomesWithTokens.length === 0 && pmMarket.markets && Array.isArray(pmMarket.markets) && pmMarket.markets.length > 0) {
      console.log(`[Sync] Market ${marketId} has ${pmMarket.markets.length} nested markets. Extracting bucket outcomes...`);
      const extractedOutcomes = [];
      
      for (const subMarket of pmMarket.markets) {
        // The bucket name is usually in groupItemTitle, fallback to question or title
        let bucketName = subMarket.groupItemTitle || subMarket.question || subMarket.title || '';
        
        // Clean up bucket name (remove parent question prefix if present)
        // e.g., "Bitcoin price on January 8? <78,000" -> "<78,000"
        if (bucketName && question && bucketName.startsWith(question)) {
          bucketName = bucketName.replace(question, '').replace(/^\W+/, '');
        }
        
        // Get token IDs from clobTokenIds (can be a JSON string or array)
        let tokenIds: string[] = [];
        if (subMarket.clobTokenIds) {
          if (typeof subMarket.clobTokenIds === 'string') {
            try {
              tokenIds = JSON.parse(subMarket.clobTokenIds);
            } catch (e) {
              tokenIds = [];
            }
          } else if (Array.isArray(subMarket.clobTokenIds)) {
            tokenIds = subMarket.clobTokenIds;
          }
        }
        
        if (bucketName && tokenIds.length > 0) {
          extractedOutcomes.push({
            id: tokenIds[0],
            tokenId: tokenIds[0],
            outcome: bucketName,
            price: undefined
          });
        }
      }
      
      if (extractedOutcomes.length > 0) {
        outcomesWithTokens = extractedOutcomes;
        console.log(`[Sync] Successfully extracted ${extractedOutcomes.length} bucket outcomes for ${marketId}`);
      }
    }

    // Try conditionId, questionId, or id
    const idToUse = pmMarket.conditionId || pmMarket.questionId || pmMarket.id;
    if (idToUse && (!pmMarket.outcomes || pmMarket.outcomes.length === 0 || pmMarket.outcomes.every(o => !o.tokenId))) {
      // Try to fetch token_ids from API (CLOB first, then Gamma)
      const tokens = await this.restClient.fetchMarketTokens(idToUse);
      if (tokens.length > 0) {
        console.log(`[Sync] Successfully fetched ${tokens.length} token_ids for ID ${idToUse}`);
        // Merge tokens with existing outcomes or create new ones
        if (pmMarket.outcomes && pmMarket.outcomes.length > 0) {
          outcomesWithTokens = pmMarket.outcomes.map((outcome, index) => ({
            ...outcome,
            tokenId: tokens[index]?.token_id || outcome.tokenId || '',
          }));
        } else {
          // Create outcomes from tokens
          outcomesWithTokens = tokens.map((token: { token_id: string; outcome: string }) => ({
            id: token.token_id,
            tokenId: token.token_id,
            outcome: token.outcome || '',
            price: undefined,
          }));
        }
      }
    }

    // Sync outcomes if available
    // After syncing outcomes, we'll subscribe to price updates
    if (outcomesWithTokens && outcomesWithTokens.length > 0) {
      // Log outcome data for debugging - especially for markets that might have bucket-style outcomes
      const marketQuestion = pmMarket.question || '';
      const mightBeBucketMarket = marketQuestion.toLowerCase().includes('growth') || 
                                   marketQuestion.toLowerCase().includes('gdp') ||
                                   marketQuestion.toLowerCase().includes('%') ||
                                   outcomesWithTokens.length > 2;
      
      if (mightBeBucketMarket || Math.random() < 0.1) {
        console.log(`[Sync] Market ${marketId} ("${marketQuestion}") - Outcome data:`, {
          outcomesCount: outcomesWithTokens.length,
          outcomes: outcomesWithTokens.map(o => ({
            outcome: o.outcome,
            tokenId: o.tokenId,
            id: o.id,
          })),
          conditionId: pmMarket.conditionId,
          questionId: pmMarket.questionId,
        });
      }
      
      for (const pmOutcome of outcomesWithTokens) {
        const outcomeId = pmOutcome.id || pmOutcome.tokenId || `${marketId}-${pmOutcome.outcome}`;
        const outcome: Omit<Outcome, 'createdAt'> = {
          id: outcomeId,
          marketId: marketId,
          outcome: pmOutcome.outcome,
          tokenId: pmOutcome.tokenId || pmOutcome.id || pmMarket.tokenId || pmMarket.conditionId || '',
          volume: pmOutcome.volume ? parseFloat(String(pmOutcome.volume)) : 0,
          volume24h: pmOutcome.volume24h ? parseFloat(String(pmOutcome.volume24h)) : 0,
        };

        await this.ingestionService.upsertOutcome(outcome);

        // If outcome has an initial price, store it in price_history
        if (pmOutcome.price !== undefined && pmOutcome.price !== null) {
          const price = Number(pmOutcome.price);
          if (!isNaN(price)) {
            // We'll use the price as mid, and set tiny spread for initial data
            // Implied probability is price * 100
            await this.ingestionService.handlePriceEvent({
              type: 'price_changed',
              market: marketId,
              outcome: outcomeId,
              price: {
                bid: price * 0.99,
                ask: price * 1.01
              },
              timestamp: Date.now()
            });
          }
        }
      }
    } else if (pmMarket.conditionId || pmMarket.questionId || pmMarket.tokenId) {
      // Binary market - create Yes/No outcomes
      // For binary markets, we need to fetch token_ids from CLOB API
      // For now, use conditionId as placeholder (will need to fetch actual token_ids)
      const yesOutcome: Omit<Outcome, 'createdAt'> = {
        id: `${marketId}-yes`,
        marketId: marketId,
        outcome: 'Yes',
        tokenId: pmMarket.tokenId || pmMarket.conditionId || '',
      };

      const noOutcome: Omit<Outcome, 'createdAt'> = {
        id: `${marketId}-no`,
        marketId: marketId,
        outcome: 'No',
        tokenId: pmMarket.tokenId || pmMarket.conditionId || '',
      };

      await this.ingestionService.upsertOutcome(yesOutcome);
      await this.ingestionService.upsertOutcome(noOutcome);
    } else {
      // No outcomes and no conditionId - log warning
      if (Math.random() < 0.1) {
        console.warn(`[Sync] Market ${marketId} has no outcomes or conditionId - cannot create outcomes`);
      }
    }

    // Subscribe to WebSocket updates for this market (non-blocking)
    // This ensures we get real-time price updates for newly synced markets
    this.ingestionService.subscribeToMarket(marketId).catch((error: unknown) => {
      // Don't fail sync if subscription fails
      console.warn(`Failed to subscribe to market ${marketId}:`, error);
    });
  }
}

