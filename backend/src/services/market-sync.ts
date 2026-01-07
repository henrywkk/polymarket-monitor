import { MarketIngestionService } from './market-ingestion';
import { PolymarketRestClient, PolymarketMarket } from './polymarket-rest';
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
   * Sync markets from Polymarket API to database
   */
  async syncMarkets(limit: number = 100): Promise<number> {
    try {
      console.log(`Starting market sync, fetching up to ${limit} markets...`);
      
      const markets = await this.restClient.fetchMarkets({ limit });
      
      if (markets.length === 0) {
        console.log('No markets fetched from Polymarket API');
        return 0;
      }

      console.log(`Fetched ${markets.length} markets, processing...`);

      let synced = 0;
      for (const pmMarket of markets) {
        try {
          await this.syncMarket(pmMarket);
          synced++;
        } catch (error) {
          console.error(`Error syncing market ${pmMarket.id}:`, error);
        }
      }

      console.log(`Successfully synced ${synced}/${markets.length} markets`);
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

