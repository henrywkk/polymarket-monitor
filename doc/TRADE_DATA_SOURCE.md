# Trade Data Source - WebSocket API

## Overview

Trade data comes from **WebSocket API**, not REST API. The system connects to Polymarket's CLOB WebSocket to receive real-time trade events.

## WebSocket Connection

**URL:** `wss://ws-subscriptions-clob.polymarket.com/ws/market`

**Protocol:** WebSocket (WSS)

**Connection:** Established in `backend/src/services/polymarket-client.ts`

## Subscription Format

### Subscription Message

When subscribing to assets (token IDs), the client sends:

```json
{
  "operation": "subscribe",
  "assets_ids": ["token_id_1", "token_id_2", "token_id_3", ...]
}
```

**Key Points:**
- `operation`: Always `"subscribe"` for subscribing to assets
- `assets_ids`: Array of token IDs (asset IDs) to subscribe to
- Each token ID corresponds to one outcome in a market
- Multiple assets can be subscribed in a single message (batched)

**Example:**
```json
{
  "operation": "subscribe",
  "assets_ids": [
    "91737931954079461205792748723730956466398437395923414328893692961489566016241",
    "90954386001801116059251303598368900188182195794057114134644084985964418752977"
  ]
}
```

## Trade Data Message Format

Trade data is extracted from WebSocket messages in **two ways**:

### Method 1: From `price_changes` Array (Most Common)

When the WebSocket receives a message with a `price_changes` array, trade data is extracted from each price change object:

**Message Format:**
```json
{
  "market": "0xa0eafdfa7da17483796f77f4b287d28834ab97db4a9a6e999b52c1ba239bc2f3",
  "price_changes": [
    {
      "asset_id": "91737931954079461205792748723730956466398437395923414328893692961489566016241",
      "price": "0.184",
      "size": "172.3",
      "side": "BUY",
      "hash": "38b297cfb08e7765beb52efef87565c4cee2edd1",
      "best_bid": "0.184",
      "best_ask": "0.186"
    }
  ]
}
```

**Trade Data Extraction:**
- `asset_id` → Used as `tokenId` (identifies the outcome)
- `size` → Trade size (in shares, not USDC)
- `price` → Trade price (or uses `best_bid`/`best_ask` if price not present)
- `side` → Trade side: `"BUY"` or `"SELL"`

**Code Location:** `backend/src/services/polymarket-client.ts:166-189`

```typescript
if (Array.isArray(msg.price_changes)) {
  for (const pc of msg.price_changes) {
    const pcAssetId = (pc.asset_id || pc.token_id) as string;
    
    // Extract trade data if present
    const tradeSize = pc.size || pc.volume || pc.trade_size || pc.amount || pc.quantity;
    if (tradeSize && pcAssetId) {
      const tradePrice = bid || ask || parseFloat(String(pc.price || pc.last_price || 0));
      if (tradePrice > 0) {
        this.emitTradeEvent(pcAssetId, {
          price: tradePrice,
          size: parseFloat(String(tradeSize)),
          timestamp: Date.now(),
          side: pc.side || (bid > 0 ? 'buy' : 'sell'),
        });
      }
    }
  }
}
```

### Method 2: Direct Trade Message

If the message contains trade fields directly (not in `price_changes` array):

**Message Format:**
```json
{
  "asset_id": "91737931954079461205792748723730956466398437395923414328893692961489566016241",
  "size": "172.3",
  "price": "0.184",
  "side": "BUY"
}
```

**Trade Data Extraction:**
- `asset_id` or `token_id` or `id` → Used as token ID
- `size` or `volume` or `trade_size` or `amount` or `quantity` → Trade size
- `price` or `last_price` or `best_bid` or `best_ask` → Trade price
- `side` → Trade side (optional)

**Code Location:** `backend/src/services/polymarket-client.ts:192-204`

```typescript
const tradeSize = msg.size || msg.volume || msg.trade_size || msg.amount || msg.quantity;
if (tradeSize && assetId) {
  const tradePrice = parseFloat(String(msg.price || msg.last_price || msg.best_bid || msg.best_ask || 0));
  if (tradePrice > 0) {
    this.emitTradeEvent(assetId, {
      price: tradePrice,
      size: parseFloat(String(tradeSize)),
      timestamp: Date.now(),
      side: msg.side || undefined,
    });
  }
}
```

