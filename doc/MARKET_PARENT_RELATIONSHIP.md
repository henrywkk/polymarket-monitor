# Market Parent Relationship Analysis

## Summary

We investigated Polymarket's API to find a direct link between child markets (outcome-specific) and parent events. Here's what we discovered:

## Key Findings

### 1. CLOB API Provides `question_id`

The **CLOB API** (`clob.polymarket.com/markets/{condition_id}`) reliably returns a `question_id` field that represents the parent event identifier.

**Example Response:**
```json
{
  "condition_id": "0x4ebc827b146947fc86b5cad1862ae770786eaf5b87370ac25dc80c7d5b080fe9",
  "question_id": "0xf466d99ebfa1823323133ef8b573b45df31c1398319145486b9307d15393e101",
  "question": "Will Severance win Best Television Series – Drama at the 83rd Golden Globes?",
  "market_slug": "will-severance-win-best-television-series-drama-at-the-83rd-golden-globes"
}
```

**Key Fields:**
- `condition_id`: The child market ID (outcome-specific)
- `question_id`: The parent event identifier (shared by all outcomes in the same event)
- `market_slug`: The outcome-specific slug (incorrect for parent event URL)

### 2. `question_id` Cannot Be Used Directly

The `question_id` is **not** a valid market ID or event ID for direct API queries:
- ❌ `GET /markets/{question_id}` → 404 or 422
- ❌ `GET /events/{question_id}` → 422

### 3. Current Implementation

Our `fetchCorrectEventSlug()` function:
1. ✅ Fetches market data from CLOB API to get `question_id`
2. ✅ Extracts `question_id` from the response
3. ❌ Tries to fetch event using `question_id` (fails)
4. ✅ Falls back to database pattern matching (works for known patterns)

## Improvements Made

### 1. Prioritize CLOB API
- Changed endpoint order to prioritize CLOB API since it reliably returns `question_id`
- CLOB API is now checked first: `clob.polymarket.com/markets/{condition_id}`

### 2. Enhanced Field Extraction
- Added checks for multiple field names: `question_id`, `questionId`, `event?.question_id`, etc.
- Added checks for nested structures: `parent`, `parentEvent`, `event` objects
- Better logging when `question_id` is found

### 3. Better Error Handling
- Separated handling for `question_id` vs `event_id`
- `question_id` → Use database pattern matching (since API doesn't support it)
- `event_id` → Try to fetch event directly from API

## Current Limitations

1. **No Direct API Query**: Polymarket doesn't provide an endpoint to query markets by `question_id`
2. **Database Pattern Matching**: We rely on pattern matching which only works for known patterns:
   - Awards: "Will X win Y at the Z?" → "Z: Y Winner"
   - IPO Market Cap: "Will X's market cap be Y?" → "X IPO Closing Market Cap"
3. **Missing Patterns**: New market types may not match existing patterns

## Future Improvements

### Option 1: Store `question_id` in Database
**Pros:**
- Direct query: `SELECT slug FROM markets WHERE question_id = $1 AND slug NOT LIKE 'will-%'`
- Fast and reliable
- Works for all market types

**Cons:**
- Requires database schema change
- Need to update sync service to store `question_id`

**Implementation:**
```sql
ALTER TABLE markets ADD COLUMN question_id VARCHAR(255);
CREATE INDEX idx_markets_question_id ON markets(question_id);
```

### Option 2: Query Polymarket Search API
**Pros:**
- No database changes needed
- Could find parent events dynamically

**Cons:**
- May not exist or be publicly documented
- Rate limiting concerns
- Less reliable than database query

### Option 3: Enhance Pattern Matching
**Pros:**
- No infrastructure changes
- Works with current setup

**Cons:**
- Requires manual pattern updates
- May miss edge cases

## Recommended Approach

**Short-term:** Continue using pattern matching with CLOB API as primary source for `question_id` (already implemented)

**Long-term:** Store `question_id` in database during market sync:
1. Update `market-sync.ts` to extract and store `question_id` from CLOB API
2. Add database column and index
3. Update `fetchCorrectEventSlug()` to query by `question_id` first, then fall back to pattern matching

## Testing

Use the inspection script to verify API responses:
```bash
npx tsx backend/tmp/inspect-market-api.ts <market_id>
```

This will show:
- Which APIs return `question_id`
- What fields are available
- Whether parent event can be fetched directly

## Related Files

- `backend/src/services/alert-dispatcher.ts` - Main implementation
- `backend/tmp/inspect-market-api.ts` - API inspection tool
- `backend/src/services/market-sync.ts` - Market synchronization (could store `question_id`)
