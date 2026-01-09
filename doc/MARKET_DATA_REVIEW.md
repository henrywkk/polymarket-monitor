# Polymarket Market Data Pulling Mechanism - Review

## Overview
This document reviews how we pull market data from Polymarket, including APIs used, data sources, filters, and synchronization frequency.

---

## 1. Data Pulling Mechanism

### Two-Tier Architecture

#### **Tier 1: Initial Market Metadata (REST API)**
- **Purpose**: Fetch market metadata, outcomes, and initial prices
- **Service**: `MarketSyncService` + `PolymarketRestClient`
- **Trigger**: Scheduled periodic sync + initial sync on startup

#### **Tier 2: Real-Time Price Updates (WebSocket)**
- **Purpose**: Receive live price changes (bid/ask) for subscribed markets
- **Service**: `PolymarketWebSocketClient` + `MarketIngestionService`
- **Trigger**: Continuous connection, subscribes to asset_ids (token IDs)

---

## 2. APIs Used

### **REST APIs**

#### **Primary: Gamma API** (`https://gamma-api.polymarket.com`)
- **Endpoint**: `/events`
- **Purpose**: Fetch market metadata, outcomes, and nested sub-markets
- **Features**:
  - Supports filtering by `tag_id` or `tag_slug`
  - Supports `active` and `closed` filters
  - Returns nested `markets` array for multi-outcome events
  - Provides bucket names in `groupItemTitle` field
  - Returns `clobTokenIds` (JSON array) for each sub-market

#### **Secondary: CLOB API** (`https://clob.polymarket.com`)
- **Endpoints**:
  - `/markets/{id}` - Market details
  - `/v2/markets/{id}` - Alternative market endpoint
- **Purpose**: Fetch token IDs (asset_ids) and order book data
- **Used for**: Extracting `token_id` values when Gamma API doesn't provide them

#### **Fallback: API V2** (`https://api.polymarket.com`)
- **Endpoints**:
  - `/v2/markets`
  - `/markets`
- **Purpose**: Fallback if Gamma API fails

### **WebSocket API**

#### **CLOB WebSocket** (`wss://ws-subscriptions-clob.polymarket.com/ws/market`)
- **Protocol**: WebSocket
- **Purpose**: Real-time price updates (bid/ask)
- **Subscription Format**:
  ```json
  {
    "operation": "subscribe",
    "assets_ids": ["token_id_1", "token_id_2", ...]
  }
  ```
- **Message Format**: 
  - `price_changes` array with `asset_id`, `best_bid`, `best_ask`
  - Individual price update objects

---

## 3. What Data We Pull

### **Market-Level Data**
- `id` (conditionId/questionId)
- `question` (market title)
- `slug` (URL-friendly identifier)
- `category` (detected or from tags)
- `end_date` / `endDateISO` (estimated end date)
- `image_url` (market image)
- `volume` (total volume)
- `volume24h` (24-hour volume)
- `liquidity` (liquidity score)
- `activityScore` (calculated from volume24h)

### **Outcome-Level Data**
- `id` (outcome ID, usually token_id)
- `token_id` (asset_id for WebSocket subscription)
- `outcome` (outcome name: "Yes"/"No" or bucket name like "<0.5%")
- `volume` (outcome total volume)
- `volume24h` (outcome 24-hour volume)
- `price` (initial price if available)

### **Price Data (Real-Time)**
- `bid` (best bid price)
- `ask` (best ask price)
- `mid_price` (calculated: (bid + ask) / 2)
- `implied_probability` (calculated from bid/ask)
- `timestamp` (when price was received)

---

## 4. Filters Applied

### **Category-Based Filtering**
We fetch markets from multiple categories to ensure diversity:

1. **Crypto** (main tag + sub-tags):
   - Main tag: `tag_slug: 'crypto'`
   - Sub-tags: `bitcoin`, `ethereum`, `solana`, `xrp`, `dogecoin`, `microstrategy`
   
2. **Politics**: `tag_slug: 'politics'`

3. **Sports**: `tag_slug: 'sports'`

4. **All Markets**: No tag filter (fallback)

### **Status Filters**
- `active: true` - Only fetch active markets
- `closed: false` - Exclude closed markets

### **Smart Sync Filter**
- Only updates markets that have changed (compares `question`, `slug`, `category`, `end_date`, `image_url`)
- Skips markets with no changes to reduce database writes

### **Deduplication**
- Uses `Set<string>` to track seen market IDs
- Prevents duplicate markets across different tag fetches

---

## 5. Synchronization Frequency

### **Periodic Sync Service** (`PeriodicSyncService`)

#### **Default Interval**: 5 minutes
- Configurable via `SYNC_INTERVAL_MINUTES` environment variable
- Default: 5 minutes (300,000 ms)

#### **Sync Process**:
1. **Initial Sync**: Runs immediately on server startup
   - Fetches up to 500 markets
   - Categorizes and stores in database
   - Subscribes to WebSocket for real-time updates

2. **Periodic Sync**: Runs every 5 minutes (default)
   - Fetches up to 500 markets
   - Uses "smart sync" to only update changed markets
   - Re-subscribes to WebSocket if new markets are added

3. **Stats Snapshots**: Every 3 sync cycles (~15 minutes)
   - Takes snapshot of market statistics (volume, liquidity, avg price)
   - Stores in `market_stats_history` table
   - Used for alert detection (volume spikes, etc.)

4. **Maintenance Tasks**: Every 72 sync cycles (~6 hours)
   - Prunes old price history (keeps last 1 day / 24 hours)
   - Cleans up database

