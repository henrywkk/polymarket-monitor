import { MarketIngestionService } from './market-ingestion';
import { PolymarketRestClient, PolymarketMarket, TAG_IDS } from './polymarket-rest';
import { Market, Outcome } from '../models/Market';

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
        console.log(`Fetched ${tags.length} tags from Polymarket API`);
        
        // Log first few tags to see their structure
        const sampleTags = tags.slice(0, 5);
        console.log('Sample tags:', JSON.stringify(sampleTags, null, 2));
        
        // Search for Crypto tag - look for exact match first, then partial matches
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
          console.log(`Found Crypto tag: id=${cryptoTag.id}, label=${cryptoTag.label}, slug=${cryptoTag.slug}`);
        } else {
          console.warn(`Crypto tag not found in fetched tags. Using default: ${TAG_IDS.CRYPTO}`);
          // Search through all tags for crypto-related tags
          const cryptoRelatedTags = tags.filter(t => {
            const label = (t.label || '').toLowerCase();
            const slug = (t.slug || '').toLowerCase();
            return label.includes('crypto') || slug.includes('crypto') || 
                   label.includes('bitcoin') || slug.includes('bitcoin') ||
                   label.includes('ethereum') || slug.includes('ethereum');
          });
          if (cryptoRelatedTags.length > 0) {
            console.log(`Found ${cryptoRelatedTags.length} crypto-related tags:`, 
              cryptoRelatedTags.map(t => ({ id: t.id, label: t.label, slug: t.slug })));
          }
        }
        
        // Search for Politics tag - look for exact match first, then partial matches
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
          console.log(`Found Politics tag: id=${politicsTag.id}, label=${politicsTag.label}, slug=${politicsTag.slug}`);
        } else {
          console.warn(`Politics tag not found in fetched tags. Using default: ${TAG_IDS.POLITICS}`);
        }
        
        // Search for Sports tag - look for exact match first, then partial matches
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
          console.log(`Found Sports tag: id=${sportsTag.id}, label=${sportsTag.label}, slug=${sportsTag.slug}`);
        } else {
          console.warn(`Sports tag not found in fetched tags. Using default: ${TAG_IDS.SPORTS}`);
        }
        
        // Log all category-related tags to help identify correct IDs
        const categoryTags = tags.filter(t => {
          const label = (t.label || '').toLowerCase();
          const slug = (t.slug || '').toLowerCase();
          return label.includes('crypto') || slug.includes('crypto') ||
                 label.includes('politic') || slug.includes('politic') ||
                 label.includes('sport') || slug.includes('sport') ||
                 label.includes('election') || slug.includes('election');
        });
        if (categoryTags.length > 0) {
          console.log(`Found ${categoryTags.length} category-related tags:`, 
            categoryTags.map(t => ({ id: t.id, label: t.label, slug: t.slug })));
        }
      } else {
        console.warn('No tags fetched, using default tag IDs');
      }
      
      // Fetch markets from different categories using tag_slug (more reliable than tag_id)
      const categoryConfigs = [
        { tagSlug: 'crypto', tagId: cryptoTagId, category: 'Crypto' },
        { tagSlug: 'politics', tagId: politicsTagId, category: 'Politics' },
        { tagSlug: 'sports', tagId: sportsTagId, category: 'Sports' },
        { tagSlug: undefined, tagId: undefined, category: 'All' }, // Fetch all markets
      ];
      
      const marketsPerCategory = Math.ceil(limit / categoryConfigs.length);
      let allMarkets: PolymarketMarket[] = [];
      const seenIds = new Set<string>();

      for (const { tagSlug, tagId, category } of categoryConfigs) {
        try {
          const categoryMarkets = await this.restClient.fetchMarkets({ 
            limit: marketsPerCategory,
            tagSlug, // Prefer tag_slug (more reliable)
            tagId: tagSlug ? undefined : tagId, // Only use tagId if tagSlug is not available
            active: true,
            closed: false,
          });
          
          // Deduplicate and categorize markets
          for (const market of categoryMarkets) {
            const marketId = market.conditionId || market.questionId || market.id;
            if (marketId && !seenIds.has(marketId)) {
              seenIds.add(marketId);
              // Set category based on tag_slug/tag_id used
              if (tagSlug || tagId) {
                market.category = category;
              } else {
                // Fallback to intelligent detection for markets without tag filter
                market.category = this.detectCategory(market);
              }
              allMarkets.push(market);
            }
          }
          
          if (tagSlug) {
            console.log(`Fetched ${categoryMarkets.length} markets with tag_slug=${tagSlug} (${category})`);
            // Log sample markets to verify they match the expected category
            if (categoryMarkets.length > 0) {
              const sample = categoryMarkets.slice(0, 3).map(m => ({
                id: m.id || m.conditionId || m.questionId,
                question: m.question?.substring(0, 60),
                category: m.category,
                tags: m.tags,
              }));
              console.log(`Sample markets from tag_slug=${tagSlug}:`, JSON.stringify(sample, null, 2));
            }
          } else if (tagId) {
            console.log(`Fetched ${categoryMarkets.length} markets with tag_id=${tagId} (${category})`);
          } else {
            console.log(`Fetched ${categoryMarkets.length} markets (all categories)`);
          }
        } catch (error) {
          console.warn(`Error fetching markets for tag_id ${tagId}:`, error);
          // Continue with other categories
        }
      }

      // If we still don't have enough markets, fetch more without tag filter
      if (allMarkets.length < limit) {
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

      // Count by category
      const categoryCounts = allMarkets.reduce((acc, m) => {
        const cat = m.category || 'Uncategorized';
        acc[cat] = (acc[cat] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      console.log(`Categorized markets:`, categoryCounts);

      let synced = 0;
      for (const pmMarket of allMarkets) {
        try {
          await this.syncMarket(pmMarket);
          synced++;
        } catch (error) {
          console.error(`Error syncing market ${pmMarket.id}:`, error);
        }
      }

      console.log(`Successfully synced ${synced}/${allMarkets.length} markets`);
      return synced;
    } catch (error) {
      console.error('Error during market sync:', error);
      return 0;
    }
  }

  /**
   * Sync a single market from Polymarket format to our database
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

    // Convert Polymarket market to our Market format
    const market: Omit<Market, 'createdAt' | 'updatedAt'> = {
      id: marketId,
      question: pmMarket.question || 'Untitled Market',
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
  }
}

