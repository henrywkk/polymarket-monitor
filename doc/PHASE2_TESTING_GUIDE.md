# Phase 2 Testing Guide

**Purpose:** Test Phase 2 Anomaly Detection Engine to verify all 5 alert types are being detected correctly.

---

## Prerequisites

1. Backend is running and connected to:
   - PostgreSQL database
   - Redis instance
   - Polymarket WebSocket (`wss://ws-subscriptions-clob.polymarket.com/ws/market`)

2. Phase 1 is complete:
   - Trade data collection working
   - Orderbook depth monitoring active
   - Redis sliding windows operational

3. Markets are synced and receiving real-time data

---

## Testing Methods

### Method 1: Check Backend Logs

The anomaly detector logs all generated alerts. Look for these log messages:

#### Alert Generation Logs

```
[Alert Generated] INSIDER_MOVE: INSIDER MOVE: Price 18.5% + Volume 4.2σ spike (Market: 85299)
[Alert Generated] FAT_FINGER: FAT FINGER: Price deviated 35.2% then reverted 22.1% (Market: 85299)
[Alert Generated] LIQUIDITY_VACUUM: Liquidity Vacuum: Spread widened to 12.5¢ (Market: 85299)
[Alert Generated] WHALE_TRADE: WHALE TRADE: $12500.00 USDC (Market: 85299)
[Alert Generated] VOLUME_ACCELERATION: Volume spike detected: 50000.00 (3.8σ above average) (Market: 85299)
```

#### Existing Detection Logs (Still Active)

```
[Whale Trade] Asset 284710 (Market: 85299): $25000.00 at 0.65
[Liquidity Vacuum] Asset 284710 (Market: 85299): Spread widened to 15.00 cents
```

**Note:** The existing logs will still appear, but alerts are now also stored in Redis for Phase 3.

---

### Method 2: Inspect Redis for Stored Alerts

All alerts are stored in Redis for Phase 3 (Alert Dispatcher) to consume.

#### Connect to Redis

```bash
# If using local Redis
redis-cli

# If using Railway/cloud Redis
redis-cli -h {REDIS_HOST} -p {REDIS_PORT} -a {REDIS_PASSWORD}
```

#### Check Pending Alerts

```bash
# Get all pending alerts (FIFO queue)
LRANGE alerts:pending 0 -1

# Get count of pending alerts
LLEN alerts:pending

# Get alerts for a specific market
LRANGE alerts:market:{marketId} 0 -1

# Example: Get alerts for market 85299
LRANGE alerts:market:85299 0 -1
```

#### Alert JSON Structure

Each alert is stored as JSON with this structure:

```json
{
  "type": "insider_move",
  "marketId": "85299",
  "outcomeId": "outcome-123",
  "tokenId": "284710",
  "outcomeName": "Yes",
  "severity": "critical",
  "message": "INSIDER MOVE: Price 18.5% + Volume 4.2σ spike",
  "data": {
    "priceChange": 18.5,
    "volumeZScore": 4.2,
    "currentPrice": 0.65,
    "currentVolume": 50000
  },
  "timestamp": 1704787200000
}
```

#### Alert Types

- `insider_move`: Price >15% in <1min + volume acceleration (3σ)
- `fat_finger`: Price deviation >30% + reversion within 2 trades
- `liquidity_vacuum`: Spread >10 cents OR depth drop >80% in <1min
- `whale_trade`: Single trade >$10k USDC
- `volume_acceleration`: Volume >3σ above hourly average

#### Check Alert TTL

```bash
# Check if alert queue has TTL (should be 3600 seconds = 1 hour)
TTL alerts:pending

# Check market-specific alert queue TTL
TTL alerts:market:85299
```

---

### Method 3: Monitor Real-Time Detection

#### Price Velocity Tracking

Check if price history is being stored:

```bash
# Check price history for a market/outcome
ZREVRANGE prices:{marketId}:{outcomeId} 0 9

# Example:
ZREVRANGE prices:85299:outcome-123 0 9
```

#### Volume Tracking

Check if volume history is being stored:

```bash
# Check volume history for a market/outcome
ZREVRANGE volume:{marketId}:{outcomeId} 0 9

# Example:
ZREVRANGE volume:85299:outcome-123 0 9
```

#### Depth Tracking

Check if depth history is being stored:

```bash
# Check last depth value
GET depth:{marketId}:{outcomeId}

# Example:
GET depth:85299:outcome-123
```

#### Last Price Tracking

Check if last price is being tracked for velocity:

```bash
# Check last price
GET last_price:{marketId}:{outcomeId}

# Example:
GET last_price:85299:outcome-123
```

#### Fat Finger Tracking

Check if trade history is being tracked for fat finger detection:

```bash
# Check fat finger trade history
GET fat_finger:{marketId}:{outcomeId}

# Example:
GET fat_finger:85299:outcome-123
```

