/**
 * Alert Throttling Service
 * 
 * Prevents alert spam by implementing cooldown periods:
 * - Default: 1 alert per market per 10 minutes
 * - Severity-based overrides (critical bypasses throttling)
 * - Per-alert-type cooldowns
 */

import { redis } from '../config/redis';
import { AlertEvent } from './anomaly-detector';

export interface ThrottleConfig {
  defaultCooldownSeconds: number;
  cooldownsByType: Record<string, number>;
  severityOverrides: {
    critical: boolean; // Bypass throttling
    high: number;      // Cooldown in seconds
    medium: number;
    low: number;
  };
}

export class AlertThrottle {
  private config: ThrottleConfig;

  constructor(config?: Partial<ThrottleConfig>) {
    this.config = {
      defaultCooldownSeconds: parseInt(process.env.ALERT_THROTTLE_COOLDOWN || '600', 10), // 10 minutes
      cooldownsByType: {
        insider_move: 600,      // 10 minutes
        fat_finger: 300,        // 5 minutes
        liquidity_vacuum: 300,  // 5 minutes
        whale_trade: 60,        // 1 minute (whales are important)
        volume_acceleration: 600, // 10 minutes
      },
      severityOverrides: {
        critical: process.env.ALERT_CRITICAL_BYPASS_THROTTLE !== 'false', // Default: true
        high: parseInt(process.env.ALERT_HIGH_COOLDOWN || '300', 10),    // 5 minutes
        medium: parseInt(process.env.ALERT_MEDIUM_COOLDOWN || '600', 10), // 10 minutes
        low: parseInt(process.env.ALERT_LOW_COOLDOWN || '600', 10),       // 10 minutes
      },
      ...config,
    };
  }

  /**
   * Check if alert should be throttled
   */
  async shouldThrottle(alert: AlertEvent): Promise<boolean> {
    try {
      // Critical alerts bypass throttling if configured
      if (alert.severity === 'critical' && this.config.severityOverrides.critical) {
        return false;
      }

      // Get cooldown duration for this alert
      const cooldownSeconds = this.getCooldownDuration(alert);

      // Check per-market cooldown
      const marketThrottleKey = `throttle:market:${alert.marketId}`;
      const lastAlertTime = await redis.get(marketThrottleKey);

      if (lastAlertTime) {
        const lastTime = parseInt(lastAlertTime, 10);
        const timeSinceLastAlert = (Date.now() - lastTime) / 1000; // seconds

        if (timeSinceLastAlert < cooldownSeconds) {
          return true; // Still in cooldown period
        }
      }

      // Check per-market+type cooldown (more granular)
      const marketTypeThrottleKey = `throttle:market:${alert.marketId}:${alert.type}`;
      const lastTypeAlertTime = await redis.get(marketTypeThrottleKey);

      if (lastTypeAlertTime) {
        const lastTime = parseInt(lastTypeAlertTime, 10);
        const timeSinceLastAlert = (Date.now() - lastTime) / 1000; // seconds

        if (timeSinceLastAlert < cooldownSeconds) {
          return true; // Still in cooldown period
        }
      }

      return false; // Not throttled
    } catch (error) {
      console.error('Error checking throttle:', error);
      // On error, allow alert (fail open)
      return false;
    }
  }

  /**
   * Record alert delivery (set cooldown)
   */
  async recordDelivery(alert: AlertEvent): Promise<void> {
    try {
      const cooldownSeconds = this.getCooldownDuration(alert);
      const now = Date.now();

      // Set per-market cooldown
      const marketThrottleKey = `throttle:market:${alert.marketId}`;
      await redis.setex(marketThrottleKey, cooldownSeconds, now.toString());

      // Set per-market+type cooldown
      const marketTypeThrottleKey = `throttle:market:${alert.marketId}:${alert.type}`;
      await redis.setex(marketTypeThrottleKey, cooldownSeconds, now.toString());
    } catch (error) {
      console.error('Error recording throttle:', error);
    }
  }

  /**
   * Get time until next alert is allowed (in seconds)
   */
  async getTimeUntilNext(alert: AlertEvent): Promise<number> {
    try {
      const cooldownSeconds = this.getCooldownDuration(alert);
      const marketThrottleKey = `throttle:market:${alert.marketId}`;
      const lastAlertTime = await redis.get(marketThrottleKey);

      if (!lastAlertTime) {
        return 0; // No cooldown
      }

      const lastTime = parseInt(lastAlertTime, 10);
      const timeSinceLastAlert = (Date.now() - lastTime) / 1000; // seconds
      const timeUntilNext = Math.max(0, cooldownSeconds - timeSinceLastAlert);

      return Math.ceil(timeUntilNext);
    } catch (error) {
      console.error('Error getting time until next:', error);
      return 0;
    }
  }

  /**
   * Get cooldown duration for an alert (in seconds)
   */
  private getCooldownDuration(alert: AlertEvent): number {
    // Check severity override first
    const severityCooldown = this.config.severityOverrides[alert.severity];
    if (typeof severityCooldown === 'number') {
      return severityCooldown;
    }

    // Check type-specific cooldown
    if (this.config.cooldownsByType[alert.type]) {
      return this.config.cooldownsByType[alert.type];
    }

    // Default cooldown
    return this.config.defaultCooldownSeconds;
  }

  /**
   * Clear throttle for a market (useful for testing)
   */
  async clearThrottle(marketId: string, alertType?: string): Promise<void> {
    try {
      if (alertType) {
        const marketTypeThrottleKey = `throttle:market:${marketId}:${alertType}`;
        await redis.del(marketTypeThrottleKey);
      } else {
        const marketThrottleKey = `throttle:market:${marketId}`;
        await redis.del(marketThrottleKey);
        
        // Clear all type-specific throttles for this market
        const keys = await redis.keys(`throttle:market:${marketId}:*`);
        if (keys.length > 0) {
          await redis.del(...keys);
        }
      }
    } catch (error) {
      console.error('Error clearing throttle:', error);
    }
  }
}
