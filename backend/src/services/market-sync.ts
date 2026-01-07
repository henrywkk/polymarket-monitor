import { MarketIngestionService } from './market-ingestion';
import { PolymarketRestClient, PolymarketMarket, TAG_IDS } from './polymarket-rest';
import { Market, Outcome } from '../models/Market';
import { query } from '../config/database';

export class MarketSyncService {
  private restClient: PolymarketRestClient;
  private ingestionService: MarketIngestionService;

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
    };

    // Upsert market
    await this.ingestionService.upsertMarket(market);

    // Sync outcomes if available
    // After syncing outcomes, we'll subscribe to price updates
    if (pmMarket.outcomes && pmMarket.outcomes.length > 0) {
      for (const pmOutcome of pmMarket.outcomes) {
        const outcome: Omit<Outcome, 'createdAt'> = {
          id: pmOutcome.id || pmOutcome.tokenId || `${marketId}-${pmOutcome.outcome}`,
          marketId: marketId,
          outcome: pmOutcome.outcome,
          tokenId: pmOutcome.tokenId || pmOutcome.id || pmMarket.tokenId || pmMarket.conditionId || '',
        };

        await this.ingestionService.upsertOutcome(outcome);
      }
    } else if (pmMarket.conditionId || pmMarket.questionId || pmMarket.tokenId) {
      // Binary market - create Yes/No outcomes
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
    }

    // Subscribe to WebSocket updates for this market (non-blocking)
    // This ensures we get real-time price updates for newly synced markets
    this.ingestionService.subscribeToMarket(marketId).catch((error: unknown) => {
      // Don't fail sync if subscription fails
      console.warn(`Failed to subscribe to market ${marketId}:`, error);
    });
  }
}

