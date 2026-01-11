# Whale Trade Detection - Manual Verification Guide

## Overview

Whale trades are detected when a single trade exceeds **$10,000 USDC** in value. This guide explains the detection logic and how to verify it manually.

## Detection Logic

### 1. Trade Size Calculation

When a trade event is received from the Polymarket WebSocket:

```typescript
// Location: backend/src/services/market-ingestion.ts:625-653

// Step 1: Get raw values from WebSocket
const { assetId, price, size, timestamp, side } = event;

// Step 2: Calculate USDC value
// In Polymarket CLOB, 'size' is typically in SHARES, not USDC
// USDC value = size (shares) × price (USDC per share)
const sizeInUSDC = size * price;

// Step 3: Sanity check for edge cases
// If size > 1000 AND calculated USDC > size * 10, 
// it's possible 'size' is already in USDC (not shares)
const finalSizeInUSDC = (size > 1000 && sizeInUSDC > size * 10) 
  ? size 
  : sizeInUSDC;
```

**Key Points:**
- `size` from WebSocket is usually in **shares** (not USDC)
- `price` is in **USDC per share** (0-1 range for probability markets)
- `finalSizeInUSDC` = `size × price` (in most cases)
- Edge case handling: If the calculation seems wrong, use `size` directly

### 2. Whale Detection Threshold

```typescript
// Location: backend/src/services/anomaly-detector.ts:37, 499-522

private readonly WHALE_TRADE_THRESHOLD = 10000; // $10k USDC

detectWhaleTrade(marketId, outcomeId, tokenId, tradeSize) {
  if (tradeSize >= this.WHALE_TRADE_THRESHOLD) {
    // Generate whale alert
    return {
      type: 'whale_trade',
      severity: 'medium',
      message: `WHALE TRADE: $${tradeSize.toFixed(2)} USDC`,
      data: { tradeSize, threshold: 10000 }
    };
  }
  return null;
}
```

**Threshold:** `$10,000 USDC` (hardcoded constant)

### 3. Data Storage

Whale trades are stored in two places:

1. **Redis** (temporary, 24 hours):
   - Key: `trades:{token_id}`
   - Contains: `{ price, size, sizeInUSDC, timestamp, side, marketId, outcomeId }`
   - TTL: 24 hours
   - Max entries: 100 trades per outcome

2. **Alert Queue** (for notifications):
   - Stored via `anomalyDetector.storeAlert(whaleAlert)`
   - Key: `alerts:queue`
   - Used by Alert Dispatcher for Discord/webhook notifications

## Manual Verification Steps

### Step 1: Check Backend Logs

Look for whale trade log messages:

```bash
# Search logs for whale trades
grep "\[Whale Trade\]" backend-logs.txt

# Example output:
[Whale Trade] Asset 123456789 (Market: 0xabc...): $15,234.56 USDC (raw size: 15234.56, price: 0.45)
```

**What to verify:**
- `finalSizeInUSDC` >= $10,000
- `raw size` and `price` values are reasonable
- Market ID and asset ID are present

### Step 2: Query Redis Directly

If you have Redis access, check stored trades:

```bash
# Connect to Redis
redis-cli

# List all trade keys
KEYS trades:*

# Get trades for a specific token_id
LRANGE trades:123456789 0 -1

# Example output (JSON):
{
  "price": 0.45,
  "size": 33854.58,        # Raw size from WebSocket
  "sizeInUSDC": 15234.56,  # Calculated USDC value
  "timestamp": 1705068000000,
  "side": "BUY",
  "marketId": "0xabc...",
  "outcomeId": "outcome-123"
}
```

**What to verify:**
- `sizeInUSDC` >= $10,000 for whale trades
- `sizeInUSDC` = `size × price` (or matches sanity check logic)
- Timestamp is recent (within 24 hours)

### Step 3: Use API Endpoint

Query the whale trades API:

```bash
# Get all whale trades (default: >= $10,000)
curl http://your-backend/api/trades/whales

# Custom threshold (e.g., >= $50,000)
curl http://your-backend/api/trades/whales?minSize=50000

# Limit results
curl http://your-backend/api/trades/whales?minSize=10000&limit=10
```

**Response format:**
```json
{
  "data": [
    {
      "price": 0.45,
      "size": 15234.56,        // NOTE: This is sizeInUSDC from Redis
      "sizeInUSDC": 15234.56,
      "timestamp": 1705068000000,
      "side": "BUY",
      "marketId": "0xabc...",
      "outcomeId": "outcome-123",
      "tokenId": "123456789",
      "outcomeName": "Yes"
    }
  ],
  "total": 1,
  "minSize": 10000,
  "stats": {
    "totalWhaleTrades": 1,
    "largestTrade": 15234.56,
    "totalVolume": 15234.56
  }
}
```

**✅ FIXED:** The API endpoint now correctly uses `sizeInUSDC` for filtering, with fallback to `size` for backward compatibility.

### Step 4: Verify Calculation Manually

For a specific trade, verify the calculation:

**Example:**
- Raw `size` from WebSocket: `33,854.58`
- `price`: `0.45`
- Expected `sizeInUSDC`: `33,854.58 × 0.45 = 15,234.56`

**Edge case check:**
- If `size > 1000` AND `sizeInUSDC > size × 10`:
  - Use `size` directly (assume it's already in USDC)
- Otherwise:
  - Use `sizeInUSDC = size × price`

### Step 5: Check Alert Queue

Verify alerts are being stored:

```bash
# Connect to Redis
redis-cli

# Check alert queue
LRANGE alerts:queue 0 -1

# Look for whale_trade type
# Example:
{
  "type": "whale_trade",
  "marketId": "0xabc...",
  "outcomeId": "outcome-123",
  "tokenId": "123456789",
  "severity": "medium",
  "message": "WHALE TRADE: $15234.56 USDC",
  "data": {
    "tradeSize": 15234.56,
    "threshold": 10000
  },
  "timestamp": 1705068000000
}
```

### Step 6: Verify Database (if applicable)

If you want to cross-reference with market data:

```sql
-- Get outcome details for a token_id
SELECT 
  o.id as outcome_id,
  o.outcome as outcome_name,
  o.token_id,
  m.id as market_id,
  m.question as market_question,
  m.slug as market_slug
FROM outcomes o
JOIN markets m ON o.market_id = m.id
WHERE o.token_id = '123456789';
```

## Common Issues to Check

### Issue 1: Trades Not Detected

**Possible causes:**
1. Trade size < $10,000 (below threshold)
2. `sizeInUSDC` calculation is incorrect
3. Trade event not received from WebSocket
4. Outcome not found in database (trade silently ignored)

**Debug:**
- Check backend logs for trade events: `[Price Event]` or `[Trade Event]`
- Verify outcome exists: `SELECT * FROM outcomes WHERE token_id = '...'`
- Check if `finalSizeInUSDC` is calculated correctly

### Issue 2: False Positives

**Possible causes:**
1. `size` already in USDC but multiplied by price again
2. Edge case sanity check not working correctly
3. Price data is incorrect

**Debug:**
- Check if `size > 1000` AND `sizeInUSDC > size * 10`
- If true, the sanity check should use `size` directly
- Verify price is reasonable (0-1 range for probability markets)

### Issue 3: API Returns Wrong Trades

**Current issue:** The `/api/trades/whales` endpoint filters by `t.size` instead of `t.sizeInUSDC`.

**Fix needed:**
```typescript
// Current (line 43):
.filter(t => (t.size || 0) >= minSizeNum)

// Should be:
.filter(t => (t.sizeInUSDC || t.size || 0) >= minSizeNum)
```

## SQL Queries for Verification

### Find Recent Large Trades (if stored in database)

```sql
-- Note: Trades are stored in Redis, not database
-- But you can verify market/outcome data exists

-- Check outcomes with token_ids
SELECT 
  COUNT(*) as total_outcomes,
  COUNT(DISTINCT token_id) as unique_tokens
FROM outcomes
WHERE token_id IS NOT NULL AND token_id != '';

-- Check markets with high volume (potential whale activity)
SELECT 
  id,
  question,
  volume_24h,
  volume
FROM markets
WHERE volume_24h > 10000
ORDER BY volume_24h DESC
LIMIT 20;
```

## Testing the Detection

### Manual Test Case 1: Normal Trade (Should NOT trigger)

- `size`: `1,000` shares
- `price`: `0.50` USDC/share
- `sizeInUSDC`: `1,000 × 0.50 = $500`
- **Expected:** No whale alert (below $10k threshold)

### Manual Test Case 2: Whale Trade (Should trigger)

- `size`: `25,000` shares
- `price`: `0.50` USDC/share
- `sizeInUSDC`: `25,000 × 0.50 = $12,500`
- **Expected:** Whale alert generated (above $10k threshold)

### Manual Test Case 3: Edge Case (Size already in USDC)

- `size`: `15,000` (already in USDC)
- `price`: `0.01` USDC/share
- `sizeInUSDC`: `15,000 × 0.01 = $150` (wrong!)
- Sanity check: `size > 1000` AND `150 > 15000 * 10`? No
- **Expected:** Uses `sizeInUSDC = $150` (wrong calculation, but sanity check doesn't catch it)

**Note:** This edge case may need improvement in the sanity check logic.

## Summary

**Detection Criteria:**
- ✅ Single trade >= $10,000 USDC
- ✅ Uses `finalSizeInUSDC` (calculated from `size × price`)
- ✅ Stored in Redis with 24-hour TTL
- ✅ Alert generated and queued for notifications

**Verification Checklist:**
- [ ] Check backend logs for `[Whale Trade]` messages
- [ ] Verify `sizeInUSDC >= 10000` in Redis
- [ ] Query `/api/trades/whales` endpoint
- [ ] Check alert queue in Redis
- [ ] Manually verify calculation: `size × price = sizeInUSDC`
- [ ] Verify outcome exists in database

**Known Issues:**
- ⚠️ Edge case sanity check may not catch all scenarios where `size` is already in USDC
