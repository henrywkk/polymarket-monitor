# Backend Error Analysis - "Outcome not found" Errors

## Summary

The backend logs show frequent `Outcome not found for asset_id` warnings. After analysis, these are **mostly expected** but there are some **logic issues** that should be fixed.

---

## Error Pattern

```
[err] Outcome not found for asset_id <long_number> (market: <same_long_number>)
```

**Frequency**: ~40+ occurrences in a 4-minute log window

---

## Root Cause Analysis

### 1. **Expected Behavior (Not Concerning)**

We receive WebSocket price updates for asset_ids (token_ids) that:
- Haven't been synced to our database yet
- Are from markets we haven't discovered (outside our 2000 market limit)
- Were created on Polymarket after our last sync
- Are from markets we subscribed to but outcomes weren't fully synced

**Why this happens**:
- WebSocket connects and subscribes to asset_ids from synced markets
- Polymarket may send updates for all subscribed asset_ids, including ones we haven't fully processed
- There's a race condition: WebSocket can receive updates before market sync completes

### 2. **Logic Error (Concerning)**

**Location**: `backend/src/services/market-ingestion.ts:206-216`

**Problem**: The alternative lookup logic is flawed:

```typescript
if (outcomeResult.rows.length === 0) {
  // Try alternative lookup by market_id if asset_id lookup fails
  const altResult = await query(
    'SELECT id, market_id, token_id FROM outcomes WHERE market_id = $1 AND token_id = $2',
    [marketId, outcomeId]  // ❌ marketId is actually an assetId, not a market ID!
  );
```

**Why it's wrong**:
- In `polymarket-client.ts:189`, the WebSocket event sets `market: assetId` (not the actual market ID)
- So `marketId` in the price event handler is actually an `assetId` (token_id)
- The alternative lookup will **always fail** because it's looking for `market_id = assetId`, which doesn't exist
- This lookup is redundant and wastes a database query

---

## Impact Assessment

### ✅ **Not Concerning**
- Errors are warnings, not crashes
- System continues to function normally
- Price updates for known markets still work
- Most errors are for markets we legitimately haven't synced

### ⚠️ **Concerning**
- **Logic error**: Flawed alternative lookup wastes database queries
- **Log noise**: Too many warnings make it hard to spot real issues
- **Missing markets**: We might be missing price updates for markets we should have synced

---

## Recommended Fixes

### 1. **Remove Flawed Alternative Lookup** (High Priority)

The alternative lookup by `marketId` is incorrect and should be removed:

```typescript
// Current (WRONG):
if (outcomeResult.rows.length === 0) {
  const altResult = await query(
    'SELECT id, market_id, token_id FROM outcomes WHERE market_id = $1 AND token_id = $2',
    [marketId, outcomeId]  // marketId is actually assetId!
  );
  if (altResult.rows.length === 0) {
    console.warn(`Outcome not found...`);
    return;
  }
}

// Should be:
if (outcomeResult.rows.length === 0) {
  // No alternative lookup needed - if token_id lookup fails, outcome doesn't exist
  console.warn(`Outcome not found for asset_id ${outcomeId}`);
  return;
}
```

### 2. **Reduce Log Noise** (Medium Priority)

Track which asset_ids we've already warned about to avoid spam:

```typescript
private warnedAssetIds = new Set<string>();

if (outcomeResult.rows.length === 0) {
  // Only warn once per asset_id per hour
  if (!this.warnedAssetIds.has(outcomeId)) {
    console.warn(`Outcome not found for asset_id ${outcomeId} (first occurrence)`);
    this.warnedAssetIds.add(outcomeId);
    // Clear after 1 hour to allow re-warning if issue persists
    setTimeout(() => this.warnedAssetIds.delete(outcomeId), 3600000);
  }
  return;
}
```

### 3. **Auto-Sync Missing Markets** (Low Priority - Future Enhancement)

When we receive price updates for unknown asset_ids, we could:
- Track which asset_ids we're receiving updates for
- Periodically sync those markets to discover them
- This would help us discover markets we're missing

---

## Current Status

**System Health**: ✅ **Healthy**
- Errors are warnings, not failures
- Core functionality works
- Price updates for synced markets work correctly

**Action Required**: 
- Fix the flawed alternative lookup (removes unnecessary DB queries)
- Reduce log noise (improves debugging)

---

## Related Code Files

- `backend/src/services/market-ingestion.ts` - Price event handler
- `backend/src/services/polymarket-client.ts` - WebSocket client (emits events with wrong `market` field)
- `backend/src/services/market-sync.ts` - Market synchronization