---

### Method 4: Test Each Alert Type Manually

#### Test 1: Whale Trade Detection

**Expected Behavior:**
- When a trade >= $10,000 occurs, an alert should be generated
- Alert type: `whale_trade`
- Severity: `medium`

**How to Verify:**
1. Monitor logs for `[Alert Generated] WHALE_TRADE`
2. Check Redis: `LRANGE alerts:pending 0 -1`
3. Look for trades >= $10k in trade history

**Note:** Whale trades are relatively rare. You may need to wait for a real whale trade or check historical data.

#### Test 2: Liquidity Vacuum Detection

**Expected Behavior:**
- When spread > 10 cents, an alert should be generated
- When depth drops >80% in <1min, an alert should be generated
- Alert type: `liquidity_vacuum`
- Severity: `high`

**How to Verify:**
1. Monitor logs for `[Alert Generated] LIQUIDITY_VACUUM`
2. Check Redis: `LRANGE alerts:pending 0 -1`
3. Look for markets with wide spreads in orderbook data

**Note:** Liquidity vacuums may occur during low-volume periods or market volatility.

#### Test 3: Price Velocity Detection

**Expected Behavior:**
- When price moves >15% in <1min, price velocity alert should be generated
- This is a component of insider move detection
- Alert type: `insider_move` (when combined with volume acceleration)

**How to Verify:**
1. Monitor logs for price velocity alerts
2. Check Redis: `GET last_price:{marketId}:{outcomeId}`
3. Verify price history is being stored: `ZREVRANGE prices:{marketId}:{outcomeId} 0 9`

**Note:** Price velocity alone doesn't generate an alert - it needs to be combined with volume acceleration for insider move.

#### Test 4: Volume Acceleration Detection

**Expected Behavior:**
- When volume in 1 minute >3σ above hourly average, an alert should be generated
- Alert type: `volume_acceleration`
- Severity: `medium`

**How to Verify:**
1. Monitor logs for `[Alert Generated] VOLUME_ACCELERATION`
2. Check Redis: `LRANGE alerts:pending 0 -1`
3. Verify trade history is being stored: `ZREVRANGE trades:{tokenId} 0 99`

**Note:** Requires at least 10 trades in the last 60 minutes for Z-score calculation.

#### Test 5: Insider Move Detection

**Expected Behavior:**
- When price moves >15% in <1min AND volume >3σ above average, an alert should be generated
- Alert type: `insider_move`
- Severity: `critical`

**How to Verify:**
1. Monitor logs for `[Alert Generated] INSIDER_MOVE`
2. Check Redis: `LRANGE alerts:pending 0 -1`
3. Verify both price velocity and volume acceleration conditions are met

**Note:** This is the most complex alert type, requiring both price velocity and volume acceleration.

#### Test 6: Fat Finger Detection

**Expected Behavior:**
- When price deviates >30% from previous trade AND reverts >20% within 2 trades, an alert should be generated
- Alert type: `fat_finger`
- Severity: `medium`

**How to Verify:**
1. Monitor logs for `[Alert Generated] FAT_FINGER`
2. Check Redis: `LRANGE alerts:pending 0 -1`
3. Check fat finger tracking: `GET fat_finger:{marketId}:{outcomeId}`

**Note:** Requires at least 3 trades to detect deviation and reversion.

---

### Method 5: Enable Debug Logging

Set environment variable to see detailed anomaly detection logs:

```bash
DEBUG_ANOMALY=true
```

This will log:
- Z-score calculations
- Price velocity checks
- Volume acceleration checks
- Fat finger detection steps
- Liquidity vacuum checks

**Note:** This generates a lot of logs. Use only for debugging.

---

## What to Verify

### ✅ Z-Score Calculator

1. **Z-scores are calculated correctly:**
   - Check logs for Z-score values
   - Verify mean and standard deviation are calculated from historical data
   - Verify Z-score threshold (3.5σ) is applied correctly

2. **Historical data is available:**
   - Check Redis for price/volume history
   - Verify at least 10 data points exist for meaningful statistics

### ✅ Price Velocity Tracker

1. **Price history is stored:**
   - Check Redis: `ZREVRANGE prices:{marketId}:{outcomeId} 0 9`
   - Verify prices are stored with timestamps

2. **Last price is tracked:**
   - Check Redis: `GET last_price:{marketId}:{outcomeId}`
   - Verify last price is updated on each price event

3. **Velocity is calculated:**
   - Check logs for price velocity alerts
   - Verify 15% threshold is applied correctly

### ✅ Volume Acceleration Detector

1. **Trade history is available:**
   - Check Redis: `ZREVRANGE trades:{tokenId} 0 99`
   - Verify trades are stored with timestamps

