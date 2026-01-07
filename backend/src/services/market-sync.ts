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
    const question = (market.question || '').toLowerCase();
    const tags = (market.tags || []).map(t => t.toLowerCase());
    const category = (market.category || '').toLowerCase();
    
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
      if (tags.length > 0) {
        console.log(`Fetched ${tags.length} tags from Polymarket API`);
        const cryptoTag = tags.find(t => t.label?.toLowerCase() === 'crypto' || t.slug?.toLowerCase() === 'crypto');
        if (cryptoTag) {
          console.log(`Found Crypto tag: id=${cryptoTag.id}, label=${cryptoTag.label}`);
        }
      }
      
      // Fetch markets from different categories using tag_id
      const tagIds = [
        { tagId: TAG_IDS.CRYPTO, category: 'Crypto' },
        { tagId: TAG_IDS.POLITICS, category: 'Politics' },
        { tagId: TAG_IDS.SPORTS, category: 'Sports' },
        { tagId: undefined, category: 'All' }, // Fetch all markets
      ];
      
      const marketsPerCategory = Math.ceil(limit / tagIds.length);
      let allMarkets: PolymarketMarket[] = [];
      const seenIds = new Set<string>();

      for (const { tagId, category } of tagIds) {
        try {
          const categoryMarkets = await this.restClient.fetchMarkets({ 
            limit: marketsPerCategory,
            tagId,
            active: true,
            closed: false,
          });
          
          // Deduplicate and categorize markets
          for (const market of categoryMarkets) {
            const marketId = market.conditionId || market.questionId || market.id;
            if (marketId && !seenIds.has(marketId)) {
              seenIds.add(marketId);
              // Set category based on tag_id used
              if (tagId) {
                market.category = category;
              } else {
                // Fallback to intelligent detection for markets without tag_id
                market.category = this.detectCategory(market);
              }
              allMarkets.push(market);
            }
          }
          
          if (tagId) {
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

    // Convert Polymarket market to our Market format
    const market: Omit<Market, 'createdAt' | 'updatedAt'> = {
      id: marketId,
      question: pmMarket.question || 'Untitled Market',
      slug: pmMarket.slug || marketId,
      category: pmMarket.category || (pmMarket.tags && pmMarket.tags[0]) || 'Uncategorized',
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

