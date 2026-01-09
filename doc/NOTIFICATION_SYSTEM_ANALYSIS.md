# Notification System Implementation Analysis

**Date:** January 2026  
**Target:** Professional-grade Polymarket notification system  
**Current Status:** Core monitoring platform with real-time data ingestion

---

## Executive Summary

**Current Progress: ~40%** toward the target notification system.

We have a **solid foundation** with real-time data ingestion, but we're missing the **intelligence layer** (anomaly detection, alerting, and notification delivery).

---

## Current State Assessment

### ✅ What We Have (Foundation Layer)

#### 1. **Data Sources** ✅
- **Gamma API Integration**: ✅ Fully implemented
  - Polling every 5 minutes (configurable)
  - Fetches markets, outcomes, metadata
  - Category detection and filtering
- **CLOB WebSocket**: ✅ Partially implemented
  - Connected to `wss://ws-subscriptions-clob.polymarket.com/ws/market`
  - Receives `price_change`, `book`, `last_trade_price` events
  - **Missing**: `trades` channel (for trade volume/size)
  - **Missing**: `level2` orderbook depth monitoring
- **CLOB REST API**: ✅ Implemented
  - Market metadata fetching
  - Volume and liquidity data extraction

#### 2. **Storage Infrastructure** ✅
- **PostgreSQL**: ✅ Fully implemented
  - Markets, outcomes, price history tables
  - `market_stats_history` table exists (ready for alerts)
  - Proper indexes for performance
- **Redis**: ✅ Implemented but underutilized
  - Currently used for: Real-time price caching (1-hour TTL)
  - **Missing**: Sliding windows for Z-score calculations
  - **Missing**: Trade history storage (for volume velocity)
  - **Missing**: Alert throttling/cooldown keys

#### 3. **Metadata Synchronization** ✅
- **Market Sync Service**: ✅ Fully implemented
  - Periodic sync every 5 minutes
  - Upsert logic for markets and outcomes
  - New market detection (but no alerting yet)
  - **Missing**: New outcome detection alerting

#### 4. **Real-Time Processing** ⚠️ Partial
- **WebSocket Event Handler**: ✅ Implemented
  - Price event parsing
  - Implied probability calculation
  - Redis caching
  - Database persistence (throttled)
- **Missing**: Trade size/volume tracking
- **Missing**: Orderbook depth monitoring
- **Missing**: Price velocity calculations
- **Missing**: Volume acceleration detection

---

## Target Solution Requirements

### Required Components (From Document)

#### 1. **Alert Catalog** (5 Alert Types)
- ❌ **A. Insider Move Alert**: Price >15% in <1min + volume acceleration (3σ)
- ❌ **B. Fat Finger/Flash Crash**: Price deviation >30% + reversion within 2 trades
- ❌ **C. Liquidity Vacuum**: Spread >10 cents (orderbook collapse)
- ⚠️ **D. New Narrative Alert**: New market detection (logic exists, no alerting)
- ❌ **E. Whale Watch**: Single trade >$10k USDC

#### 2. **Infrastructure Components**
- ✅ **PostgreSQL**: Metadata database (exists)
- ⚠️ **Redis**: High-performance store (exists but needs enhancement)
  - Need: Redis Streams/ZSET for sliding windows
  - Need: Trade history storage
  - Need: Alert cooldown tracking
- ❌ **Alert Dispatcher**: Notification delivery system
- ❌ **Alert Throttle**: Spam protection logic

#### 3. **Processing Components**
- ⚠️ **Metadata Synchronizer**: ✅ Exists (needs alert triggers)
- ❌ **Stream Processor**: Anomaly detection engine
  - ❌ Z-Score Calculator
  - ❌ Fat Finger Detector
  - ❌ Liquidity Monitor
  - ❌ Whale Detector
- ❌ **Alert Formatter**: Human-readable notifications

---

## Gap Analysis

### Critical Missing Components

#### 1. **Trade Data Collection** 🔴 HIGH PRIORITY
**Current State:**
- WebSocket receives price updates via `market` channel
- Currently parsing `price_changes` and `book` updates
- **Need to verify**: Trade size/volume data in market channel messages
- No trade history storage
- Cannot detect whale trades or volume acceleration

**Required:**
- Extract trade data from `market` channel messages (no separate trades channel)
- Parse trade size/volume if available in WebSocket messages
- Store trade history in Redis (sliding windows with TTL)
- Track trade size in USDC
- Fallback to REST API if WebSocket doesn't provide trade data

**Effort:** Medium (2-3 days)

#### 2. **Orderbook Depth Monitoring** 🔴 HIGH PRIORITY
**Current State:**
- Receives `book` events but doesn't analyze depth/spread
- No liquidity vacuum detection

**Required:**
- Monitor bid-ask spread
- Track depth within 2% of mid-price
- Detect 80% depth drops in <1 minute

**Effort:** Medium (2-3 days)

#### 3. **Anomaly Detection Engine** 🔴 HIGH PRIORITY
**Current State:**
- No statistical analysis
- No Z-score calculations
- No velocity/acceleration tracking

