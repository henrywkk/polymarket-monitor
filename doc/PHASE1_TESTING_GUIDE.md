# Phase 1 Testing Guide

**Purpose:** Test Phase 1 implementation (Trade Data Extraction, Orderbook Depth Analysis, Redis Sliding Windows) without frontend integration.

---

## Prerequisites

1. Backend is running and connected to:
   - PostgreSQL database
   - Redis instance
   - Polymarket WebSocket (`wss://ws-subscriptions-clob.polymarket.com/ws/market`)

2. Markets are synced (at least a few active markets)

3. WebSocket is connected and receiving data

---

## Testing Methods

### Method 1: API Endpoints (Recommended)

We've added new API endpoints to query trade and orderbook data:

#### 1. Get Trade History for a Market

```bash
# Get last 100 trades for a market
curl http://localhost:3000/api/trades/{marketId}

# Example:
curl http://localhost:3000/api/trades/0x1234567890abcdef
```

**Response:**
```json
{
  "data": [
    {
      "price": 0.65,
      "size": 1000,
      "timestamp": 1704787200000,
      "side": "buy",
      "tokenId": "284710",
      "outcomeId": "outcome-123",
      "outcomeName": "Yes"
    }
  ],
  "stats": {
    "totalTrades": 50,
    "oldestTrade": 1704780000000,
    "newestTrade": 1704787200000,
    "redisStats": {
      "count": 50,
      "oldest": 1704780000000,
      "newest": 1704787200000
    }
  }
}
```

#### 2. Get Trade Statistics

```bash
curl http://localhost:3000/api/trades/{marketId}/stats
```

**Response:**
```json
{
  "stats": [
    {
      "tokenId": "284710",
      "tradeCount": 50,
      "totalVolume": 50000,
      "avgPrice": 0.65,
      "whaleTradeCount": 2,
      "largestTrade": 25000
    }
  ]
}
```

#### 3. Get Orderbook Metrics

```bash
curl http://localhost:3000/api/trades/orderbook/{marketId}
```

**Response:**
```json
{
  "data": [
    {
      "spread": 0.02,
      "spreadPercent": 3.08,
      "depth2Percent": 50000,
      "bestBid": 0.64,
      "bestAsk": 0.66,
      "midPrice": 0.65,
      "totalBidDepth": 100000,
      "totalAskDepth": 120000,
      "timestamp": 1704787200000,
      "tokenId": "284710",
      "outcomeId": "outcome-123",
      "outcomeName": "Yes"
    }
  ],
  "latest": { ... }
}
```

---

### Method 2: Check Backend Logs

#### Trade Events

Look for these log messages:

1. **Trade Events Received:**
   ```
   [WebSocket] Emitting trade update: 284710 -> 0.65/0.66
   ```

2. **Whale Trades Detected:**
   ```
   [Whale Trade] Asset 284710 (Market: 0x123...): $10000.00 at 0.65
   ```

3. **Trade Storage:**
   - No explicit log, but trades should be stored in Redis
   - Check Redis keys: `trades:{assetId}`

#### Orderbook Events

Look for these log messages:

1. **Orderbook Events Received:**
   - Orderbook events are processed silently
   - Check Redis keys: `orderbook:{assetId}`

2. **Liquidity Vacuum Detected:**
   ```
   [Liquidity Vacuum] Asset 284710 (Market: 0x123...): Spread widened to 15.00 cents
   ```

---

## Understanding Asset vs Market vs Outcome

**Important Terminology:**
- **Market**: A prediction market (e.g., "Will Bitcoin reach $100k by 2025?")
- **Outcome**: A specific result within a market (e.g., "Yes", "No", "<0.5%", "March 31, 2026")
- **Token ID / Asset ID**: A unique identifier for each outcome's trading token in Polymarket's CLOB system
  - Each outcome has its own `token_id`
  - In WebSocket messages, this is called `assetId`
  - Redis keys use this: `trades:{token_id}` and `orderbook:{token_id}`

**Example:**
- Market: "AI bubble burst by...?" (market_id: `85299`)
  - Outcome 1: "March 31, 2026" → token_id: `284710`
  - Outcome 2: "December 31, 2025" → token_id: `284711`
  - Outcome 3: "December 31, 2026" → token_id: `284712`

**Key Point:** When querying Redis with `trades:284710`, you're querying trades for a **specific outcome**, not the entire market. To get all trades for a market, you need to query each outcome's token_id separately, or use the API endpoint which does this automatically.

---

### Method 3: Direct Redis Inspection

#### Connect to Redis

```bash
# If using local Redis
redis-cli

# If using Railway/cloud Redis
redis-cli -h {REDIS_HOST} -p {REDIS_PORT} -a {REDIS_PASSWORD}
```

#### Check Trade Data

**Important:** "Asset" refers to an **outcome's `token_id`**, not the market. Each outcome in a market has its own unique `token_id` (also called `assetId` in Polymarket's WebSocket API).

**To find the token_id for an outcome:**
1. Query the database: `SELECT token_id, outcome, market_id FROM outcomes WHERE market_id = '{marketId}'`
2. Or use the API: `GET /api/markets/{marketId}` and look at the `outcomes[].tokenId` field

```bash
# List all trade keys (each key is trades:{token_id})
KEYS trades:*

# Get trade count for a specific outcome (by token_id)
# Example: token_id 284710 corresponds to a specific outcome (e.g., "Yes" or "<0.5%")
ZCARD trades:284710

# Get latest 10 trades for an outcome
ZREVRANGE trades:284710 0 9

# Get trades from last hour (using timestamps in milliseconds)
ZRANGEBYSCORE trades:284710 1704783600000 1704787200000

# Example: Get all trades for a market (requires knowing all outcome token_ids)
# First, get all outcomes for market from database, then query each token_id
```

