# Market Child Detection Analysis

## Problem Statement

Outcomes/questions are being stored as separate markets when they should be outcomes of a parent market. Example with Infinex:

**Parent Market:**
- ID: `131313`
- Question: "Infinex public sale total commitments?"
- Slug: `infinex-public-sale-total-commitments`
- `question_id`: `null`

**Child Markets (should be outcomes):**
- ID: `0xda9ae164...`
- Question: "Over $60M committed to the Infinex public sale?"
- `question_id`: `0xd51badcac550be9ed7688b44c85d2163078b0266278c99a09898f8b7812a8ebf`
- This `question_id` should link to the parent event

## Root Cause Analysis

### Current Flow

1. **Market List Fetch** (`fetchMarkets()`)
   - Fetches markets from Gamma API `/events` or other endpoints
   - API response may or may not include `question_id` field
   - Markets are normalized via `normalizeMarket()`

2. **Filtering** (line 162 in `market-sync.ts`)
   ```typescript
   if (market.questionId && market.conditionId && market.questionId !== market.conditionId) {
     // Skip child market
   }
   ```
   - **Problem**: This filter only works if `question_id` is already in the API response
   - If `question_id` is missing from the list response, child markets pass through

3. **Question ID Fetch** (line 408 in `market-sync.ts`)
   - `question_id` is fetched from CLOB API AFTER filtering
   - Happens in `syncMarket()`, which runs AFTER the filter
   - Too late to filter out child markets

### Why Filtering Fails

1. **API Response Structure**: The markets list endpoint (Gamma API `/events`) may not include `question_id` in the response
2. **Timing Issue**: `question_id` is fetched AFTER filtering, so child markets aren't detected
3. **Parent Market Identification**: Parent markets might have:
   - `question_id` = `null` (no parent)
   - `question_id` = `condition_id` (self-referential)
   - OR `question_id` pointing to another market

## Polymarket Data Structure

Based on the database query results:

### Parent Market Pattern
- Has `question_id` = `null` OR `question_id` = `condition_id`
- Represents the main event (e.g., "Infinex public sale total commitments?")

### Child Market Pattern
- Has `question_id` ≠ `condition_id` AND `question_id` ≠ `null`
- `question_id` points to the parent event
- Should be stored as an outcome, not a separate market

## Solution

### Option 1: Fetch `question_id` Before Filtering (Recommended)

Fetch `question_id` for each market BEFORE applying the filter:

```typescript
// In syncMarkets(), before filtering:
for (const market of pageMarkets) {
  // Fetch question_id early if not present
  if (!market.questionId && market.conditionId) {
    try {
      market.questionId = await this.restClient.fetchQuestionId(market.conditionId);
    } catch (error) {
      // Continue if fetch fails
    }
  }
  
  // Now apply filter with question_id available
  if (market.questionId && market.conditionId && market.questionId !== market.conditionId) {
    // Skip child market
    continue;
  }
}
```

**Pros:**
- Catches child markets before they're stored
- Uses existing `fetchQuestionId()` method
- Minimal code changes

**Cons:**
- Additional API calls (one per market)
- Slower sync process
- May hit rate limits

### Option 2: Post-Sync Cleanup

After syncing, check if a market's `question_id` points to an existing market:

```typescript
// After syncMarket()
if (questionId && questionId !== marketId) {
  // Check if parent market exists
  const parentExists = await query('SELECT id FROM markets WHERE id = $1', [questionId]);
  if (parentExists.rows.length > 0) {
    // This is a child market - delete it or convert to outcome
    await query('DELETE FROM markets WHERE id = $1', [marketId]);
  }
}
```

**Pros:**
- No additional API calls during filtering
- Can clean up existing bad data

**Cons:**
- Markets are stored then deleted (inefficient)
- Doesn't prevent the issue, only fixes it after

### Option 3: Database-Based Filtering

After fetching `question_id`, check database for existing markets with same `question_id`:

```typescript
// In syncMarket(), after fetching questionId
if (questionId && questionId !== marketId) {
  // Check if a parent market exists with this question_id
  const parentCheck = await query(
    'SELECT id FROM markets WHERE id = $1 OR question_id = $1',
    [questionId]
  );
  
  if (parentCheck.rows.length > 0) {
    // Parent exists - this is a child market
    console.log(`[Sync] Skipping child market ${marketId} - parent exists: ${questionId}`);
    return; // Don't sync this market
  }
}
```

**Pros:**
- Uses database to identify parent-child relationships
- Works even if API doesn't return `question_id` in list
- Can handle complex parent-child hierarchies

**Cons:**
- Requires database query per market
- May miss parent if it hasn't been synced yet

## Recommended Implementation

**Hybrid Approach**: Combine Option 1 and Option 3

1. **During List Fetch**: Try to get `question_id` from API response first (no extra calls)
2. **Before Filtering**: Fetch `question_id` from CLOB API if missing (one call per market)
3. **During Sync**: Double-check against database to catch any missed cases

This ensures:
- Child markets are filtered early (efficient)
- Database is checked as final safeguard (robust)
- Existing bad data can be identified and cleaned up

## Additional Considerations

### Parent Market Identification

A market is a **parent** if:
- `question_id` is `null` OR
- `question_id` equals `condition_id` (self-referential) OR
- `question_id` doesn't match any existing market's `condition_id`

A market is a **child** if:
- `question_id` exists AND
- `question_id` ≠ `condition_id` AND
- A parent market exists with `condition_id` = `question_id`

### Performance Impact

- **Current**: ~1 API call per market (for `question_id` fetch in `syncMarket`)
- **Proposed**: ~1-2 API calls per market (fetch before filter + sync)
- **Mitigation**: Batch fetch `question_id` for multiple markets, or cache results

### Data Cleanup

For existing bad data:
```sql
-- Find child markets that should be outcomes
SELECT m1.id, m1.question, m1.question_id, m2.id as parent_id, m2.question as parent_question
FROM markets m1
JOIN markets m2 ON m1.question_id = m2.id
WHERE m1.question_id IS NOT NULL 
  AND m1.id != m1.question_id
  AND m1.question_id = m2.id;
```

These can be:
1. Deleted (if they have no outcomes/price_history)
2. Converted to outcomes of the parent market
3. Marked for manual review
