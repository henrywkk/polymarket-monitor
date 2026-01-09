import { PolymarketRestClient, PolymarketMarket } from './polymarket-rest';
import { MarketSyncService } from './market-sync';
import { query } from '../config/database';

/**
 * Service to discover and sync high-volume restricted markets
 * that are excluded from normal paginated results
 */
export class HighVolumeDiscoveryService {
  private restClient: PolymarketRestClient;
  private syncService: MarketSyncService;
  private discoveryInterval?: NodeJS.Timeout;
  
  // Thresholds for high-volume markets
  private readonly MIN_24H_VOLUME = 100000; // $100k minimum 24h volume
  private readonly MIN_TOTAL_VOLUME = 500000; // $500k minimum total volume
  
  constructor(restClient: PolymarketRestClient, syncService: MarketSyncService) {
    this.restClient = restClient;
    this.syncService = syncService;
  }

  /**
   * Start periodic discovery of high-volume markets
   * Runs every 30 minutes by default
   */
  start(intervalMinutes: number = 30): void {
    if (this.discoveryInterval) {
      console.log('[High-Volume Discovery] Already running');
      return;
    }

    console.log(`[High-Volume Discovery] Starting periodic discovery (interval: ${intervalMinutes} minutes)`);
    
    // Run initial discovery after a short delay (to let server fully start and API connections stabilize)
    setTimeout(() => {
      this.discoverHighVolumeMarkets().catch(err => {
        console.error('[High-Volume Discovery] Error in initial discovery:', err);
      });
    }, 10000); // Wait 10 seconds after server start

    // Then schedule periodic discovery
    this.discoveryInterval = setInterval(() => {
      this.discoverHighVolumeMarkets().catch(err => {
        console.error('[High-Volume Discovery] Error in periodic discovery:', err);
      });
    }, intervalMinutes * 60 * 1000);
  }

  /**
   * Stop periodic discovery
   */
  stop(): void {
    if (this.discoveryInterval) {
      clearInterval(this.discoveryInterval);
      this.discoveryInterval = undefined;
      console.log('[High-Volume Discovery] Stopped');
    }
  }

  /**
   * Discover high-volume markets using multiple strategies
   */
  async discoverHighVolumeMarkets(): Promise<number> {
    console.log('[High-Volume Discovery] Starting discovery...');
    const startTime = Date.now();
    let discovered = 0;

    try {
      // Strategy 1: Fetch top markets by 24h volume
      const topBy24hVolume = await this.discoverByVolumeSort('volume24hr', 'desc', 100);
      discovered += await this.syncDiscoveredMarkets(topBy24hVolume, '24h volume');

      // Strategy 2: Fetch top markets by total volume
      const topByTotalVolume = await this.discoverByVolumeSort('volume', 'desc', 100);
      discovered += await this.syncDiscoveredMarkets(topByTotalVolume, 'total volume');

      // Strategy 3: Check known high-volume market IDs/slugs
      // This can be extended with a list of known restricted markets
      const knownHighVolumeMarkets = await this.checkKnownHighVolumeMarkets();
      discovered += await this.syncDiscoveredMarkets(knownHighVolumeMarkets, 'known markets');

      const duration = Date.now() - startTime;
      console.log(`[High-Volume Discovery] Completed: ${discovered} new markets discovered in ${duration}ms`);
      
      return discovered;
    } catch (error) {
      console.error('[High-Volume Discovery] Error during discovery:', error);
      return discovered;
    }
  }