2. **Volume history is stored:**
   - Check Redis: `ZREVRANGE volume:{marketId}:{outcomeId} 0 9`
   - Verify volumes are stored with timestamps

3. **Z-score is calculated:**
   - Check logs for volume acceleration alerts
   - Verify 3σ threshold is applied correctly

### ✅ Fat Finger Detector

1. **Trade history is tracked:**
   - Check Redis: `GET fat_finger:{marketId}:{outcomeId}`
   - Verify last 3 trades are stored

2. **Deviation is detected:**
   - Check logs for fat finger detection
   - Verify 30% threshold is applied correctly

3. **Reversion is verified:**
   - Check logs for reversion confirmation
   - Verify reversion threshold (20%) is applied correctly

### ✅ Liquidity Monitor

1. **Spread is monitored:**
   - Check logs for liquidity vacuum alerts
   - Verify 10 cents threshold is applied correctly

2. **Depth is tracked:**
   - Check Redis: `GET depth:{marketId}:{outcomeId}`
   - Verify depth is stored with timestamps

3. **Depth drops are detected:**
   - Check logs for depth drop alerts
   - Verify 80% threshold is applied correctly

### ✅ Whale Detector

1. **Trade size is checked:**
   - Check logs for whale trade alerts
   - Verify $10k threshold is applied correctly

2. **Alerts are generated:**
   - Check Redis: `LRANGE alerts:pending 0 -1`
   - Verify whale trade alerts are stored

### ✅ Alert Storage

1. **Alerts are stored in Redis:**
   - Check `alerts:pending` queue
   - Check market-specific queues: `alerts:market:{marketId}`

2. **Alert structure is correct:**
   - Verify JSON structure
   - Verify all required fields are present
   - Verify timestamps are correct

3. **TTL is set:**
   - Verify alerts expire after 1 hour if not processed
   - Check: `TTL alerts:pending`

---

## Common Issues and Troubleshooting

### Issue: No Alerts Generated

**Possible Causes:**
1. Not enough historical data for Z-score calculation
   - **Solution:** Wait for more data to accumulate (at least 10 data points)
   
2. Thresholds are too high
   - **Solution:** Check if real market conditions meet thresholds
   - **Note:** Thresholds are intentionally high to reduce false positives

3. WebSocket not receiving data
   - **Solution:** Check WebSocket connection status
   - Check logs for WebSocket events

### Issue: Too Many Alerts (False Positives)

**Possible Causes:**
1. Thresholds are too low
   - **Solution:** Adjust thresholds in `anomaly-detector.ts`
   - Current thresholds:
     - Price velocity: 15%
     - Fat finger: 30%
     - Liquidity vacuum: 10 cents
     - Whale trade: $10k
     - Volume acceleration: 3σ

2. Market is highly volatile
   - **Solution:** This is expected behavior - alerts are working correctly
   - Consider implementing alert throttling (Phase 3)

### Issue: Z-Score Always Null

**Possible Causes:**
1. Not enough historical data
   - **Solution:** Wait for more data (at least 10 data points)
   - Check Redis for historical data: `ZREVRANGE prices:{marketId}:{outcomeId} 0 -1`

2. All values are identical (std dev = 0)
   - **Solution:** This is expected - Z-score cannot be calculated if all values are the same
   - Wait for price/volume variation

### Issue: Price Velocity Not Detected

**Possible Causes:**
1. Price updates are too infrequent
   - **Solution:** Check if price updates are being received
   - Check Redis: `GET last_price:{marketId}:{outcomeId}`

2. Time window is too short
   - **Solution:** Price velocity checks last 1 minute - verify price updates are within this window

---

## Success Criteria

✅ **All 5 alert types can be detected:**
- Insider Move
- Fat Finger
- Liquidity Vacuum
- Whale Trade
- Volume Acceleration

✅ **Alerts are stored in Redis:**
- `alerts:pending` queue contains alerts
- Market-specific queues contain alerts
- Alert JSON structure is correct

✅ **Historical data is being stored:**
- Price history in Redis
- Volume history in Redis
- Trade history in Redis
- Depth history in Redis

✅ **Z-score calculations work:**
- Mean and standard deviation calculated correctly
- Z-scores calculated correctly
- Anomalies flagged when |Z| > 3.5

✅ **Detection latency is acceptable:**
- Alerts generated within 100ms of event
- No significant performance impact

---

## Next Steps

Once Phase 2 testing is complete and verified:

1. **Phase 3: Alert System & Delivery**
   - Build Alert Dispatcher Service
   - Implement notification delivery (webhook, email, etc.)
   - Add alert throttling
   - Format human-readable messages

2. **Monitor Alert Accuracy**
   - Track false positive rate
   - Adjust thresholds as needed
   - Collect user feedback

3. **Performance Optimization**
   - Monitor Redis memory usage
   - Optimize Z-score calculations
   - Batch Redis operations if needed
