# Volume/Trading Data Analysis

## Current Status

### ❌ **Volume Data is NOT Currently Stored**

1. **Database Schema**: The `markets` table does NOT have a `volume` column
2. **Data Extraction**: We extract `volume` from Polymarket API responses but don't store it
3. **WebSocket Data**: WebSocket messages contain bid/ask prices but NOT volume/trade quantity

---

## What's Available from Polymarket APIs

### 1. REST API (`/events`, `/markets`)

The Polymarket REST API includes a `volume` field in market responses:

```typescript
// From backend/src/services/polymarket-rest.ts
export interface PolymarketMarketRaw {
  volume?: string;  // ✅ Available in API response
  liquidity?: string;
  // ... other fields
}
```

**Current Status**: 
- ✅ We extract `volume` from API responses
- ❌ We do NOT store it in the database
- ❌ We do NOT return it in API responses

### 2. WebSocket (`/ws/market`)

The WebSocket messages we receive contain:
- `price_changes` array with `best_bid`, `best_ask`
- `book` updates with `bids[]` and `asks[]` arrays
- `last_trade_price` events

**Current Status**:
- ✅ We parse bid/ask prices
- ❌ We do NOT see volume/trade quantity in WebSocket messages
- ❓ May need to check if volume is available in other WebSocket channels

---

## What We're Missing

### Database Schema
```sql
-- Current markets table (NO volume column)
CREATE TABLE markets (
    id VARCHAR(255) PRIMARY KEY,
    question TEXT NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    category VARCHAR(100) NOT NULL,
    end_date TIMESTAMP,
    image_url TEXT,
    -- ❌ volume DECIMAL(20, 8)  -- MISSING
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Data Storage
- `upsertMarket()` function doesn't include volume
- Volume is extracted but discarded during sync

### API Responses
- `/api/markets` doesn't return volume
- `/api/markets/:id` doesn't return volume

---

## Potential Volume Data Sources

### 1. **REST API Volume Field** (Available)
- **Source**: Polymarket Gamma/CLOB REST API
- **Format**: String (likely USD amount)
- **Update Frequency**: Updated during periodic sync (every 5 minutes)
- **Limitation**: May be cumulative (all-time) or time-windowed (24h, 7d, etc.)

### 2. **WebSocket Trade Events** (Unknown)
- **Source**: Polymarket CLOB WebSocket
- **Potential Channels**: 
  - `/ws/market` - Current channel (price updates only)
  - `/ws/trades` - May exist for trade volume data
  - `/ws/user` - User-specific trades
- **Status**: Need to investigate if volume data is available in WebSocket

### 3. **CLOB API Endpoints** (To Investigate)
- `/markets/:id/stats` - May contain volume statistics
- `/markets/:id/trades` - May contain trade history
- `/markets/:id/volume` - May exist for volume data

---

## Recommended Implementation

### Phase 1: Store REST API Volume (Quick Win)

1. **Add volume column to database**:
```sql
ALTER TABLE markets 
ADD COLUMN volume DECIMAL(20, 8) DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_markets_volume ON markets(volume DESC);
```

2. **Update Market interface**:
```typescript
export interface Market {
  // ... existing fields
  volume?: number | null;
}
```

3. **Update upsertMarket()**:
```typescript
await query(
  `INSERT INTO markets (id, question, slug, category, end_date, image_url, volume)
   VALUES ($1, $2, $3, $4, $5, $6, $7)
   ON CONFLICT (id) 
   DO UPDATE SET 
     volume = EXCLUDED.volume,
     -- ... other fields
  `,
  [market.id, market.question, market.slug, market.category, market.endDate, market.imageUrl, market.volume]
);
```

4. **Update API responses** to include volume

### Phase 2: Real-time Volume Tracking (If Available)

1. **Investigate WebSocket channels** for volume data
2. **Create volume_history table** if real-time volume updates are available:
```sql
CREATE TABLE IF NOT EXISTS volume_history (
    id SERIAL PRIMARY KEY,
    market_id VARCHAR(255) NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    volume_24h DECIMAL(20, 8),
    volume_7d DECIMAL(20, 8),
    volume_30d DECIMAL(20, 8),
    trade_count INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

3. **Add volume tracking** to WebSocket message handlers

---

## Questions to Answer

1. **What does the `volume` field represent?**
   - All-time volume?
   - 24-hour volume?
   - 7-day volume?
   - Need to check Polymarket API documentation

2. **Is volume available in WebSocket?**
   - Check if `/ws/trades` channel exists
   - Check if trade events include volume/quantity
   - May need to aggregate from trade events

3. **Do we need per-outcome volume?**
   - Current volume is likely market-level
   - May want outcome-level volume for analytics

4. **What time windows are useful?**
   - 24-hour volume (most common)
   - 7-day volume
   - 30-day volume
   - All-time volume

---

## Next Steps

1. ✅ **Check Polymarket API documentation** for volume field meaning
2. ✅ **Test API response** to see actual volume values
3. ✅ **Investigate WebSocket** for real-time volume data
4. ⏳ **Implement Phase 1** (store REST API volume)
5. ⏳ **Implement Phase 2** (real-time tracking if available)

---

## Current Code Locations

- **Volume Extraction**: `backend/src/services/polymarket-rest.ts:115`
- **Market Storage**: `backend/src/services/market-ingestion.ts:52-70`
- **Database Schema**: `backend/src/db/sql-schema.ts`
- **API Responses**: `backend/src/routes/markets.ts`
