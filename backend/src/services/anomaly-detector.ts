/**
 * Anomaly Detection Service
 * 
 * Detects various types of anomalies in market data:
 * - Insider Move: Price >15% in <1min + volume acceleration (3σ)
 * - Fat Finger: Price deviation >30% + reversion within 2 trades
 * - Liquidity Vacuum: Spread >10 cents OR depth drop >80% in <1min
 * - Whale Trade: Single trade >$10k USDC
 */

import { redis } from '../config/redis';
import { RedisSlidingWindow } from './redis-storage';
import {
  calculateMean,
  calculateStandardDeviation,
  calculateZScore,
  calculatePercentageChange,
} from '../utils/statistics';

export interface AlertEvent {
  type: 'insider_move' | 'fat_finger' | 'liquidity_vacuum' | 'whale_trade' | 'volume_acceleration';
  marketId: string;
  outcomeId?: string;
  tokenId?: string;
  outcomeName?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  data: Record<string, any>;
  timestamp: number;
}

export class AnomalyDetector {
  private readonly PRICE_VELOCITY_THRESHOLD = 0.15; // 15 percentage points (absolute change) in 1 minute
  private readonly FAT_FINGER_THRESHOLD = 30; // 30% price deviation
  private readonly LIQUIDITY_VACUUM_SPREAD_THRESHOLD = 0.10; // 10 cents
  private readonly DEPTH_DROP_THRESHOLD = 0.80; // 80% depth drop
  private readonly WHALE_TRADE_THRESHOLD = 10000; // $10k USDC
  private readonly VOLUME_ACCELERATION_SIGMA = 3; // 3σ for volume acceleration

  /**
   * Calculate Z-score for a value using historical data from Redis
   */
  async calculateZScoreForValue(
    key: string,
    currentValue: number,
    windowMs: number = 3600000 // 60 minutes default
  ): Promise<{ zScore: number | null; mean: number; stdDev: number }> {
    try {
      // Get historical data from Redis sliding window
      const historicalData = await RedisSlidingWindow.getRange(
        key,
        Date.now() - windowMs,
        Date.now()
      );

      if (historicalData.length < 10) {
        // Need at least 10 data points for meaningful statistics
        return { zScore: null, mean: 0, stdDev: 0 };
      }

      // Extract values from historical data
      const values = historicalData.map((item: any) => {
        // Handle different data structures
        if (typeof item === 'number') return item;
        if (typeof item === 'object' && item.value !== undefined) return item.value;
        if (typeof item === 'object' && item.size !== undefined) return item.size;
        if (typeof item === 'object' && item.volume !== undefined) return item.volume;
        return 0;
      });

      const mean = calculateMean(values);
      const stdDev = calculateStandardDeviation(values);
      const zScore = calculateZScore(currentValue, mean, stdDev);

      return { zScore, mean, stdDev };
    } catch (error) {
      console.error(`Error calculating Z-score for ${key}:`, error);
      return { zScore: null, mean: 0, stdDev: 0 };
    }
  }