**Required:**
- Z-score calculator (3.5σ threshold)
- Price velocity tracker (15% in <1min)
- Volume acceleration detector (3σ above hourly average)
- Fat finger detector (30% deviation + reversion)

**Effort:** High (5-7 days)

#### 4. **Alert System** 🟡 MEDIUM PRIORITY
**Current State:**
- No alerting infrastructure
- No notification delivery

**Required:**
- Alert dispatcher service
- Notification channels (email, webhook, push, etc.)
- Alert formatting (human-readable messages)
- Alert throttling (1 per market per 10min)

**Effort:** Medium (3-5 days)

#### 5. **Enhanced Redis Usage** 🟡 MEDIUM PRIORITY
**Current State:**
- Basic price caching only
- No sliding windows
- No trade history

**Required:**
- Redis Streams or ZSET for time-series data
- 60-minute sliding windows for Z-scores
- Trade history storage (last 100 trades per market)
- Alert cooldown keys

**Effort:** Medium (2-3 days)

---

## Implementation Phases

### **Phase 1: Data Collection Enhancement** (Week 1-2)
**Goal:** Collect all necessary data for anomaly detection

**Tasks:**
1. ✅ **WebSocket Trade Data Extraction** (2 days)
   - Analyze `market` channel messages for trade data
   - Extract trade size/volume from WebSocket messages (if available)
   - Parse trade events (price, size, timestamp, asset_id)
   - Store trade history in Redis with sliding windows
   - Implement fallback to REST API if WebSocket lacks trade data

2. ✅ **Orderbook Depth Analysis** (2 days)
   - Enhance `book` event handler in `polymarket-client.ts`
   - Calculate bid-ask spread from orderbook
   - Track depth within 2% of mid-price
   - Store depth metrics in Redis (sliding window with TTL)

3. ✅ **Enhanced Redis Storage with Sliding Windows** (2 days)
   - Implement Redis ZSET for time-series data (timestamp as score)
   - Store last 100 trades per market (auto-expire old data)
   - Store 60-minute price/volume history (TTL: 2 hours)
   - Implement automatic cleanup of old data
   - Add Redis Streams for trade events (optional, for replay)

4. ✅ **Frontend Integration** (1 day)
   - Add WebSocket events for trade data (if needed for UI)
   - Add orderbook depth display (optional)
   - Update frontend to show real-time trade activity
   - Add API endpoints for trade history (if needed)

**Deliverables:**
- Trade data collection working (from market channel)
- Orderbook depth monitoring active
- Redis sliding windows operational with automatic cleanup
- Frontend can display trade activity (if applicable)

---

### **Phase 2: Anomaly Detection Engine** (Week 3-4)
**Goal:** Detect the 5 alert types

**Tasks:**
1. ✅ **Z-Score Calculator** (2 days)
   - Calculate moving average (μ) and standard deviation (σ)
   - Compute Z-score: Z = (CurrentValue - μ) / σ
   - Flag anomalies when |Z| > 3.5

2. ✅ **Price Velocity Tracker** (1 day)
   - Track price changes over 1-minute windows
   - Flag when price moves >15% in <1min

3. ✅ **Volume Acceleration Detector** (2 days)
   - Calculate hourly volume average
   - Compute 3σ threshold
   - Flag when volume >3σ in 1 minute

4. ✅ **Fat Finger Detector** (1 day)
   - Compare current trade price vs last trade price
   - Flag when deviation >30%
   - Verify reversion within 2 trades

5. ✅ **Liquidity Monitor** (1 day)
   - Monitor spread widening
   - Flag when spread >10 cents
   - Track depth drops (80% in <1min)

6. ✅ **Whale Detector** (1 day)
   - Check trade size >$10k USDC
   - Format whale alert

**Deliverables:**
- All 5 alert types detected
- Anomaly detection service operational
- Alert events generated

---

### **Phase 3: Alert System & Delivery** (Week 5-6)
**Goal:** Deliver alerts to users

**Tasks:**
1. ✅ **Alert Dispatcher Service** (2 days)
   - Alert event queue
   - Notification channel abstraction
   - Alert formatting (human-readable)

2. ✅ **Alert Throttling** (1 day)
   - Cooldown logic (1 alert per market per 10min)
   - Redis-based throttling
   - Severity-based override

3. ✅ **Notification Channels** (3 days)
   - Webhook delivery
   - Email notifications (optional)
   - In-app notifications (future)
   - Push notifications (future)

4. ✅ **Alert Configuration** (1 day)
   - `alert_config.json` for thresholds
   - User-configurable filters (category, volume, etc.)

**Deliverables:**
- Alert system operational
- Notifications delivered
- Configurable thresholds

---

### **Phase 4: New Market/Outcome Detection** (Week 7)
**Goal:** Detect new markets and outcomes

**Tasks:**
1. ✅ **Enhanced Metadata Sync** (2 days)
   - Track known market IDs in Redis
   - Detect new markets (trigger alert)
   - Detect new outcomes in existing markets
   - Keyword filtering (War, Launch, Hack, etc.)

2. ✅ **New Narrative Alert** (1 day)
   - Format new market alerts
   - Include market title and category