  /**
   * Discover markets by sorting by volume
   */
  private async discoverByVolumeSort(
    sortBy: 'volume' | 'volume24hr',
    order: 'asc' | 'desc',
    limit: number = 100
  ): Promise<PolymarketMarket[]> {
    try {
      console.log(`[High-Volume Discovery] Fetching top ${limit} markets by ${sortBy}...`);
      
      // Try to fetch markets sorted by volume
      // Note: Some Polymarket endpoints may not support sortBy parameter
      // If that fails, we'll fetch without sorting and sort/filter client-side
      let markets: PolymarketMarket[] = [];
      
      try {
        markets = await this.restClient.fetchMarkets({
          limit: Math.min(limit * 2, 500), // Fetch more to account for filtering
          offset: 0,
          active: true,
          closed: false,
          sortBy: sortBy === 'volume24hr' ? 'volume24hr' : 'volume',
          order,
        });
      } catch (error) {
        // If sorting fails, try without sortBy parameter
        console.warn(`[High-Volume Discovery] Failed to fetch with sortBy, trying without sorting...`);
        markets = await this.restClient.fetchMarkets({
          limit: Math.min(limit * 5, 1000), // Fetch even more to find high-volume markets
          offset: 0,
          active: true,
          closed: false,
          // No sortBy - will sort client-side
        });
      }

      if (markets.length === 0) {
        console.warn(`[High-Volume Discovery] No markets fetched for ${sortBy} sort`);
        return [];
      }

      // Sort client-side if needed (in case API didn't sort)
      if (sortBy === 'volume24hr') {
        markets.sort((a, b) => {
          const volA = parseFloat(a.volume24h || '0');
          const volB = parseFloat(b.volume24h || '0');
          return order === 'desc' ? volB - volA : volA - volB;
        });
      } else {
        markets.sort((a, b) => {
          const volA = parseFloat(a.volume || '0');
          const volB = parseFloat(b.volume || '0');
          return order === 'desc' ? volB - volA : volA - volB;
        });
      }

      // Take top N markets
      markets = markets.slice(0, limit);

      // Filter for high-volume markets
      const highVolumeMarkets = markets.filter(m => {
        const volume24h = parseFloat(m.volume24h || '0');
        const totalVolume = parseFloat(m.volume || '0');
        
        return volume24h >= this.MIN_24H_VOLUME || totalVolume >= this.MIN_TOTAL_VOLUME;
      });

      console.log(`[High-Volume Discovery] Found ${highVolumeMarkets.length} high-volume markets (from ${markets.length} total)`);
      return highVolumeMarkets;
    } catch (error) {
      console.error(`[High-Volume Discovery] Error fetching markets by ${sortBy}:`, error);
      return [];
    }
  }

  /**
   * Check known high-volume restricted markets
   * This can be extended with a database table or config file
   */
  private async checkKnownHighVolumeMarkets(): Promise<PolymarketMarket[]> {
    // List of known high-volume restricted markets (can be extended)
    const knownMarketIds = [
      '131313', // Infinex public sale
      // Add more known high-volume restricted markets here
    ];

    const markets: PolymarketMarket[] = [];

    for (const marketId of knownMarketIds) {
      try {
        // Check if already in database
        const existing = await query(
          'SELECT id FROM markets WHERE id = $1',
          [marketId]
        );

        if (existing.rows.length > 0) {
          continue; // Already synced
        }

        // Fetch market details
        const market = await this.restClient.fetchMarket(marketId);
        if (market) {
          // Verify it's high-volume
          const volume24h = parseFloat(market.volume24h || '0');
          const totalVolume = parseFloat(market.volume || '0');
          
          if (volume24h >= this.MIN_24H_VOLUME || totalVolume >= this.MIN_TOTAL_VOLUME) {
            markets.push(market);
            console.log(`[High-Volume Discovery] Found known high-volume market: ${marketId} (${market.question || marketId})`);
          }
        }
      } catch (error) {
        console.error(`[High-Volume Discovery] Error checking known market ${marketId}:`, error);
      }
    }

    return markets;
  }

  /**
   * Sync discovered markets to database
   */
  private async syncDiscoveredMarkets(
    markets: PolymarketMarket[],
    source: string
  ): Promise<number> {
    let synced = 0;

    for (const market of markets) {
      try {
        const marketId = market.conditionId || market.questionId || market.id;
        if (!marketId) {
          continue;
        }

        // Check if already in database
        const existing = await query(
          'SELECT id FROM markets WHERE id = $1',
          [marketId]
        );

        if (existing.rows.length > 0) {
          continue; // Already synced
        }

        // Sync the market
        console.log(`[High-Volume Discovery] Syncing market from ${source}: ${marketId} (${market.question || marketId})`);
        await this.syncService.syncMarket(market);
        synced++;
      } catch (error) {
        console.error(`[High-Volume Discovery] Error syncing market:`, error);
      }
    }

    if (synced > 0) {
      console.log(`[High-Volume Discovery] Synced ${synced} new markets from ${source}`);
    }

    return synced;
  }

  /**
   * Manually trigger discovery (useful for testing or admin endpoints)
   */
  async triggerDiscovery(): Promise<number> {
    return await this.discoverHighVolumeMarkets();
  }
}