#### Check Orderbook Data

**Important:** Orderbook data is also stored per outcome (by `token_id`), not per market.

```bash
# List all orderbook keys (each key is orderbook:{token_id})
KEYS orderbook:*

# Get orderbook metrics count for a specific outcome (by token_id)
ZCARD orderbook:284710

# Get latest orderbook metrics for an outcome
ZREVRANGE orderbook:284710 0 0

# Get latest 10 orderbook snapshots
ZREVRANGE orderbook:284710 0 9

# Get orderbook metrics from last hour
ZRANGEBYSCORE orderbook:284710 1704783600000 1704787200000
```

#### Check TTL (Time To Live)

```bash
# Check if keys have TTL set (should be > 0)
TTL trades:284710
TTL orderbook:284710
```

---

### Method 4: Enable Debug Logging

Set environment variable to see full WebSocket messages:

```bash
DEBUG_WEBSOCKET=true
```

This will log the full structure of WebSocket messages, helping you verify:
- If trade data (size, volume) is present in messages
- If orderbook data (bids, asks) is present
- The exact format of the data

**Note:** This generates a lot of logs. Use only for debugging.

---

## What to Verify

### ✅ Trade Data Collection

1. **Trades are being received:**
   - Check API endpoint returns trade data
   - Check Redis has `trades:{assetId}` keys
   - Check logs for trade events

2. **Trade storage:**
   - Trades are stored in Redis with timestamps
   - Max 100 trades per asset (older ones auto-removed)
   - TTL is set (24 hours)

3. **Whale trades:**
   - Trades >= $10k are logged
   - Check logs for `[Whale Trade]` messages

### ✅ Orderbook Depth Analysis

1. **Orderbook events are being received:**
   - Check API endpoint returns orderbook metrics
   - Check Redis has `orderbook:{assetId}` keys

2. **Metrics are calculated:**
   - Spread is calculated (bid-ask difference)
   - Spread percentage is calculated
   - Depth within 2% is calculated
   - Total bid/ask depth is calculated

3. **Liquidity vacuum detection:**
   - Spread > 10 cents triggers log message
   - Check logs for `[Liquidity Vacuum]` messages

### ✅ Redis Sliding Windows

1. **Automatic cleanup:**
   - Old data is removed (check TTL)
   - Max items limit is enforced (100 for trades, 3600 for orderbook)

2. **Data retention:**
   - Trades: 24 hours
   - Orderbook: 60 minutes

---

## Expected Results

### If Trade Data is Available in WebSocket

- ✅ API endpoints return trade data
- ✅ Redis has `trades:{assetId}` keys with data
- ✅ Whale trades are logged
- ✅ Trade statistics are accurate

### If Trade Data is NOT Available in WebSocket

- ⚠️ API endpoints return empty arrays
- ⚠️ Redis has no `trades:{assetId}` keys (or keys are empty)
- ⚠️ No whale trade logs
- ✅ Orderbook data should still work

**Next Step:** If trade data is not available, we'll implement REST API fallback (as planned in Phase 1).

---

## Troubleshooting

### No Trade Data

1. **Check WebSocket connection:**
   ```bash
   curl http://localhost:3000/api/health
   ```
   Look for `websocket: "connected"`

2. **Check if markets are synced:**
   ```bash
   curl http://localhost:3000/api/markets?limit=1
   ```

3. **Enable debug logging:**
   Set `DEBUG_WEBSOCKET=true` and check logs for message structure

4. **Check Redis connection:**
   ```bash
   curl http://localhost:3000/api/health
   ```
   Look for `redis: "healthy"`

### No Orderbook Data

1. **Check if orderbook events are being received:**
   - Enable debug logging
   - Check if `bids` and `asks` arrays are in WebSocket messages

2. **Verify orderbook parsing:**
   - Check logs for errors
   - Verify Redis keys exist

### Redis Memory Issues

1. **Check Redis memory:**
   ```bash
   redis-cli INFO memory
   ```

2. **Verify TTL is set:**
   ```bash
   TTL trades:284710
   TTL orderbook:284710
   ```

3. **Check key count:**
   ```bash
   DBSIZE
   ```

---

## Testing Checklist

- [ ] Backend is running and healthy
- [ ] WebSocket is connected
- [ ] Markets are synced
- [ ] Trade API endpoint returns data (or empty if no trade data in WebSocket)
- [ ] Orderbook API endpoint returns data
- [ ] Redis has trade keys (if trade data available)
- [ ] Redis has orderbook keys
- [ ] TTL is set on Redis keys
- [ ] Whale trades are logged (if any trades >= $10k)
- [ ] Liquidity vacuums are logged (if spread > 10 cents)
- [ ] Old data is automatically cleaned up (check after 24 hours for trades, 60 minutes for orderbook)

---

## Next Steps After Testing

1. **If trade data is available:**
   - ✅ Phase 1 Task 1 is complete
   - Proceed to Phase 2 (Anomaly Detection)

2. **If trade data is NOT available:**
   - Implement REST API fallback
   - Or proceed to Phase 2 with orderbook data only
   - Trade data can be added later

3. **If orderbook data is NOT available:**
   - Check WebSocket message format
   - Verify orderbook parsing logic
   - May need to adjust parsing based on actual message structure
