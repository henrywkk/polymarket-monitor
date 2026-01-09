# Phase 1 Implementation Plan: Data Collection Enhancement

**Timeline:** Week 1-2 (6 days)  
**Goal:** Collect all necessary data for anomaly detection with sliding window storage

---

## Overview

Phase 1 focuses on enhancing our data collection capabilities to support the notification system. We'll extract trade data from the existing `market` WebSocket channel, enhance orderbook depth monitoring, implement Redis sliding windows with automatic cleanup, and integrate with the frontend.

---

## Task 1: WebSocket Trade Data Extraction (2 days)

### Current State
- ✅ Connected to `wss://ws-subscriptions-clob.polymarket.com/ws/market`
- ✅ Parsing `price_changes` and `book` updates
- ❌ Not extracting trade size/volume
- ❌ No trade history storage

### Implementation Steps

#### Step 1.1: Analyze WebSocket Message Structure
**File:** `backend/src/services/polymarket-client.ts`

**Action:**
1. Add logging to capture full WebSocket message structure
2. Check if trade data exists in:
   - `price_changes` array (may include `size`, `volume`, `trade_size`)
   - `book` updates (may include trade information)
   - Other message types we're not currently parsing

**Code Changes:**
```typescript
// Add to handleSingleMessage method
private handleSingleMessage(msg: any): void {
  // ... existing code ...
  
  // Log full message structure for analysis (temporary, remove after analysis)
  if (process.env.NODE_ENV === 'development') {
    console.log('[WebSocket Debug] Full message:', JSON.stringify(msg, null, 2));
  }
  
  // Check for trade data in price_changes
  if (Array.isArray(msg.price_changes)) {
    for (const pc of msg.price_changes) {
      // Check if trade size/volume is available
      const tradeSize = pc.size || pc.volume || pc.trade_size || pc.amount;
      if (tradeSize) {
        // Emit trade event
        this.emitTradeEvent(pc.asset_id || pc.token_id, {
          price: parseFloat(String(pc.best_bid || pc.best_ask || 0)),
          size: parseFloat(String(tradeSize)),
          timestamp: Date.now(),
        });
      }
    }
  }
}
```

#### Step 1.2: Create Trade Event Interface
**File:** `backend/src/services/polymarket-client.ts`

**Action:**
Add trade event interface and handler:

```typescript
export interface PolymarketTradeEvent {
  assetId: string;
  price: number;
  size: number; // Trade size in USDC
  timestamp: number;
  side?: 'buy' | 'sell'; // If available
}

// Add to PolymarketWebSocketClient class
private tradeHandlers: Map<string, (data: PolymarketTradeEvent) => void> = new Map();

private emitTradeEvent(assetId: string, trade: { price: number; size: number; timestamp: number }): void {
  const event: PolymarketTradeEvent = {
    assetId,
    price: trade.price,
    size: trade.size,
    timestamp: trade.timestamp,
  };
  
  const handler = this.tradeHandlers.get(assetId);
  if (handler) handler(event);
  
  const globalHandler = this.tradeHandlers.get('*');
  if (globalHandler) globalHandler(event);
}

onTrade(assetId: string, handler: (data: PolymarketTradeEvent) => void): void {
  this.tradeHandlers.set(assetId, handler);
}
```

#### Step 1.3: Store Trade History in Redis (Sliding Window)
**File:** `backend/src/services/market-ingestion.ts`

**Action:**
1. Create trade storage service with Redis ZSET
2. Store trades with timestamp as score
3. Auto-expire trades older than 24 hours
4. Keep last 100 trades per market

**Code:**
```typescript
// Add to MarketIngestionService
private async storeTradeHistory(assetId: string, trade: PolymarketTradeEvent): Promise<void> {
  const key = `trades:${assetId}`;
  const score = trade.timestamp;
  const value = JSON.stringify({
    price: trade.price,
    size: trade.size,
    timestamp: trade.timestamp,
  });
  
  // Add to sorted set
  await redis.zadd(key, score, value);
  
  // Keep only last 100 trades (remove oldest if exceeds)
  const count = await redis.zcard(key);
  if (count > 100) {
    // Remove oldest entries (keep last 100)
    await redis.zremrangebyrank(key, 0, count - 101);
  }
  
  // Set TTL to 24 hours
  await redis.expire(key, 86400);
}
```

