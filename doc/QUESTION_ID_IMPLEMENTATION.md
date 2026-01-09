# Question ID Implementation

## Overview

We've implemented storing `question_id` (parent event identifier) in the database to enable robust parent-child market relationship queries. This allows the alert dispatcher to quickly find the correct parent event URL without relying solely on pattern matching.

## What is `question_id`?

The `question_id` is a unique identifier returned by Polymarket's CLOB API that links child markets (outcome-specific) to their parent event. For example:

- **Child Market**: "Will Severance win Best Television Series – Drama at the 83rd Golden Globes?"
  - `condition_id`: `0x4ebc827b146947fc86b5cad1862ae770786eaf5b87370ac25dc80c7d5b080fe9`
  - `question_id`: `0xf466d99ebfa1823323133ef8b573b45df31c1398319145486b9307d15393e101` (parent event)

- **Parent Event**: "Golden Globes: Best Television Series – Drama Winner"
  - `question_id`: `0xf466d99ebfa1823323133ef8b573b45df31c1398319145486b9307d15393e101`
  - All child markets share this same `question_id`

## Implementation Details

### 1. Database Schema Changes

**Added Column:**
- `markets.question_id` (VARCHAR(255), nullable)
- Index: `idx_markets_question_id` for fast lookups

**Files Modified:**
- `backend/src/db/sql-schema.ts` - Embedded schema
- `backend/src/db/init.sql` - SQL initialization file
- `backend/src/db/init-db.ts` - Migration added to auto-run

### 2. Market Model Update

**File:** `backend/src/models/Market.ts`

Added `questionId?: string | null` to the `Market` interface.

### 3. Market Sync Service

**File:** `backend/src/services/market-sync.ts`

- Added call to `fetchQuestionId()` during market sync
- Stores `question_id` in database when available
- Falls back gracefully if API call fails

**File:** `backend/src/services/polymarket-rest.ts`

- Added `fetchQuestionId(conditionId: string)` method
- Fetches from CLOB API: `clob.polymarket.com/markets/{condition_id}`
- Returns `question_id` if found, `undefined` otherwise

### 4. Alert Dispatcher Enhancement

**File:** `backend/src/services/alert-dispatcher.ts`

**New Query Strategy:**
1. **Step 1**: Fetch market data from CLOB API to get `question_id` (prioritized)
2. **Step 2**: Query database by `question_id` to find parent event:
   ```sql
   SELECT slug FROM markets 
   WHERE question_id = $1 
     AND slug NOT LIKE 'will-%'
     AND slug NOT LIKE '%-win-%'
   ORDER BY created_at ASC 
   LIMIT 1
   ```
3. **Step 3**: If found, cache and return parent event slug
4. **Step 4**: Fall back to pattern matching if `question_id` query fails

**Benefits:**
- ✅ Works for all market types (not just known patterns)
- ✅ Fast database lookup (indexed)
- ✅ More reliable than pattern matching
- ✅ Still falls back to pattern matching for edge cases

### 5. Database Migration

**File:** `backend/src/db/migration-add-question-id.sql`

Standalone migration script for manual execution if needed. The migration is also automatically run during database initialization via `init-db.ts`.

## Usage

### Automatic Population

`question_id` is automatically populated during market sync:
- New markets: `question_id` is fetched and stored immediately
- Existing markets: `question_id` will be populated on next sync

### Manual Backfill

To backfill `question_id` for existing markets:

1. **Option 1**: Run market sync (will populate over time)
   ```bash
   # Market sync runs automatically, or trigger manually via API
   ```

2. **Option 2**: Use inspection script for specific markets
   ```bash
   npx tsx backend/tmp/inspect-market-api.ts <market_id>
   ```

### Querying Parent Events

The alert dispatcher automatically uses `question_id` when available:

```typescript
// In alert-dispatcher.ts
const parentResult = await query(
  `SELECT slug FROM markets 
   WHERE question_id = $1 
     AND slug NOT LIKE 'will-%'
     AND slug NOT LIKE '%-win-%'
   ORDER BY created_at ASC 
   LIMIT 1`,
  [questionId]
);
```

## Testing

### Verify Database Schema

```sql
-- Check if column exists
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'markets' AND column_name = 'question_id';

-- Check index
SELECT indexname 
FROM pg_indexes 
WHERE tablename = 'markets' AND indexname = 'idx_markets_question_id';
```

### Verify Data Population

```sql
-- Check how many markets have question_id
SELECT 
  COUNT(*) as total_markets,
  COUNT(question_id) as markets_with_question_id,
  COUNT(*) - COUNT(question_id) as markets_without_question_id
FROM markets;

-- Find markets with same question_id (parent-child relationships)
SELECT question_id, COUNT(*) as child_count, array_agg(slug) as market_slugs
FROM markets
WHERE question_id IS NOT NULL
GROUP BY question_id
HAVING COUNT(*) > 1
ORDER BY child_count DESC
LIMIT 10;
```

### Test Alert Dispatcher

The alert dispatcher will automatically use `question_id` when generating alert URLs. Check logs for:

```
[Alert Dispatcher] Found question_id 0x... for market 0x...
[Alert Dispatcher] Found parent event slug via question_id: <slug> for market 0x...
```

## Performance Considerations

- **Index**: `idx_markets_question_id` ensures fast lookups
- **Caching**: Results are cached in Redis for 24 hours
- **Fallback**: Pattern matching still works if `question_id` is not available

## Migration Notes

### Existing Databases

The migration runs automatically on server startup via `init-db.ts`. Existing markets will have `NULL` for `question_id` until the next sync.

### New Databases

New databases will have the `question_id` column from the start via `init.sql`.

## Related Files

- `backend/src/models/Market.ts` - Market interface
- `backend/src/services/market-sync.ts` - Market synchronization
- `backend/src/services/polymarket-rest.ts` - API client
- `backend/src/services/alert-dispatcher.ts` - Alert URL generation
- `backend/src/db/init.sql` - Database schema
- `backend/src/db/init-db.ts` - Database initialization
- `backend/src/db/migration-add-question-id.sql` - Standalone migration
- `doc/MARKET_PARENT_RELATIONSHIP.md` - Analysis document

## Future Enhancements

1. **Backfill Script**: Create a script to backfill `question_id` for all existing markets
2. **Monitoring**: Add metrics to track `question_id` population rate
3. **Validation**: Verify `question_id` consistency across child markets
