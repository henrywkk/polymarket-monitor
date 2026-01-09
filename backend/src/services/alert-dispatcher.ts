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
import axios from 'axios';

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
  private cleanupInterval?: NodeJS.Timeout;
  private readonly POLL_INTERVAL_MS = 2000; // Poll every 2 seconds
  private readonly CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // Cleanup every 5 minutes
  private readonly ALERT_QUEUE_KEY = 'alerts:pending';
  private readonly MAX_ALERT_AGE_MS = 10 * 60 * 1000; // Only process alerts less than 10 minutes old
  private readonly CLEANUP_AGE_MS = 30 * 60 * 1000; // Remove alerts older than 30 minutes during cleanup

  constructor(throttle: AlertThrottle, channels: NotificationChannel[]) {
    this.throttle = throttle;
    this.channels = channels.filter(ch => ch.enabled);
  }

  /**
   * Start processing alerts from queue
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[Alert Dispatcher] Already running');
      return;
    }

    this.isRunning = true;
    console.log('[Alert Dispatcher] Starting alert processing...');

    // Clear old alerts from queue on startup to prevent backlog
    await this.clearOldAlertsOnStartup();

    // Process alerts immediately, then poll periodically
    this.processQueue().catch(err => {
      console.error('[Alert Dispatcher] Error in initial processing:', err);
    });

    this.pollInterval = setInterval(() => {
      this.processQueue().catch(err => {
        console.error('[Alert Dispatcher] Error processing queue:', err);
      });
    }, this.POLL_INTERVAL_MS);

    // Periodically clean up very old alerts from the queue
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldAlerts().catch(err => {
        console.error('[Alert Dispatcher] Error during cleanup:', err);
      });
    }, this.CLEANUP_INTERVAL_MS);
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
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }

    console.log('[Alert Dispatcher] Stopped');
  }

  /**
   * Clear old alerts from queue on startup
   * This prevents processing backlog of stale alerts
   */
  private async clearOldAlertsOnStartup(): Promise<void> {
    try {
      const now = Date.now();
      let clearedCount = 0;
      const maxChecks = 1000; // Check up to 1000 alerts

      console.log('[Alert Dispatcher] Clearing old alerts from queue on startup...');

      // Process from the tail (oldest) and remove old ones
      for (let i = 0; i < maxChecks; i++) {
        // Peek at the last alert in the queue (oldest)
        const alertJson = await redis.lindex(this.ALERT_QUEUE_KEY, -1);
        
        if (!alertJson) {
          break; // Queue is empty
        }

        try {
          const alert: AlertEvent = JSON.parse(alertJson);
          const alertAge = now - alert.timestamp;

          if (alertAge > this.MAX_ALERT_AGE_MS) {
            // Remove this old alert from the tail
            await redis.rpop(this.ALERT_QUEUE_KEY);
            clearedCount++;
          } else {
            // Found a recent alert, stop clearing (we check from tail, but process from head)
            break;
          }
        } catch (error) {
          // Invalid JSON, remove it
          await redis.rpop(this.ALERT_QUEUE_KEY);
          clearedCount++;
        }
      }

      if (clearedCount > 0) {
        console.log(`[Alert Dispatcher] Cleared ${clearedCount} old alerts from queue on startup`);
      } else {
        console.log('[Alert Dispatcher] No old alerts to clear');
      }
    } catch (error) {
      console.error('[Alert Dispatcher] Error clearing old alerts on startup:', error);
    }
  }

  /**
   * Process alerts from Redis queue
   * Processes from the head (newest first) to prioritize recent alerts
   */
  private async processQueue(): Promise<void> {
    try {
      // Pop alert from queue (left pop - processes newest first)
      // This ensures new alerts are processed immediately, not blocked by old alerts
      const alertJson = await redis.lpop(this.ALERT_QUEUE_KEY);

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

      // Skip old alerts - only process alerts that are recent
      const alertAge = Date.now() - alert.timestamp;
      if (alertAge > this.MAX_ALERT_AGE_MS) {
        console.log(`[Alert Dispatcher] Skipping old alert: ${alert.type} for market ${alert.marketId} (age: ${Math.round(alertAge / 1000 / 60)} minutes)`);
        return; // Skip this alert, it's too old
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

      // Try to get the correct event slug from Polymarket API
      // The stored slug might be outcome-specific, but we need the parent event slug
      // Also try to find parent event by matching question pattern
      const correctSlug = await this.fetchCorrectEventSlug(marketId, market.slug, market.question);

      return {
        marketName: market.question,
        category: market.category,
        slug: correctSlug || market.slug,
        outcomeName,
      };
    } catch (error) {
      console.error(`[Alert Dispatcher] Error fetching market info for ${marketId}:`, error);
      return {};
    }
  }

  /**
   * Fetch the correct event slug from Polymarket API
   * The stored slug might be outcome-specific, but we need the parent event slug
   * Uses caching to avoid excessive API calls
   * 
   * Strategy:
   * 1. Try to fetch market data (might be condition_id)
   * 2. Extract question_id or event_id from market data
   * 3. Fetch event data using question_id to get correct slug
   * 4. If API fails, try to find parent event in database by question pattern
   */
  private async fetchCorrectEventSlug(marketId: string, storedSlug?: string, question?: string): Promise<string | undefined> {
    try {
      // Check cache first (24 hour TTL)
      const cacheKey = `event_slug:${marketId}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        return cached;
      }

      // Step 1: Try to fetch market data first (might be condition_id)
      // This will give us the question_id or event_id
      // Prioritize CLOB API as it reliably returns question_id field
      const marketEndpoints = [
        `https://clob.polymarket.com/markets/${marketId}`, // CLOB API is most reliable for question_id
        `https://gamma-api.polymarket.com/markets/${marketId}`,
        `https://api.polymarket.com/v2/markets/${marketId}`,
      ];

      let questionId: string | undefined;
      let eventId: string | undefined;
      let eventSlug: string | undefined;

      // Try to get market data and extract question_id/event_id
      for (const endpoint of marketEndpoints) {
        try {
          const response = await axios.get(endpoint, {
            timeout: 3000,
            headers: { 'Accept': 'application/json' },
          });

          const data = response.data;
          
          // Extract question_id or event_id from market data
          // Check multiple possible field names and nested structures
          questionId = data.question_id || 
                      data.questionId || 
                      data.event?.question_id || 
                      data.event?.questionId ||
                      data.parent?.question_id ||
                      data.parentEvent?.question_id;
          
          eventId = data.event_id || 
                   data.eventId || 
                   data.event?.id ||
                   data.parent?.id ||
                   data.parentEvent?.id;
          
          // Sometimes the slug is directly in the market data or event object
          eventSlug = data.event?.slug || 
                     data.event?.market_slug ||
                     data.parent?.slug ||
                     data.parentEvent?.slug ||
                     data.slug || 
                     data.eventSlug ||
                     data.market_slug;

          // If we found question_id/event_id or slug, log for debugging
          if (questionId || eventId || eventSlug) {
            if (questionId && questionId !== marketId) {
              console.log(`[Alert Dispatcher] Found question_id ${questionId} for market ${marketId} (different from market ID)`);
            }
            if (eventId && eventId !== marketId) {
              console.log(`[Alert Dispatcher] Found event_id ${eventId} for market ${marketId} (different from market ID)`);
            }
            if (eventSlug && eventSlug !== storedSlug) {
              console.log(`[Alert Dispatcher] Found event slug ${eventSlug} directly in market data`);
            }
            break; // Found what we need
          }
        } catch (error) {
          continue; // Try next endpoint
        }
      }

      // Step 2: If we found question_id but no slug, query database for parent event
      // The question_id is the parent event identifier shared by all child markets
      // Query our database to find the parent market (which has the same question_id but different slug pattern)
      if (questionId && !eventSlug) {
        try {
          // Query database for markets with the same question_id
          // Parent events typically don't have "will-" or "-win-" in their slug
          const parentResult = await query(
            `SELECT id, slug, question FROM markets 
             WHERE question_id = $1 
               AND slug NOT LIKE 'will-%'
               AND slug NOT LIKE '%-win-%'
             ORDER BY created_at ASC 
             LIMIT 1`,
            [questionId]
          );
          
          if (parentResult.rows.length > 0) {
            const foundSlug = parentResult.rows[0].slug;
            if (foundSlug && typeof foundSlug === 'string') {
              eventSlug = foundSlug;
              console.log(`[Alert Dispatcher] Found parent event slug via question_id: ${eventSlug} for market ${marketId}`);
              await redis.setex(cacheKey, 86400, foundSlug);
              return foundSlug;
            }
          } else {
            // If no parent found, the current market might be the parent
            // Check if current market's question_id matches its own ID (meaning it's a parent)
            // Or try to find any market with this question_id (might be another child)
            const anyMarketResult = await query(
              `SELECT slug FROM markets 
               WHERE question_id = $1 
               ORDER BY 
                 CASE WHEN slug NOT LIKE 'will-%' AND slug NOT LIKE '%-win-%' THEN 0 ELSE 1 END,
                 created_at ASC 
               LIMIT 1`,
              [questionId]
            );
            
            if (anyMarketResult.rows.length > 0) {
              const foundSlug = anyMarketResult.rows[0].slug;
              // Only use if it's not the same as stored slug (which is likely outcome-specific)
              if (foundSlug && typeof foundSlug === 'string' && foundSlug !== storedSlug) {
                eventSlug = foundSlug;
                console.log(`[Alert Dispatcher] Found market slug via question_id: ${eventSlug} for market ${marketId}`);
                await redis.setex(cacheKey, 86400, foundSlug);
                return foundSlug;
              }
            }
          }
          
          console.log(`[Alert Dispatcher] Found question_id ${questionId} but no parent event in database. Will try pattern matching.`);
        } catch (error) {
          console.error(`[Alert Dispatcher] Error querying database for question_id ${questionId}:`, error);
          // Continue to pattern matching fallback
        }
      }

      // Step 2b: If we found event_id but no slug, try to fetch the event directly
      if (eventId && !eventSlug) {
        const eventEndpoints = [
          `https://gamma-api.polymarket.com/events/${eventId}`,
          `https://api.polymarket.com/v2/events/${eventId}`,
        ];

        for (const endpoint of eventEndpoints) {
          try {
            const response = await axios.get(endpoint, {
              timeout: 3000,
              headers: { 'Accept': 'application/json' },
            });

            const data = response.data;
            eventSlug = data.event?.slug || 
                       data.slug || 
                       data.eventSlug ||
                       data.market_slug ||
                       (data.event && (data.event.market_slug || data.event.slug));

            if (eventSlug) {
              console.log(`[Alert Dispatcher] Found event slug via event_id: ${eventSlug}`);
              break;
            }
          } catch (error) {
            continue;
          }
        }
      }

      // Step 3: Cache and return result
      if (eventSlug) {
        await redis.setex(cacheKey, 86400, eventSlug);
        
        // Only log if it's different from stored slug
        if (eventSlug !== storedSlug) {
          console.log(`[Alert Dispatcher] Found correct event slug for ${marketId}: ${eventSlug} (was: ${storedSlug || 'none'})`);
        }
        
        return eventSlug;
      }

      // Step 4: If API failed, try to find parent event in database by question pattern
      // Multiple patterns supported:
      // 1. Awards: "Will [Outcome] win [Category] at the [Award]?" -> "[Award]: [Category] Winner"
      // 2. IPO Market Cap: "Will [Company]'s market cap be [range] at market close on IPO day?" -> "[Company] IPO Closing Market Cap"
      if (!eventSlug && question) {
        try {
          // Pattern 1: Awards (e.g., "Will Severance win Best Television Series – Drama at the 83rd Golden Globes?")
          const awardMatch = question.match(/win\s+(.+?)\s+at\s+the\s+(\d+[a-z]{2})?\s*(.+?)(?:\?|$)/i);
          if (awardMatch) {
            const category = awardMatch[1]?.trim();
            const awardName = awardMatch[3]?.trim();
            
            if (category && awardName) {
              const parentPattern = `${awardName}: ${category} Winner`;
              
              const parentResult = await query(
                `SELECT id, slug FROM markets 
                 WHERE question ILIKE $1 
                   AND slug NOT LIKE 'will-%'
                   AND slug NOT LIKE '%-win-%'
                 ORDER BY created_at DESC 
                 LIMIT 1`,
                [`%${parentPattern}%`]
              );
              
              if (parentResult.rows.length > 0) {
                const foundSlug = parentResult.rows[0].slug;
                if (foundSlug) {
                  console.log(`[Alert Dispatcher] Found parent event slug via database (award pattern): ${foundSlug} for market ${marketId}`);
                  await redis.setex(cacheKey, 86400, foundSlug);
                  return foundSlug;
                }
              }
            }
          }

          // Pattern 2: IPO Market Cap (e.g., "Will Anthropic's market cap be between 200B and 300B at market close on IPO day?")
          // Extract company name and construct parent pattern: "[Company] IPO Closing Market Cap"
          // Also handles: "Will [Company]'s market cap be [condition] at market close on IPO day?"
          const ipoMatch = question.match(/will\s+([^']+?)'s\s+market\s+cap\s+be\s+(?:between|less\s+than|greater\s+than|exactly|over|under)\s+.+?\s+at\s+market\s+close\s+on\s+ipo\s+day/i);
          if (ipoMatch) {
            const companyName = ipoMatch[1]?.trim();
            
            if (companyName) {
              // Try multiple parent patterns:
              // 1. "[Company] IPO Closing Market Cap" (most common)
              // 2. "[Company] IPO Market Cap" (alternative)
              const parentPatterns = [
                `${companyName} IPO Closing Market Cap`,
                `${companyName} IPO Market Cap`,
              ];
              
              for (const parentPattern of parentPatterns) {
                const parentResult = await query(
                  `SELECT id, slug FROM markets 
                   WHERE question ILIKE $1 
                     AND slug NOT LIKE 'will-%'
                   ORDER BY created_at DESC 
                   LIMIT 1`,
                  [`%${parentPattern}%`]
                );
                
                if (parentResult.rows.length > 0) {
                  const foundSlug = parentResult.rows[0].slug;
                  if (foundSlug) {
                    console.log(`[Alert Dispatcher] Found parent event slug via database (IPO pattern): ${foundSlug} for market ${marketId}`);
                    await redis.setex(cacheKey, 86400, foundSlug);
                    return foundSlug;
                  }
                }
              }
            }
          }
        } catch (error) {
          // Silently continue if database query fails
        }
      }

      // If we couldn't fetch a better slug, use the stored one and cache it
      if (eventSlug) {
        await redis.setex(cacheKey, 86400, eventSlug);
        return eventSlug;
      }

      if (storedSlug) {
        await redis.setex(cacheKey, 86400, storedSlug);
      }

      return storedSlug;
    } catch (error) {
      // If API fetch fails, fall back to stored slug silently
      return storedSlug;
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

      case 'new_market':
        const marketTitle = alert.data.marketTitle || 'Untitled Market';
        const marketCategory = alert.data.category || 'Uncategorized';
        const matchesKeywords = alert.data.matchesKeywords || false;
        baseFormatted.title = matchesKeywords ? '🆕 NEW MARKET (High Interest)' : '🆕 NEW MARKET';
        baseFormatted.message = `${marketTitle} | Category: ${marketCategory}`;
        baseFormatted.severity = matchesKeywords ? 'high' : 'medium';
        break;

      case 'new_outcome':
        const newOutcome = alert.data.newOutcome || 'New Outcome';
        const outcomeMarketTitle = alert.data.marketTitle || 'Market';
        const outcomeCategory = alert.data.category || 'Uncategorized';
        const outcomeMatchesKeywords = alert.data.matchesKeywords || false;
        baseFormatted.title = outcomeMatchesKeywords ? '➕ NEW OUTCOME (High Interest)' : '➕ NEW OUTCOME';
        baseFormatted.message = `${newOutcome} added to ${outcomeMarketTitle} | Category: ${outcomeCategory}`;
        baseFormatted.severity = outcomeMatchesKeywords ? 'high' : 'medium';
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
   * Clean up very old alerts from the queue
   * This prevents the queue from growing indefinitely with stale alerts
   */
  private async cleanupOldAlerts(): Promise<void> {
    try {
      const now = Date.now();
      let removedCount = 0;
      const maxChecks = 100; // Limit checks to prevent blocking

      // Check alerts from the end of the queue (oldest first)
      // We'll peek at alerts and remove old ones
      for (let i = 0; i < maxChecks; i++) {
        // Peek at the last alert in the queue (oldest)
        const alertJson = await redis.lindex(this.ALERT_QUEUE_KEY, -1);
        
        if (!alertJson) {
          break; // Queue is empty
        }

        try {
          const alert: AlertEvent = JSON.parse(alertJson);
          const alertAge = now - alert.timestamp;

          if (alertAge > this.CLEANUP_AGE_MS) {
            // Remove this old alert from the end of the queue
            await redis.rpop(this.ALERT_QUEUE_KEY);
            removedCount++;
          } else {
            // Found a recent alert, stop cleanup (we check from tail, but process from head)
            break;
          }
        } catch (error) {
          // Invalid JSON, remove it
          await redis.rpop(this.ALERT_QUEUE_KEY);
          removedCount++;
        }
      }

      if (removedCount > 0) {
        console.log(`[Alert Dispatcher] Cleaned up ${removedCount} old alerts from queue`);
      }
    } catch (error) {
      console.error('[Alert Dispatcher] Error during cleanup:', error);
    }
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