  /**
   * Detect price velocity anomaly (price moves >15% in <1min)
   */
  async detectPriceVelocity(
    marketId: string,
    outcomeId: string,
    tokenId: string,
    currentPrice: number
  ): Promise<AlertEvent | null> {
    try {
      const lastPriceKey = `last_price:${marketId}:${outcomeId}`;
      const lastPriceData = await redis.get(lastPriceKey);

      if (!lastPriceData) {
        // Store current price for next check
        await redis.setex(lastPriceKey, 120, JSON.stringify({
          price: currentPrice,
          timestamp: Date.now(),
        }));
        return null;
      }

      const { price: lastPrice, timestamp: lastTimestamp } = JSON.parse(lastPriceData);
      const timeDiff = Date.now() - lastTimestamp;

      // Only check if price update was within last 1 minute
      if (timeDiff > 60000) {
        // Update stored price
        await redis.setex(lastPriceKey, 120, JSON.stringify({
          price: currentPrice,
          timestamp: Date.now(),
        }));
        return null;
      }

      // Skip velocity check if prices are invalid
      if (!isFinite(lastPrice) || !isFinite(currentPrice) || lastPrice < 0 || currentPrice < 0 || lastPrice > 1 || currentPrice > 1) {
        // Update stored price but don't check velocity
        await redis.setex(lastPriceKey, 120, JSON.stringify({
          price: currentPrice,
          timestamp: Date.now(),
        }));
        return null;
      }

      // For prices in 0-1 range (orderbook prices), use absolute change instead of percentage
      // Percentage change is misleading for small prices (e.g., 0.001 -> 0.002 = 100% but only 0.001 absolute change)
      // Use absolute change threshold: 0.15 (15 percentage points) for prices in 0-1 range
      const absoluteChange = Math.abs(currentPrice - lastPrice);
      
      // Also calculate percentage change for logging/debugging
      const percentageChange = calculatePercentageChange(lastPrice, currentPrice);

      if (absoluteChange > this.PRICE_VELOCITY_THRESHOLD) {
        // Price moved >15% in <1min - potential insider move
        // But we need to also check volume acceleration (done in detectInsiderMove)
        return {
          type: 'insider_move',
          marketId,
          outcomeId,
          tokenId,
          severity: 'high',
          message: `Price moved ${(absoluteChange * 100).toFixed(2)}pp (${percentageChange.toFixed(2)}%) in ${(timeDiff / 1000).toFixed(1)}s`,
          data: {
            lastPrice,
            currentPrice,
            absoluteChange,
            percentageChange,
            timeDiff,
          },
          timestamp: Date.now(),
        };
      }

      // Update stored price
      await redis.setex(lastPriceKey, 120, JSON.stringify({
        price: currentPrice,
        timestamp: Date.now(),
      }));

      return null;
    } catch (error) {
      console.error(`Error detecting price velocity for ${marketId}:${outcomeId}:`, error);
      return null;
    }
  }

  /**
   * Detect volume acceleration (volume >3σ above hourly average)
   * 
   * IMPORTANT: We need to compare 1-minute volume aggregates, not individual trade sizes.
   * The currentVolume parameter should be the sum of trades in the last 1 minute.
   */
  async detectVolumeAcceleration(
    marketId: string,
    outcomeId: string,
    tokenId: string,
    currentVolume: number
  ): Promise<AlertEvent | null> {
    try {
      // Skip if volume is too small (< $100) to avoid false positives
      if (currentVolume < 100) {
        return null;
      }

      // Get all trades from last 60 minutes
      const tradesKey = `trades:${tokenId}`;
      const allTrades = await RedisSlidingWindow.getRange(
        tradesKey,
        Date.now() - 3600000, // Last 60 minutes
        Date.now()
      );

      if (allTrades.length < 10) {
        // Need at least 10 trades for meaningful statistics
        return null;
      }

      // Aggregate trades into 1-minute windows
      const oneMinuteWindows: Map<number, number> = new Map();
      
      for (const trade of allTrades) {
        const tradeTimestamp = trade.timestamp || 0;
        // Use sizeInUSDC if available (from newer trades), fallback to size for backward compatibility
        const tradeSize = trade.sizeInUSDC !== undefined ? trade.sizeInUSDC : (trade.size || 0);
        
        // Round timestamp to nearest minute
        const windowKey = Math.floor(tradeTimestamp / 60000) * 60000;
        const currentWindowVolume = oneMinuteWindows.get(windowKey) || 0;
        oneMinuteWindows.set(windowKey, currentWindowVolume + tradeSize);
      }

      // Get 1-minute volume values (excluding current minute to avoid double-counting)
      const windowVolumes = Array.from(oneMinuteWindows.values());
      const historicalVolumes = windowVolumes.slice(0, -1); // Exclude last window (current)

      if (historicalVolumes.length < 5) {
        // Need at least 5 historical 1-minute windows
        return null;
      }

      // Calculate Z-score for current 1-minute volume against historical 1-minute volumes
      const mean = calculateMean(historicalVolumes);
      const stdDev = calculateStandardDeviation(historicalVolumes);
      const zScore = calculateZScore(currentVolume, mean, stdDev);

      if (zScore === null) {
        return null;
      }

      // Additional validation: Skip if Z-score is unreasonably high (>50σ)
      // This catches cases where initial data was incorrect or there's a data error
      if (zScore > 50) {
        console.warn(`[Volume Acceleration] Skipping unreasonably high Z-score: ${zScore.toFixed(2)}σ (currentVolume: ${currentVolume}, mean: ${mean}, stdDev: ${stdDev})`);
        return null;
      }

      // Check if volume is >3σ above average
      // Also ensure zScore is meaningful (not 0 or negative, and currentVolume is significant)
      if (zScore > this.VOLUME_ACCELERATION_SIGMA && zScore > 0.1 && currentVolume > 100) {
        return {
          type: 'volume_acceleration',
          marketId,
          outcomeId,
          tokenId,
          severity: 'medium',
          message: `Volume spike detected: $${currentVolume.toLocaleString()} (${zScore.toFixed(2)}σ above average)`,
          data: {
            currentVolume,
            averageVolume: mean,
            standardDeviation: stdDev,
            zScore,
          },
          timestamp: Date.now(),
        };
      }

      return null;
    } catch (error) {
      console.error(`Error detecting volume acceleration for ${marketId}:${outcomeId}:`, error);
      return null;
    }
  }

