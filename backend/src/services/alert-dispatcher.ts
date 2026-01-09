/**
 * Alert Dispatcher Service
 * 
 * Processes alerts from Redis queue and delivers them through notification channels.
 * Responsibilities:
 * - Poll Redis alerts:pending queue
 * - Apply throttling rules
 * - Format alerts into human-readable messages
 * - Route to appropriate notification channels
 * - Track delivery status
 */

import { redis } from '../config/redis';
import { query } from '../config/database';
import { AlertEvent } from './anomaly-detector';
import { AlertThrottle } from './alert-throttle';
import { NotificationChannel } from './notification-channels';

export interface FormattedAlert {
  title: string;
  message: string;
  severity: string;
  marketInfo: {
    marketId: string;
    marketName?: string;
    outcomeName?: string;
    category?: string;
    slug?: string;
  };
  metrics: {
    priceChange?: number;
    volumeZScore?: number;
    tradeSize?: number;
    spread?: number;
    depth?: number;
    absoluteChange?: number;
    percentageChange?: number;
  };
  timestamp: string;
  polymarketUrl?: string;
  rawAlert: AlertEvent;
}

export class AlertDispatcher {
  private throttle: AlertThrottle;
  private channels: NotificationChannel[];
  private isRunning: boolean = false;
  private pollInterval?: NodeJS.Timeout;
  private readonly POLL_INTERVAL_MS = 2000; // Poll every 2 seconds
  private readonly ALERT_QUEUE_KEY = 'alerts:pending';

  constructor(throttle: AlertThrottle, channels: NotificationChannel[]) {
    this.throttle = throttle;
    this.channels = channels.filter(ch => ch.enabled);
  }

  /**
   * Start processing alerts from queue
   */
  start(): void {
    if (this.isRunning) {
      console.log('[Alert Dispatcher] Already running');
      return;
    }

    this.isRunning = true;
    console.log('[Alert Dispatcher] Starting alert processing...');

    // Process alerts immediately, then poll periodically
    this.processQueue().catch(err => {
      console.error('[Alert Dispatcher] Error in initial processing:', err);
    });

    this.pollInterval = setInterval(() => {
      this.processQueue().catch(err => {
        console.error('[Alert Dispatcher] Error processing queue:', err);
      });
    }, this.POLL_INTERVAL_MS);
  }

  /**
   * Stop processing alerts
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = undefined;
    }

    console.log('[Alert Dispatcher] Stopped');
  }

  /**
   * Process alerts from Redis queue
   */
  private async processQueue(): Promise<void> {
    try {
      // Pop alert from queue (right pop for FIFO)
      const alertJson = await redis.rpop(this.ALERT_QUEUE_KEY);

      if (!alertJson) {
        return; // No alerts in queue
      }

      let alert: AlertEvent;
      try {
        alert = JSON.parse(alertJson);
      } catch (error) {
        console.error('[Alert Dispatcher] Error parsing alert JSON:', error);
        return;
      }

      // Process the alert
      await this.processAlert(alert);
    } catch (error) {
      console.error('[Alert Dispatcher] Error processing queue:', error);
    }
  }

  /**
   * Process a single alert
   */
  private async processAlert(alert: AlertEvent): Promise<void> {
    try {
      // Check throttling
      const shouldThrottle = await this.throttle.shouldThrottle(alert);

      if (shouldThrottle) {
        const timeUntilNext = await this.throttle.getTimeUntilNext(alert);
        console.log(`[Alert Dispatcher] Alert throttled: ${alert.type} for market ${alert.marketId} (next alert in ${timeUntilNext}s)`);
        return;
      }

      // Format alert
      const formattedAlert = await this.formatAlert(alert);

      // Deliver to all enabled channels
      await this.deliverAlert(formattedAlert);

      // Record delivery (set cooldown)
      await this.throttle.recordDelivery(alert);

      console.log(`[Alert Dispatcher] Alert delivered: ${alert.type} for market ${alert.marketId}`);
    } catch (error) {
      console.error(`[Alert Dispatcher] Error processing alert:`, error);
    }
  }

  /**
   * Format alert into human-readable message
   */
  private async formatAlert(alert: AlertEvent): Promise<FormattedAlert> {
    // Fetch market details from database
    const marketInfo = await this.fetchMarketInfo(alert.marketId, alert.outcomeId);

    // Format based on alert type
    const formatted = this.formatByType(alert, marketInfo);

    return formatted;
  }

  /**
   * Fetch market information from database
   */
  private async fetchMarketInfo(marketId: string, outcomeId?: string): Promise<{
    marketName?: string;
    category?: string;
    slug?: string;
    outcomeName?: string;
  }> {
    try {
      const result = await query(
        'SELECT question, category, slug FROM markets WHERE id = $1',
        [marketId]
      );

      if (result.rows.length === 0) {
        return {};
      }

      const market = result.rows[0];
      let outcomeName: string | undefined;

      // If outcomeId provided, fetch outcome name
      if (outcomeId) {
        const outcomeResult = await query(
          'SELECT outcome FROM outcomes WHERE id = $1',
          [outcomeId]
        );
        if (outcomeResult.rows.length > 0) {
          outcomeName = outcomeResult.rows[0].outcome;
        }
      }

      return {
        marketName: market.question,
        category: market.category,
        slug: market.slug,
        outcomeName,
      };
    } catch (error) {
      console.error(`[Alert Dispatcher] Error fetching market info for ${marketId}:`, error);
      return {};
    }
  }