### **Real-Time Updates (WebSocket)**
- **Connection**: Continuous (reconnects on failure)
- **Update Frequency**: As events occur (no polling)
- **Price Persistence**: 
  - Throttled: Persists to DB at most once per minute per outcome
  - OR if price changes by >1% (threshold: 0.01)
- **Broadcast**: Immediately broadcasts to connected frontend clients

---

## 6. Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    Server Startup                            │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Initial Market Sync (REST API)                             │
│  - Fetch 500 markets from Gamma API                        │
│  - Filter by categories (Crypto, Politics, Sports, All)    │
│  - Extract outcomes and token IDs                           │
│  - Store in PostgreSQL                                      │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  WebSocket Connection                                        │
│  - Connect to CLOB WebSocket                                 │
│  - Subscribe to all token_ids (asset_ids)                   │
│  - Listen for price_changes events                           │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Periodic Sync (Every 5 minutes)                           │
│  - Fetch new/changed markets                                │
│  - Update database                                          │
│  - Subscribe to new markets' token_ids                      │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Real-Time Price Updates (Continuous)                       │
│  - Receive price_changes from WebSocket                     │
│  - Update Redis cache (for fast frontend access)            │
│  - Persist to price_history table (throttled)               │
│  - Broadcast to frontend via Socket.IO                     │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. Key Implementation Details

### **Market ID Resolution**
- Priority order: `conditionId` > `questionId` > `id` > `tokenId`
- Used as primary key in database

### **Outcome Extraction**
1. **From Gamma API**: Extract from `tokens` or `outcomes` array
2. **From Nested Markets**: For multi-outcome events, extract from `markets` array
   - Bucket name from `groupItemTitle`
   - Token IDs from `clobTokenIds` (JSON array)
3. **Fallback**: Fetch from CLOB API `/markets/{id}` if not available

### **Price Initialization**
- If outcome has initial price: Use it
- Binary markets: Default to 0.5 (50%)
- Multi-outcome markets: Default to `1 / outcome_count` (equal probability)

### **WebSocket Subscription**
- Subscribes to `asset_ids` (token_ids), not market IDs
- One market can have multiple asset_ids (one per outcome)
- Batch subscription: Sends all asset_ids in one message (debounced 500ms)

---

## 8. Configuration

### **Environment Variables**
- `SYNC_INTERVAL_MINUTES`: Periodic sync interval (default: 5)
- `POLYMARKET_WS_URL`: WebSocket URL (default: CLOB WebSocket)

### **Constants**
- `PERSIST_INTERVAL_MS`: 60,000 (1 minute)
- `PRICE_CHANGE_THRESHOLD`: 0.01 (1%)
- `MAX_MARKETS_PER_SYNC`: 500
- `PRICE_HISTORY_RETENTION_DAYS`: 1

---

## 9. Limitations & Notes

### **Current Limitations**

#### **⚠️ CRITICAL: Limited Market Discovery**
1. **Only 500 Markets Fetched Initially**:
   - Total limit: 500 markets per sync cycle
   - Split across 10 fetch operations (~50 markets each):
     - Crypto (main tag): ~50 markets
     - Crypto sub-tags (6 tags): ~50 markets each
     - Politics: ~50 markets
     - Sports: ~50 markets
     - All markets: ~50 markets
   - **Problem**: If Polymarket has thousands of active markets, we only see the first 500
   - **No Pagination**: Always uses `offset: 0`, so we only get the first page of results
   - **No Market Discovery**: After initial sync, we only check for changes in markets we already know about
   - **Missing Markets**: Markets that don't appear in the first page of tag-based results are never discovered

2. **Tag-Based Filtering Limitations**:
   - Markets without the tags we search for (crypto, politics, sports) may be missed
   - The "All" category fetch is limited to ~50 markets (one page)
   - Markets in other categories (e.g., "Entertainment", "Tech", "Economy") are underrepresented

3. **Smart Sync Only Updates Known Markets**:
   - `hasMarketChanged()` only checks markets we've already seen
   - New markets that appear later are only discovered if they happen to be in our tag-based fetch
   - Markets that fall off the first page are lost

#### **Other Limitations**
4. **Active Markets Count**: Only counts active markets from current page (frontend limitation)
   - TODO: Create separate API endpoint for true active market count

5. **Market End Date**: Treated as estimate (not absolute)
   - Markets can be extended by Polymarket adding new outcomes
   - Frontend shows "Est. ends in X days" instead of "Ended"

6. **WebSocket Reconnection**: Automatic with exponential backoff
   - Max 10 reconnection attempts
   - Re-subscribes to all assets on reconnect

7. **Price History Throttling**: 
   - Persists at most once per minute per outcome
   - OR if price changes by >1%
   - This reduces database writes but may miss some price movements

### **Data Quality**
- Markets without `conditionId` or `questionId` are skipped
- Outcomes without `token_id` cannot receive real-time updates
- Binary markets default to "Yes"/"No" if outcomes not found

---

## 10. Summary

**Data Sources**:
- ✅ Gamma API (`/events`) - Primary for market metadata
- ✅ CLOB API (`/markets/{id}`) - For token IDs and order books
- ✅ CLOB WebSocket - For real-time price updates

**Frequency**:
- ✅ Initial sync on startup
- ✅ Periodic sync every 5 minutes (configurable)
- ✅ Real-time price updates via WebSocket (continuous)

**Filters**:
- ✅ Category-based (Crypto, Politics, Sports, All)
- ✅ Active markets only (`active: true, closed: false`)
- ✅ Smart sync (only updates changed markets)

**Data Pulled**:
- ✅ Market metadata (question, category, end_date, volume, liquidity)
- ✅ Outcomes (names, token_ids, volumes)
- ✅ Real-time prices (bid/ask) via WebSocket