  /**
   * Detect insider move: Price >15% in <1min + volume acceleration (3σ)
   */
  async detectInsiderMove(
    marketId: string,
    outcomeId: string,
    tokenId: string,
    currentPrice: number,
    currentVolume: number
  ): Promise<AlertEvent | null> {
    // Check price velocity first
    const priceVelocityAlert = await this.detectPriceVelocity(marketId, outcomeId, tokenId, currentPrice);
    
    if (!priceVelocityAlert) {
      return null; // No price velocity anomaly
    }

    // Check volume acceleration
    const volumeAccelerationAlert = await this.detectVolumeAcceleration(marketId, outcomeId, tokenId, currentVolume);

    if (!volumeAccelerationAlert) {
      return null; // No volume acceleration
    }

    // Both conditions met - insider move detected
    return {
      type: 'insider_move',
      marketId,
      outcomeId,
      tokenId,
      severity: 'critical',
      message: `INSIDER MOVE: Price ${(priceVelocityAlert.data.absoluteChange * 100).toFixed(2)}pp (${priceVelocityAlert.data.percentageChange.toFixed(2)}%) + Volume ${volumeAccelerationAlert.data.zScore.toFixed(2)}σ spike`,
      data: {
        absoluteChange: priceVelocityAlert.data.absoluteChange,
        priceChange: priceVelocityAlert.data.percentageChange,
        volumeZScore: volumeAccelerationAlert.data.zScore,
        currentPrice,
        currentVolume,
      },
      timestamp: Date.now(),
    };
  }

  /**
   * Detect fat finger: Price deviation >30% + reversion within 2 trades
   */
  async detectFatFinger(
    marketId: string,
    outcomeId: string,
    tokenId: string,
    tradePrice: number
  ): Promise<AlertEvent | null> {
    try {
      const fatFingerKey = `fat_finger:${marketId}:${outcomeId}`;
      const lastTradesData = await redis.get(fatFingerKey);

      let lastTrades: Array<{ price: number; timestamp: number }> = [];
      if (lastTradesData) {
        lastTrades = JSON.parse(lastTradesData);
      }

      // Keep only last 3 trades
      if (lastTrades.length >= 3) {
        lastTrades = lastTrades.slice(-2); // Keep last 2, we'll add current as 3rd
      }

      // Add current trade
      lastTrades.push({
        price: tradePrice,
        timestamp: Date.now(),
      });

      // Need at least 2 trades to detect deviation
      if (lastTrades.length < 2) {
        await redis.setex(fatFingerKey, 300, JSON.stringify(lastTrades));
        return null;
      }

      const previousPrice = lastTrades[lastTrades.length - 2].price;
      const percentageChange = calculatePercentageChange(previousPrice, tradePrice);

      // Check if deviation >30%
      if (Math.abs(percentageChange) > this.FAT_FINGER_THRESHOLD) {
        // Potential fat finger - check if it reverts within next 2 trades
        // We'll mark it as "pending verification" and check on next trade
        if (lastTrades.length === 2) {
          // First trade with large deviation - wait for reversion
          await redis.setex(fatFingerKey, 300, JSON.stringify(lastTrades));
          return null;
        }

        // Check if price reverted (3rd trade)
        const revertedPrice = lastTrades[lastTrades.length - 1].price;
        const reversionChange = calculatePercentageChange(tradePrice, revertedPrice);

        // If price reverted significantly (>20% back), it's a fat finger
        if (Math.abs(reversionChange) > 20 && Math.abs(reversionChange) < Math.abs(percentageChange)) {
          return {
            type: 'fat_finger',
            marketId,
            outcomeId,
            tokenId,
            severity: 'medium',
            message: `FAT FINGER: Price deviated ${percentageChange.toFixed(2)}% then reverted ${reversionChange.toFixed(2)}%`,
            data: {
              originalPrice: previousPrice,
              deviatedPrice: tradePrice,
              revertedPrice,
              percentageChange,
              reversionChange,
            },
            timestamp: Date.now(),
          };
        }
      }

      // Store trades for next check
      await redis.setex(fatFingerKey, 300, JSON.stringify(lastTrades));
      return null;
    } catch (error) {
      console.error(`Error detecting fat finger for ${marketId}:${outcomeId}:`, error);
      return null;
    }
  }