#### Step 1.4: Fallback to REST API (If WebSocket Lacks Trade Data)
**File:** `backend/src/services/polymarket-rest.ts`

**Action:**
If WebSocket doesn't provide trade data, poll REST API for recent trades:
- Check CLOB API for trade history endpoints
- Poll every 30 seconds for active markets
- Store in Redis with same sliding window logic

---

## Task 2: Orderbook Depth Analysis (2 days)

### Current State
- ✅ Receiving `book` events with `bids[]` and `asks[]`
- ❌ Not calculating spread or depth
- ❌ Not tracking depth changes

### Implementation Steps

#### Step 2.1: Enhance Book Event Handler
**File:** `backend/src/services/polymarket-client.ts`

**Action:**
Extract full orderbook data:

```typescript
// Add to handleSingleMessage
if (Array.isArray(msg.bids) && Array.isArray(msg.asks)) {
  const assetId = msg.asset_id || msg.token_id;
  if (assetId) {
    this.emitOrderbookEvent(assetId, {
      bids: msg.bids,
      asks: msg.asks,
      timestamp: Date.now(),
    });
  }
}
```

#### Step 2.2: Calculate Spread and Depth
**File:** `backend/src/services/market-ingestion.ts`

**Action:**
Create orderbook analysis service:

```typescript
interface OrderbookMetrics {
  spread: number; // bid-ask spread in cents
  spreadPercent: number; // spread as % of mid-price
  depth2Percent: number; // Total depth within 2% of mid-price
  bestBid: number;
  bestAsk: number;
  midPrice: number;
}

private calculateOrderbookMetrics(bids: any[], asks: any[]): OrderbookMetrics {
  const bestBid = parseFloat(String(bids[0]?.price || bids[0] || 0));
  const bestAsk = parseFloat(String(asks[0]?.price || asks[0] || 0));
  const midPrice = (bestBid + bestAsk) / 2;
  const spread = bestAsk - bestBid;
  const spreadPercent = midPrice > 0 ? (spread / midPrice) * 100 : 0;
  
  // Calculate depth within 2% of mid-price
  const twoPercentRange = midPrice * 0.02;
  const minPrice = midPrice - twoPercentRange;
  const maxPrice = midPrice + twoPercentRange;
  
  let depth2Percent = 0;
  // Sum bid depth within range
  for (const bid of bids) {
    const price = parseFloat(String(bid.price || bid));
    if (price >= minPrice && price <= midPrice) {
      const size = parseFloat(String(bid.size || bid.amount || 1));
      depth2Percent += size;
    }
  }
  // Sum ask depth within range
  for (const ask of asks) {
    const price = parseFloat(String(ask.price || ask));
    if (price >= midPrice && price <= maxPrice) {
      const size = parseFloat(String(ask.size || ask.amount || 1));
      depth2Percent += size;
    }
  }
  
  return {
    spread,
    spreadPercent,
    depth2Percent,
    bestBid,
    bestAsk,
    midPrice,
  };
}
```

#### Step 2.3: Store Orderbook Metrics in Redis
**File:** `backend/src/services/market-ingestion.ts`

**Action:**
Store metrics with sliding window:

```typescript
private async storeOrderbookMetrics(assetId: string, metrics: OrderbookMetrics): Promise<void> {
  const key = `orderbook:${assetId}`;
  const score = Date.now();
  const value = JSON.stringify(metrics);
  
  await redis.zadd(key, score, value);
  
  // Keep last 60 minutes of data (3600 seconds)
  const oneHourAgo = Date.now() - 3600000;
  await redis.zremrangebyscore(key, 0, oneHourAgo);
  
  // Set TTL to 2 hours
  await redis.expire(key, 7200);
}
```

---

## Task 3: Enhanced Redis Storage with Sliding Windows (2 days)

### Implementation Steps

#### Step 3.1: Create Redis Storage Service
**File:** `backend/src/services/redis-storage.ts` (new file)

