# Phase 2: Anomaly Detection Engine Implementation Plan

**Goal:** Detect the 5 alert types using statistical analysis and pattern recognition

**Timeline:** Week 3-4 (estimated 8 days)

---

## Overview

Phase 2 builds the intelligence layer that analyzes the data collected in Phase 1 to detect anomalies and generate alerts. This phase focuses on statistical analysis, pattern recognition, and real-time anomaly detection.

---

## Tasks Breakdown

### Task 1: Z-Score Calculator (2 days)
**Purpose:** Calculate statistical anomalies using Z-scores

**Requirements:**
- Calculate moving average (μ) and standard deviation (σ) from sliding window data
- Compute Z-score: `Z = (CurrentValue - μ) / σ`
- Flag anomalies when `|Z| > 3.5`
- Support multiple metrics: volume, price, depth

**Implementation:**
- Create `services/anomaly-detector.ts` with `ZScoreCalculator` class
- Use Redis sliding window data for historical values
- Calculate μ and σ from last 60 minutes of data
- Cache calculations to avoid redundant computations

**Files to Create/Modify:**
- `backend/src/services/anomaly-detector.ts` (new)
- `backend/src/utils/statistics.ts` (new - helper functions)

---

### Task 2: Price Velocity Tracker (1 day)
**Purpose:** Detect rapid price movements (>15% in <1min)

**Requirements:**
- Track price changes over 1-minute windows
- Calculate percentage change: `(newPrice - oldPrice) / oldPrice * 100`
- Flag when price moves >15% in <1min
- Store price history in Redis (1-minute granularity)

**Implementation:**
- Add price velocity tracking to `anomaly-detector.ts`
- Use Redis to store last price per outcome
- Compare current price with price from 1 minute ago
- Generate alert if threshold exceeded

**Files to Create/Modify:**
- `backend/src/services/anomaly-detector.ts` (extend)
- `backend/src/services/market-ingestion.ts` (add price velocity tracking)

---

### Task 3: Volume Acceleration Detector (2 days)
**Purpose:** Detect volume spikes (3σ above hourly average)

**Requirements:**
- Calculate hourly volume average from trade history
- Compute 3σ threshold
- Flag when volume in 1 minute >3σ above hourly average
- Use Z-score calculator for statistical validation

**Implementation:**
- Use trade history from Redis sliding windows
- Calculate hourly average volume (last 60 minutes)
- Calculate standard deviation
- Compare current 1-minute volume against threshold
- Generate alert if exceeded

**Files to Create/Modify:**
- `backend/src/services/anomaly-detector.ts` (extend)
- `backend/src/services/market-ingestion.ts` (add volume tracking)

---

### Task 4: Fat Finger Detector (1 day)
**Purpose:** Detect erroneous trades (30% deviation + reversion)

**Requirements:**
- Compare current trade price vs last trade price
- Flag when deviation >30%
- Verify reversion within 2 trades
- Only alert if price returns to normal range

**Implementation:**
- Track last 3 trades per outcome
- Compare trade prices
- Detect large deviation (>30%)
- Monitor next 2 trades for reversion
- Generate alert if reversion confirmed

**Files to Create/Modify:**
- `backend/src/services/anomaly-detector.ts` (extend)
- `backend/src/services/market-ingestion.ts` (add trade tracking)

---

### Task 5: Liquidity Monitor (1 day)
**Purpose:** Detect liquidity vacuums (spread >10 cents, depth drops)

**Requirements:**
- Monitor spread widening (already partially implemented)
- Flag when spread >10 cents
- Track depth drops (80% in <1min)
- Use orderbook metrics from Phase 1

**Implementation:**
- Enhance existing liquidity vacuum detection
- Track depth history in Redis
- Compare current depth with depth from 1 minute ago
- Generate alert if depth drops >80%

**Files to Create/Modify:**
- `backend/src/services/anomaly-detector.ts` (extend)
- `backend/src/services/market-ingestion.ts` (enhance existing detection)

---

### Task 6: Whale Detector (1 day)
**Purpose:** Detect large trades (>$10k USDC)

**Requirements:**
- Check trade size >$10k USDC
- Format whale alert with trade details
- Already partially implemented, need to integrate with alert system

**Implementation:**
- Enhance existing whale trade detection
- Format alert message
- Integrate with alert dispatcher (Phase 3)

**Files to Create/Modify:**
- `backend/src/services/anomaly-detector.ts` (extend)
- `backend/src/services/market-ingestion.ts` (enhance existing detection)

---

## Alert Types Summary

### A. Insider Move Alert
- **Trigger:** Price >15% in <1min + volume acceleration (3σ)
- **Components:** Price Velocity Tracker + Volume Acceleration Detector
- **Priority:** High