  /**
   * Format alert message based on type
   */
  private formatByType(
    alert: AlertEvent,
    marketInfo: { marketName?: string; category?: string; slug?: string; outcomeName?: string }
  ): FormattedAlert {
    const timestamp = new Date(alert.timestamp).toISOString();
    const polymarketUrl = marketInfo.slug
      ? `https://polymarket.com/event/${marketInfo.slug}`
      : undefined;

    const baseFormatted: FormattedAlert = {
      title: '',
      message: '',
      severity: alert.severity.toUpperCase(),
      marketInfo: {
        marketId: alert.marketId,
        marketName: marketInfo.marketName,
        outcomeName: marketInfo.outcomeName || alert.outcomeName,
        category: marketInfo.category,
        slug: marketInfo.slug,
      },
      metrics: {},
      timestamp,
      polymarketUrl,
      rawAlert: alert,
    };

    switch (alert.type) {
      case 'insider_move':
        const priceChange = alert.data.priceChange || 0;
        const absoluteChange = alert.data.absoluteChange || 0;
        const volumeZScore = alert.data.volumeZScore || 0;
        const insiderOutcomeInfo = marketInfo.outcomeName ? ` | Outcome: ${marketInfo.outcomeName}` : '';
        baseFormatted.title = '🚨 INSIDER MOVE Detected';
        baseFormatted.message = `Price moved ${priceChange.toFixed(2)}% (${(absoluteChange * 100).toFixed(2)}pp) in <1min with ${volumeZScore.toFixed(2)}σ volume spike${insiderOutcomeInfo}`;
        baseFormatted.metrics = {
          priceChange,
          absoluteChange,
          volumeZScore,
        };
        break;

      case 'fat_finger':
        const deviation = alert.data.deviation || 0;
        baseFormatted.title = '⚠️ FAT FINGER Detected';
        baseFormatted.message = `Price deviation of ${deviation.toFixed(2)}% detected, reverted within 2 trades`;
        baseFormatted.metrics = {
          priceChange: deviation,
        };
        break;

      case 'liquidity_vacuum':
        const spread = alert.data.spread || 0;
        const depth = alert.data.depth || 0;
        baseFormatted.title = '💧 LIQUIDITY VACUUM Detected';
        baseFormatted.message = `Spread widened to ${(spread * 100).toFixed(2)} cents (depth: $${depth.toFixed(2)})`;
        baseFormatted.metrics = {
          spread,
          depth,
        };
        break;

      case 'whale_trade':
        const tradeSize = alert.data.tradeSize || 0;
        const outcomeInfo = marketInfo.outcomeName ? ` | Outcome: ${marketInfo.outcomeName}` : '';
        baseFormatted.title = '🐋 WHALE TRADE Detected';
        baseFormatted.message = `Large trade detected: $${tradeSize.toLocaleString()} USDC${outcomeInfo}`;
        baseFormatted.metrics = {
          tradeSize,
        };
        break;

      case 'volume_acceleration':
        const volZScore = alert.data.zScore || 0;
        const currentVolume = alert.data.currentVolume || 0;
        const avgVolume = alert.data.averageVolume || 0;
        const volOutcomeInfo = marketInfo.outcomeName ? ` | Outcome: ${marketInfo.outcomeName}` : '';
        
        // Only show meaningful alerts
        if (volZScore < 0.1 || currentVolume < 100) {
          // Skip formatting for meaningless alerts (shouldn't happen due to validation, but just in case)
          baseFormatted.title = '📈 VOLUME ACCELERATION Detected';
          baseFormatted.message = `Volume activity detected (filtered - not significant)${volOutcomeInfo}`;
        } else {
          baseFormatted.title = '📈 VOLUME ACCELERATION Detected';
          baseFormatted.message = `Volume spike: ${volZScore.toFixed(2)}σ above average | Current: $${currentVolume.toLocaleString()} | Average: $${avgVolume.toLocaleString()}${volOutcomeInfo}`;
        }
        baseFormatted.metrics = {
          volumeZScore: volZScore,
        };
        break;

      default:
        baseFormatted.title = `Alert: ${alert.type}`;
        baseFormatted.message = alert.message;
    }

    // Add market context to message
    if (marketInfo.marketName) {
      baseFormatted.message = `${baseFormatted.message} | Market: ${marketInfo.marketName}`;
      if (marketInfo.outcomeName) {
        baseFormatted.message = `${baseFormatted.message} (${marketInfo.outcomeName})`;
      }
    }

    return baseFormatted;
  }

  /**
   * Deliver alert to all enabled channels
   */
  private async deliverAlert(formattedAlert: FormattedAlert): Promise<void> {
    const deliveryPromises = this.channels.map(async (channel) => {
      try {
        const success = await channel.send(formattedAlert);
        if (!success) {
          console.warn(`[Alert Dispatcher] Channel ${channel.name} failed to deliver alert`);
        }
      } catch (error) {
        console.error(`[Alert Dispatcher] Error delivering to ${channel.name}:`, error);
      }
    });

    await Promise.allSettled(deliveryPromises);
  }

  /**
   * Get dispatcher status
   */
  getStatus(): { running: boolean; enabledChannels: string[] } {
    return {
      running: this.isRunning,
      enabledChannels: this.channels.map(ch => ch.name),
    };
  }
}
