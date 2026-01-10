# Child Markets Cleanup Guide

## Overview

This guide helps you identify and clean up child markets (outcomes) that were incorrectly stored as separate markets.

## Quick Start

1. **Review what will be deleted:**
   ```sql
   -- Run STEP 1 from cleanup-child-markets.sql
   -- This shows all child markets with their parent relationships
   ```

2. **Check for markets with data:**
   ```sql
   -- Run STEP 3 from cleanup-child-markets.sql
   -- Review markets that have outcomes, price history, or volume
   ```

3. **Safe delete (empty markets only):**
   ```sql
   -- Run STEP 4 from cleanup-child-markets.sql
   -- Only deletes child markets with no data
   ```

4. **Verify:**
   ```sql
   -- Run STEP 5 from cleanup-child-markets.sql
   -- Check how many child markets remain
   ```

## Example: Infinex Markets

Based on your query, here's what the cleanup would find:

**Parent Market:**
- ID: `131313`
- Question: "Infinex public sale total commitments?"

**Child Markets to Delete:**
- `0xda9ae164...` - "Over $60M committed to the Infinex public sale?"
- `0xe57df09f...` - "Over $10M committed to the Infinex public sale?"
- `0xe1969336...` - "Over $7M committed to the Infinex public sale?"
- ... (and 8 more similar markets)

All of these have `question_id` pointing to a parent, so they should be outcomes, not separate markets.

## Important Notes

1. **Foreign Key Cascades**: Deleting a market will automatically delete:
   - All outcomes for that market
   - All price_history records for that market
   - All market_stats_history records

2. **Markets with Data**: If a child market has outcomes or price history, you need to decide:
   - **Option A**: Delete it (loses data)
   - **Option B**: Keep it for now and handle manually
   - **Option C**: Migrate outcomes to parent (complex, not recommended)

3. **Backup First**: Always backup your database before running DELETE queries!

## Recommended Approach

1. Run STEP 1 to see all child markets
2. Run STEP 3 to identify markets with data
3. For empty markets: Run STEP 4 (safe delete)
4. For markets with data: Review manually and decide on a case-by-case basis
5. Run STEP 5 to verify cleanup

## Expected Results

After cleanup, you should see:
- Fewer markets in the database
- No duplicate markets for the same event
- Parent markets with their actual outcomes (not stored as separate markets)