### B. Fat Finger/Flash Crash
- **Trigger:** Price deviation >30% + reversion within 2 trades
- **Components:** Fat Finger Detector
- **Priority:** Medium

### C. Liquidity Vacuum
- **Trigger:** Spread >10 cents OR depth drop >80% in <1min
- **Components:** Liquidity Monitor
- **Priority:** High

### D. New Narrative Alert
- **Trigger:** New market detection (deferred to Phase 4)
- **Components:** Market Sync Service
- **Priority:** Medium

### E. Whale Watch
- **Trigger:** Single trade >$10k USDC
- **Components:** Whale Detector
- **Priority:** Medium

---

## Technical Architecture

### Service Structure

```
services/
  anomaly-detector.ts
    - ZScoreCalculator
    - PriceVelocityTracker
    - VolumeAccelerationDetector
    - FatFingerDetector
    - LiquidityMonitor
    - WhaleDetector
    - detectAnomalies() // Main entry point
```

### Data Flow

```
WebSocket Events
  ↓
MarketIngestionService
  ↓
AnomalyDetector (analyzes data)
  ↓
Alert Events (generated, stored in Redis)
  ↓
AlertDispatcher (Phase 3 - will consume these)
```

### Redis Keys

```
# Price history (60 minutes)
prices:{marketId}:{outcomeId} - ZSET (timestamp, price)

# Volume history (60 minutes)
volume:{marketId}:{outcomeId} - ZSET (timestamp, volume)

# Trade history (last 100 trades)
trades:{tokenId} - ZSET (timestamp, trade_data) ✅ Already exists

# Orderbook depth history (60 minutes)
depth:{marketId}:{outcomeId} - ZSET (timestamp, depth)

# Last price per outcome (for velocity)
last_price:{marketId}:{outcomeId} - String (price)

# Alert events (for Phase 3)
alerts:pending - LIST (alert JSON)
```

---

## Implementation Steps

### Step 1: Create Anomaly Detector Service
1. Create `backend/src/services/anomaly-detector.ts`
2. Implement base `AnomalyDetector` class
3. Add Z-score calculator
4. Add helper functions in `backend/src/utils/statistics.ts`

### Step 2: Implement Price Velocity Tracker
1. Add price history tracking to `market-ingestion.ts`
2. Implement velocity calculation in `anomaly-detector.ts`
3. Test with real price updates

### Step 3: Implement Volume Acceleration Detector
1. Use existing trade history from Redis
2. Calculate hourly averages
3. Implement 3σ threshold detection
4. Test with volume spikes

### Step 4: Implement Fat Finger Detector
1. Track last 3 trades per outcome
2. Implement deviation detection
3. Implement reversion verification
4. Test with simulated fat finger trades

### Step 5: Enhance Liquidity Monitor
1. Enhance existing spread detection
2. Add depth drop tracking
3. Implement 80% drop detection
4. Test with liquidity events

### Step 6: Enhance Whale Detector
1. Enhance existing whale detection
2. Format alert messages
3. Integrate with anomaly detector
4. Test with large trades

### Step 7: Integration
1. Integrate all detectors into `market-ingestion.ts`
2. Create alert event structure
3. Store alerts in Redis for Phase 3
4. Add logging and monitoring

---

## Testing Strategy

### Unit Tests
- Test Z-score calculations with known data
- Test price velocity with simulated price changes
- Test volume acceleration with known volume patterns
- Test fat finger detection with simulated trades
- Test liquidity monitoring with known orderbook states

### Integration Tests
- Test with real WebSocket data
- Verify alerts are generated correctly
- Test edge cases (no data, insufficient data, etc.)
- Performance testing with high trade volume

### Manual Testing
- Monitor logs for alert generation
- Verify alert accuracy with known events
- Test false positive rate
- Adjust thresholds as needed

---

## Success Criteria

1. ✅ All 5 alert types can be detected
2. ✅ Z-score calculator works correctly
3. ✅ Price velocity tracking accurate
4. ✅ Volume acceleration detection working
5. ✅ Fat finger detection working
6. ✅ Liquidity monitoring enhanced
7. ✅ Whale detection enhanced
8. ✅ Alert events generated and stored
9. ✅ <5% false positive rate
10. ✅ <100ms detection latency

---

## Dependencies

- Phase 1 completed (trade data, orderbook data, Redis sliding windows)
- Redis operational
- WebSocket receiving data
- Database accessible

---

## Next Steps After Phase 2

Once Phase 2 is complete, we'll have:
- Anomaly detection engine operational
- All 5 alert types detected
- Alert events generated and stored

Phase 3 will:
- Build alert dispatcher service
- Implement notification delivery
- Add alert throttling
- Format human-readable messages
