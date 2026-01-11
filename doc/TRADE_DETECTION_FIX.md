# Trade Detection Fix - Critical Issue

## Problem Identified

**Issue:** The system was incorrectly using `price_change` messages to detect whale trades.

**Root Cause:** According to Polymarket documentation:
- `price_change` messages are emitted when:
  - A new order is placed
  - An order is cancelled
- These are **order book updates**, NOT executed trades
- The `size` field in `price_changes` represents **order size**, not executed trade size

## What Was Wrong

### Before (Incorrect):
1. Extracting "trade data" from `price_changes` array
2. Treating order sizes as trade execution sizes
3. This would trigger false whale trade alerts for large orders (even if not executed)

### Code Location:
- `backend/src/services/polymarket-client.ts:175-189` (REMOVED)
- `backend/src/services/polymarket-client.ts:192-204` (REMOVED)

## Correct Solution

### Actual Trade Execution Messages

Trade executions come from messages with `event_type: "last_trade_price"`:

```json
{
  "event_type": "last_trade_price",
  "asset_id": "...",
  "price": "0.184",
  "size": "172.3",
  "side": "BUY"
}
```

### Implementation

**Code Location:** `backend/src/services/polymarket-client.ts:164-180`

```typescript
// Check for actual trade execution messages (last_trade_price event type)
const eventType = (msg.event_type || msg.type) as string;
if (eventType === 'last_trade_price' || eventType === 'trade') {
  // This is an actual trade execution, not an order book update
  const tradeAssetId = (msg.asset_id || msg.token_id || msg.id) as string;
  const tradePrice = parseFloat(String(msg.price || msg.last_price || 0));
  const tradeSize = msg.size || msg.volume || msg.trade_size || msg.amount || msg.quantity;
  const tradeSide = msg.side || undefined;
  
  if (tradeAssetId && tradePrice > 0 && tradeSize) {
    this.emitTradeEvent(tradeAssetId, {
      price: tradePrice,
      size: parseFloat(String(tradeSize)),
      timestamp: Date.now(),
      side: tradeSide ? (tradeSide.toLowerCase() === 'buy' ? 'buy' : 'sell') : undefined,
    });
  }
}
```

## About `wsClient.onTrade()`

**Question:** "What does `wsClient.onTrade` coming from?"

**Answer:** `onTrade()` is a **handler registration method**, not a message filter.

**Code Location:** `backend/src/services/polymarket-client.ts:363-365`

```typescript
onTrade(assetId: string, handler: (data: PolymarketTradeEvent) => void): void {
  this.tradeHandlers.set(assetId, handler);
}
```

**How it works:**
1. `onTrade('*', handler)` registers a handler function
2. When `emitTradeEvent()` is called (after detecting a trade message), it invokes all registered handlers
3. The handler in `market-ingestion.ts:169` receives the trade event and processes it

**Flow:**
```
WebSocket Message → handleSingleMessage() 
  → Check event_type === 'last_trade_price' 
  → emitTradeEvent() 
  → Calls registered handlers (via onTrade)
  → handleTradeEvent() in market-ingestion.ts
```

## Impact

### Before Fix:
- ❌ Whale trades detected from order book updates (false positives)
- ❌ Large orders (not executed) could trigger whale alerts
- ❌ Inaccurate trade volume tracking

### After Fix:
- ✅ Only actual trade executions trigger whale detection
- ✅ Accurate trade size tracking
- ✅ No false positives from order placements

## Verification

To verify the fix is working:

1. **Check for `last_trade_price` messages:**
   ```bash
   grep "event_type.*last_trade_price" logs.txt
   ```

2. **Check whale trade detection:**
   ```bash
   grep "\[Whale Trade\]" logs.txt
   ```

3. **Enable debug mode:**
   Set `DEBUG_WEBSOCKET=true` to see full message structure

## Next Steps

1. ✅ Fixed code to only detect trades from `last_trade_price` messages
2. ✅ Removed incorrect extraction from `price_changes`
3. ✅ Updated documentation
4. ⚠️ **Need to verify:** Are we actually receiving `last_trade_price` messages?
   - If not, we may need to check Polymarket API documentation for the correct event type
   - Or we may need to use a different WebSocket endpoint/channel for trades

## Testing

After deployment, monitor:
- Are whale trade alerts still being generated?
- If not, we may not be receiving `last_trade_price` messages
- May need to investigate alternative trade data sources (REST API polling?)