## Trade Event Processing

Once extracted, trade events are processed in:

**File:** `backend/src/services/market-ingestion.ts:625-697`

**Flow:**
1. `handleTradeEvent()` receives `PolymarketTradeEvent`
2. Looks up outcome by `token_id` (asset_id) in database
3. Calculates USDC value: `sizeInUSDC = size × price`
4. Stores in Redis sliding window: `trades:{token_id}`
5. Detects whale trades (>= $10k USDC)
6. Broadcasts to frontend via WebSocket server

## Channel/Subscription Details

**Important:** Trade executions come from messages with `event_type: "last_trade_price"`.

**Subscription:** Subscribe to asset IDs (token IDs), and you'll receive:
- Price updates (`price_changes` messages - order book updates)
- **Trade executions** (`last_trade_price` messages - actual trades)
- Orderbook updates (if available)

**Key Distinction:**
- `price_change` → Order book updates (orders placed/cancelled) - **NOT trades**
- `last_trade_price` → Actual trade executions - **USE THIS for whale detection**

## Example Real WebSocket Messages

### Example 1: Actual Trade Execution (last_trade_price)

```json
{
  "event_type": "last_trade_price",
  "asset_id": "91737931954079461205792748723730956466398437395923414328893692961489566016241",
  "price": "0.184",
  "size": "172.3",
  "side": "BUY",
  "timestamp": "1705068000000"
}
```

**Extracted Trade:**
- `assetId`: `"91737931954079461205792748723730956466398437395923414328893692961489566016241"`
- `size`: `172.3` (shares)
- `price`: `0.184` (USDC per share)
- `side`: `"BUY"`
- `sizeInUSDC`: `172.3 × 0.184 = $31.70`

**✅ This is a real trade execution - use for whale detection**

### Example 2: Order Book Update (price_change) - NOT a Trade

```json
{
  "event_type": "price_change",
  "market": "0xa0eafdfa7da17483796f77f4b287d28834ab97db4a9a6e999b52c1ba239bc2f3",
  "price_changes": [
    {
      "asset_id": "91737931954079461205792748723730956466398437395923414328893692961489566016241",
      "best_bid": "0.184",
      "best_ask": "0.186",
      "size": "172.3"
    }
  ]
}
```

**⚠️ This is NOT a trade execution** - it's an order book update (order placed/cancelled)
- The `size` field here represents order size, not executed trade size
- **DO NOT use this for whale trade detection**

### Example 2: Orderbook Update (No Trade Data)

```json
{
  "market": "0xe93c89c41d1bb08d3bb40066d8565df301a696563b2542256e6e8bbbb1ec490d",
  "asset_id": "112838095111461683880944516726938163688341306245473734071798778736646352193304",
  "bids": [
    {"price": "0.001", "size": "13265.99"},
    {"price": "0.002", "size": "256.36"}
  ],
  "asks": [
    {"price": "0.999", "size": "11005428.06"}
  ]
}
```

**Note:** This message contains orderbook data but **no trade data** (no `size` field in the root or `price_changes`).

## Summary

| Aspect | Details |
|--------|---------|
| **Source** | WebSocket API (not REST) |
| **URL** | `wss://ws-subscriptions-clob.polymarket.com/ws/market` |
| **Channel** | No separate "trades" channel - embedded in price/market updates |
| **Subscription** | Subscribe to asset IDs (token IDs) |
| **Message Types** | `price_changes` array (most common) or direct trade fields |
| **Trade Fields** | `size`, `price`, `side`, `asset_id` |
| **Processing** | Extracted in `polymarket-client.ts`, processed in `market-ingestion.ts` |

## Verification

To verify trade data is being received:

1. **Check Backend Logs:**
   ```bash
   grep "\[WebSocket Raw\]" logs.txt | grep "price_changes"
   ```

2. **Check Trade Processing:**
   ```bash
   grep "\[Price Event\]" logs.txt
   grep "\[Whale Trade\]" logs.txt
   ```

3. **Enable Debug Mode:**
   Set environment variable: `DEBUG_WEBSOCKET=true`
   This will log full WebSocket messages for analysis.