**Action:**
Create a centralized service for Redis sliding windows:

```typescript
import { redis } from '../config/redis';

export class RedisSlidingWindow {
  /**
   * Add data point to time-series with automatic cleanup
   * @param key Redis key
   * @param value Data to store (will be JSON stringified)
   * @param maxAgeMs Maximum age in milliseconds (older data auto-removed)
   * @param maxItems Maximum number of items to keep
   */
  static async add(
    key: string,
    value: any,
    maxAgeMs: number = 3600000, // 1 hour default
    maxItems: number = 1000
  ): Promise<void> {
    const score = Date.now();
    const stringValue = JSON.stringify(value);
    
    // Add to sorted set
    await redis.zadd(key, score, stringValue);
    
    // Remove old data
    const cutoffTime = Date.now() - maxAgeMs;
    await redis.zremrangebyscore(key, 0, cutoffTime);
    
    // Limit items if exceeds maxItems
    const count = await redis.zcard(key);
    if (count > maxItems) {
      await redis.zremrangebyrank(key, 0, count - maxItems - 1);
    }
    
    // Set TTL slightly longer than maxAgeMs
    await redis.expire(key, Math.ceil(maxAgeMs / 1000) + 3600);
  }
  
  /**
   * Get data points within time range
   */
  static async getRange(
    key: string,
    startTime: number,
    endTime: number
  ): Promise<any[]> {
    const results = await redis.zrangebyscore(key, startTime, endTime);
    return results.map(r => JSON.parse(r));
  }
  
  /**
   * Get latest N data points
   */
  static async getLatest(key: string, count: number): Promise<any[]> {
    const results = await redis.zrevrange(key, 0, count - 1);
    return results.map(r => JSON.parse(r));
  }
  
  /**
   * Get all data points (use with caution)
   */
  static async getAll(key: string): Promise<any[]> {
    const results = await redis.zrange(key, 0, -1);
    return results.map(r => JSON.parse(r));
  }
}
```

#### Step 3.2: Update Trade History Storage
**File:** `backend/src/services/market-ingestion.ts`

**Action:**
Use RedisSlidingWindow for trade storage:

```typescript
import { RedisSlidingWindow } from './redis-storage';

// In handleTradeEvent or similar method
await RedisSlidingWindow.add(
  `trades:${assetId}`,
  {
    price: trade.price,
    size: trade.size,
    timestamp: trade.timestamp,
  },
  86400000, // 24 hours
  100 // Max 100 trades
);
```

#### Step 3.3: Update Price History Storage
**File:** `backend/src/services/market-ingestion.ts`

**Action:**
Use sliding window for price history (60 minutes):

```typescript
await RedisSlidingWindow.add(
  `prices:${marketId}:${outcomeId}`,
  {
    bid: price.bid,
    ask: price.ask,
    mid: midPrice,
    probability: impliedProbability,
    timestamp: Date.now(),
  },
  3600000, // 60 minutes
  3600 // Max 3600 data points (1 per second)
);
```

---

## Task 4: Frontend Integration (1 day)

### Implementation Steps

#### Step 4.1: Add Trade Event to WebSocket Server
**File:** `backend/src/services/websocket-server.ts`

**Action:**
Broadcast trade events to frontend:

```typescript
// In WebSocketServer class
public broadcastTrade(trade: PolymarketTradeEvent): void {
  this.io.emit('trade_update', {
    assetId: trade.assetId,
    marketId: trade.marketId, // Need to map assetId to marketId
    price: trade.price,
    size: trade.size,
    timestamp: trade.timestamp,
  });
}
```

#### Step 4.2: Add Trade History API Endpoint
**File:** `backend/src/routes/markets.ts`

**Action:**
Create endpoint for trade history:

```typescript
router.get('/:id/trades', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { timeframe = '1h' } = req.query;
    
    // Get outcome token IDs for this market
    const outcomes = await query(
      'SELECT token_id FROM outcomes WHERE market_id = $1',
      [id]
    );
    
    if (outcomes.rows.length === 0) {
      return res.json({ data: [] });
    }
    
    // Get trades from Redis for all outcomes
    const allTrades: any[] = [];
    for (const outcome of outcomes.rows) {
      const trades = await RedisSlidingWindow.getLatest(
        `trades:${outcome.token_id}`,
        100
      );
      allTrades.push(...trades.map(t => ({
        ...t,
        tokenId: outcome.token_id,
      })));
    }
    
    // Sort by timestamp descending
    allTrades.sort((a, b) => b.timestamp - a.timestamp);
    
    return res.json({
      data: allTrades.slice(0, 100), // Return latest 100
    });
  } catch (error) {
    console.error('Error fetching trade history:', error);
    return res.status(500).json({ error: 'Failed to fetch trade history' });
  }
});
```

#### Step 4.3: Add Frontend Hook for Trade Updates
**File:** `frontend/src/hooks/useRealtimeTrades.ts` (new file)

**Action:**
Create hook for real-time trade updates:

```typescript
import { useState, useEffect } from 'react';
import { wsService } from '../services/websocket';

export interface TradeUpdate {
  assetId: string;
  marketId: string;
  price: number;
  size: number;
  timestamp: number;
}

export const useRealtimeTrades = (marketId?: string) => {
  const [trades, setTrades] = useState<TradeUpdate[]>([]);
  
  useEffect(() => {
    if (!marketId) return;
    
    wsService.connect();
    
    const handleTradeUpdate = (data: unknown) => {
      const trade = data as TradeUpdate;
      if (trade.marketId === marketId) {
        setTrades(prev => [trade, ...prev].slice(0, 50)); // Keep last 50
      }
    };
    
    wsService.on('trade_update', handleTradeUpdate);
    
    return () => {
      wsService.off('trade_update', handleTradeUpdate);
    };
  }, [marketId]);
  
  return trades;
};
```

#### Step 4.4: Optional: Display Trade Activity in UI
**File:** `frontend/src/components/MarketDetail.tsx`

**Action:**
Add trade activity section (optional, can be added later):

```typescript
// Add trade activity display if needed
const trades = useRealtimeTrades(market?.id);

// Display recent trades in a table or list
```

---

## Testing Plan

### Unit Tests
1. Test RedisSlidingWindow.add() with various maxAge and maxItems
2. Test orderbook metrics calculation
3. Test trade event parsing

### Integration Tests
1. Test WebSocket trade data extraction
2. Test Redis storage and cleanup
3. Test API endpoints for trade history

### Manual Testing
1. Monitor WebSocket messages for trade data
2. Verify Redis keys are created and cleaned up
3. Check frontend receives trade updates (if implemented)

---

## Success Criteria

✅ **Task 1 Complete:**
- Trade data extracted from WebSocket messages (or REST API fallback)
- Trade history stored in Redis with sliding windows
- Last 100 trades per market maintained
- Old trades auto-expired after 24 hours

✅ **Task 2 Complete:**
- Orderbook depth calculated (spread, depth within 2%)
- Metrics stored in Redis with 60-minute sliding window
- Depth changes tracked over time

✅ **Task 3 Complete:**
- RedisSlidingWindow service implemented
- All time-series data uses sliding windows
- Automatic cleanup working
- Memory usage controlled

✅ **Task 4 Complete:**
- Frontend can receive trade updates (if applicable)
- API endpoint for trade history working
- Optional UI components added

---

## Risk Mitigation

1. **WebSocket doesn't provide trade data:**
   - Fallback to REST API polling
   - Document findings and adjust plan

2. **Redis memory concerns:**
   - Monitor memory usage
   - Adjust maxItems and maxAge as needed
   - Implement Redis memory limits

3. **Performance issues:**
   - Use async/await properly
   - Batch Redis operations where possible
   - Monitor Redis operation latency

---

## Next Steps After Phase 1

Once Phase 1 is complete, we'll have:
- Trade data collection working
- Orderbook depth monitoring active
- Redis sliding windows operational
- Foundation for Phase 2 (Anomaly Detection)

Phase 2 will use this data to:
- Calculate Z-scores for volume acceleration
- Detect price velocity (15% in <1min)
- Detect fat fingers (30% deviation)
- Monitor liquidity vacuums (spread >10 cents)
- Detect whale trades (>$10k)
