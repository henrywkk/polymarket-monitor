import { MarketSyncService } from './market-sync';

export interface SyncStats {
  lastSyncTime: Date | null;
  totalSyncs: number;
  lastSyncCount: number;
  isRunning: boolean;
}

/**
 * Service to handle periodic market synchronization
 * Runs in the background without blocking the server
 */
export class PeriodicSyncService {
  private syncService: MarketSyncService;
  private syncInterval: number; // in milliseconds
  private intervalId: NodeJS.Timeout | null = null;
  private stats: SyncStats = {
    lastSyncTime: null,
    totalSyncs: 0,
    lastSyncCount: 0,
    isRunning: false,
  };

  constructor(syncService: MarketSyncService, intervalMinutes: number = 5) {
    this.syncService = syncService;
    this.syncInterval = intervalMinutes * 60 * 1000; // Convert minutes to milliseconds
  }

  /**
   * Start periodic sync
   */
  start(): void {
    if (this.intervalId) {
      console.log('Periodic sync is already running');
      return;
    }

    console.log(`Starting periodic market sync (interval: ${this.syncInterval / 1000 / 60} minutes)`);
    
    // Run initial sync immediately
    this.runSync();

    // Then schedule periodic syncs
    this.intervalId = setInterval(() => {
      this.runSync();
    }, this.syncInterval);
  }

  /**
   * Stop periodic sync
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.stats.isRunning = false;
      console.log('Periodic sync stopped');
    }
  }

  /**
   * Run a single sync operation (non-blocking)
   */
  private async runSync(): Promise<void> {
    if (this.stats.isRunning) {
      console.log('Sync already in progress, skipping this cycle');
      return;
    }

    this.stats.isRunning = true;
    const startTime = Date.now();

    try {
      console.log(`[Periodic Sync] Starting market sync at ${new Date().toISOString()}`);
      
      // Use smart sync that only updates changed markets
      const synced = await this.syncService.syncMarkets(500);
      
      const duration = Date.now() - startTime;
      this.stats.lastSyncTime = new Date();
      this.stats.lastSyncCount = synced;
      this.stats.totalSyncs++;

      // Run maintenance tasks (like pruning) every 6 hours
      // Assuming 5-minute interval, 72 syncs = 6 hours
      if (this.stats.totalSyncs % 72 === 0) {
        console.log('[Periodic Sync] Running maintenance tasks...');
        await this.syncService.ingestionService.pruneOldHistory(7); // Keep 7 days
      }

      console.log(`[Periodic Sync] Completed: ${synced} markets synced in ${duration}ms`);
    } catch (error) {
      console.error('[Periodic Sync] Error during sync:', error);
    } finally {
      this.stats.isRunning = false;
    }
  }

  /**
   * Get sync statistics
   */
  getStats(): SyncStats {
    return { ...this.stats };
  }

  /**
   * Manually trigger a sync (useful for testing or admin endpoints)
   */
  async triggerSync(): Promise<number> {
    if (this.stats.isRunning) {
      throw new Error('Sync is already in progress');
    }

    return await this.syncService.syncMarkets(500);
  }
}