  /**
   * Detect liquidity vacuum: Spread >10 cents OR depth drop >80% in <1min
   */
  async detectLiquidityVacuum(
    marketId: string,
    outcomeId: string,
    tokenId: string,
    spread: number,
    depth: number
  ): Promise<AlertEvent | null> {
    try {
      // Check spread threshold
      if (spread > this.LIQUIDITY_VACUUM_SPREAD_THRESHOLD) {
        return {
          type: 'liquidity_vacuum',
          marketId,
          outcomeId,
          tokenId,
          severity: 'high',
          message: `Liquidity Vacuum: Spread widened to ${(spread * 100).toFixed(2)}¢`,
          data: {
            spread,
            depth,
            threshold: this.LIQUIDITY_VACUUM_SPREAD_THRESHOLD,
          },
          timestamp: Date.now(),
        };
      }

      // Check depth drop
      const depthKey = `depth:${marketId}:${outcomeId}`;
      const lastDepthData = await redis.get(depthKey);

      if (lastDepthData) {
        const { depth: lastDepth, timestamp: lastTimestamp } = JSON.parse(lastDepthData);
        const timeDiff = Date.now() - lastTimestamp;

        // Only check if depth update was within last 1 minute
        if (timeDiff < 60000 && lastDepth > 0) {
          const depthDrop = (lastDepth - depth) / lastDepth;

          if (depthDrop > this.DEPTH_DROP_THRESHOLD) {
            return {
              type: 'liquidity_vacuum',
              marketId,
              outcomeId,
              tokenId,
              severity: 'high',
              message: `Liquidity Vacuum: Depth dropped ${(depthDrop * 100).toFixed(2)}% in ${(timeDiff / 1000).toFixed(1)}s`,
              data: {
                lastDepth,
                currentDepth: depth,
                depthDrop,
                timeDiff,
              },
              timestamp: Date.now(),
            };
          }
        }
      }

      // Store current depth for next check
      await redis.setex(depthKey, 120, JSON.stringify({
        depth,
        timestamp: Date.now(),
      }));

      return null;
    } catch (error) {
      console.error(`Error detecting liquidity vacuum for ${marketId}:${outcomeId}:`, error);
      return null;
    }
  }

  /**
   * Detect whale trade: Single trade >$10k USDC
   */
  detectWhaleTrade(
    marketId: string,
    outcomeId: string,
    tokenId: string,
    tradeSize: number
  ): AlertEvent | null {
    if (tradeSize >= this.WHALE_TRADE_THRESHOLD) {
      return {
        type: 'whale_trade',
        marketId,
        outcomeId,
        tokenId,
        severity: 'medium',
        message: `WHALE TRADE: $${tradeSize.toFixed(2)} USDC`,
        data: {
          tradeSize,
          threshold: this.WHALE_TRADE_THRESHOLD,
        },
        timestamp: Date.now(),
      };
    }

    return null;
  }

  /**
   * Store alert event in Redis for Phase 3 (Alert Dispatcher)
   */
  async storeAlert(alert: AlertEvent): Promise<void> {
    try {
      const alertKey = `alerts:pending`;
      await redis.lpush(alertKey, JSON.stringify(alert));
      await redis.expire(alertKey, 3600); // Expire after 1 hour if not processed
      
      // Also store by market for quick lookup
      const marketAlertKey = `alerts:market:${alert.marketId}`;
      await redis.lpush(marketAlertKey, JSON.stringify(alert));
      await redis.expire(marketAlertKey, 3600);
      
      console.log(`[Alert Generated] ${alert.type.toUpperCase()}: ${alert.message} (Market: ${alert.marketId})`);
    } catch (error) {
      console.error('Error storing alert:', error);
    }
  }
}