**Deliverables:**
- New market detection working
- New outcome detection working
- Alerts formatted and delivered

---

### **Phase 5: Testing & Optimization** (Week 8)
**Goal:** Production-ready system

**Tasks:**
1. ✅ **Performance Testing**
   - Load testing with high trade volume
   - Redis memory optimization
   - Database query optimization

2. ✅ **Alert Accuracy Testing**
   - False positive reduction
   - Threshold tuning
   - Noise filtering

3. ✅ **Monitoring & Observability**
   - Alert metrics dashboard
   - System health monitoring
   - Error tracking

**Deliverables:**
- Production-ready notification system
- Monitoring dashboard
- Documentation

---

## Recommended Implementation Approach

### **Option A: Phased Implementation (Recommended)**
**Timeline:** 8 weeks  
**Approach:** Build incrementally, test each phase

**Pros:**
- Lower risk
- Can deploy and test each phase
- Easier to debug
- Can adjust based on learnings

**Cons:**
- Longer timeline
- Some features delayed

---

### **Option B: Parallel Development**
**Timeline:** 4-5 weeks  
**Approach:** Build all components in parallel

**Pros:**
- Faster delivery
- All features at once

**Cons:**
- Higher risk
- Harder to test
- More complex integration

---

## Technical Recommendations

### 1. **Redis Data Structures**

```typescript
// Trade History (Sliding Window)
// Key: trades:{market_id}:{outcome_id}
// Type: Redis Stream or ZSET (timestamp as score)
// TTL: 24 hours

// Price History (60-minute window)
// Key: prices:{market_id}:{outcome_id}
// Type: ZSET (timestamp as score, price as value)
// TTL: 2 hours

// Volume History (60-minute window)
// Key: volume:{market_id}:{outcome_id}
// Type: ZSET (timestamp as score, volume as value)
// TTL: 2 hours

// Alert Cooldown
// Key: alert_cooldown:{market_id}:{alert_type}
// Type: String (timestamp)
// TTL: 10 minutes
```

### 2. **Alert Service Architecture**

```typescript
// services/alert-detector.ts
class AlertDetector {
  detectInsiderMove(trade: Trade): boolean
  detectFatFinger(trade: Trade, lastTrade: Trade): boolean
  detectLiquidityVacuum(orderbook: Orderbook): boolean
  detectWhale(trade: Trade): boolean
}

// services/alert-dispatcher.ts
class AlertDispatcher {
  dispatch(alert: Alert): Promise<void>
  throttle(marketId: string, alertType: string): boolean
  format(alert: Alert): string
}
```

### 3. **WebSocket Channel Expansion**

```typescript
// Current: Only 'market' channel
// Required: Add 'trades' and 'level2' channels

ws.send(JSON.stringify({
  type: "subscribe",
  channel: "trades",
  assets_ids: [] // All assets
}));

ws.send(JSON.stringify({
  type: "subscribe",
  channel: "level2",
  assets_ids: [] // All assets
}));
```

---

## Success Metrics

### Phase 1 Success:
- ✅ Trade data collected for all active markets
- ✅ Orderbook depth monitored
- ✅ Redis sliding windows operational

### Phase 2 Success:
- ✅ All 5 alert types detected
- ✅ <5% false positive rate
- ✅ <100ms detection latency

### Phase 3 Success:
- ✅ Alerts delivered within 1 second
- ✅ Throttling prevents spam
- ✅ Human-readable alert messages

### Phase 4 Success:
- ✅ New markets detected within 60 seconds
- ✅ New outcomes detected within 60 seconds

### Overall Success:
- ✅ System handles 1000+ trades/second
- ✅ <1% missed alerts
- ✅ User satisfaction with alert relevance

---

## Risk Assessment

### High Risk:
1. **WebSocket Rate Limits**: Polymarket may throttle connections
   - **Mitigation**: Monitor connection health, implement backoff

2. **Redis Memory**: Sliding windows can consume significant memory
   - **Mitigation**: Aggressive TTL, data sampling, memory monitoring

3. **False Positives**: Too many alerts = user fatigue
   - **Mitigation**: Careful threshold tuning, user feedback loop

### Medium Risk:
1. **Data Accuracy**: Trade size/volume may not be available
   - **Mitigation**: Verify WebSocket message format, fallback to REST API

2. **Performance**: Real-time processing at scale
   - **Mitigation**: Async processing, queue system, horizontal scaling

---

## Conclusion

**Current State:** We have a solid **40%** of the target solution implemented. The foundation (data ingestion, storage, metadata sync) is strong, but we need to build the **intelligence layer** (anomaly detection, alerting, notification delivery).

**Recommended Path:** **Phased implementation over 8 weeks**, starting with data collection enhancement, then building the anomaly detection engine, followed by alert delivery, and finally new market detection.

**Key Dependencies:**
1. Verify WebSocket `trades` channel availability
2. Verify trade size/volume data in WebSocket messages
3. Determine notification delivery preferences (webhook, email, etc.)

**Next Steps:**
1. Review and approve this analysis
2. Prioritize alert types (which are most important?)
3. Decide on notification delivery method
4. Begin Phase 1 implementation
