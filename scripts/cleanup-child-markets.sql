-- ============================================================================
-- Cleanup Script: Remove Child Markets (Outcomes) Stored as Separate Markets
-- ============================================================================
-- 
-- This script identifies and removes markets that are actually outcomes/child
-- markets of parent events, not standalone markets.
--
-- A child market is identified by:
-- 1. Has a question_id that points to another market (parent)
-- 2. question_id != id (not self-referential)
-- 3. Parent market exists in database
--
-- WARNING: Run the SELECT queries first to review what will be deleted!
-- ============================================================================

-- ============================================================================
-- DIAGNOSTIC: Check if question_id is populated
-- ============================================================================
-- Run this FIRST to see if question_id column has any data
SELECT 
    COUNT(*) as total_markets,
    COUNT(question_id) as markets_with_question_id,
    COUNT(*) - COUNT(question_id) as markets_without_question_id
FROM markets;

-- ============================================================================
-- DIAGNOSTIC: Sample markets with question_id
-- ============================================================================
-- See what question_id values look like
SELECT 
    id,
    question,
    question_id,
    CASE 
        WHEN question_id = id THEN 'self-referential'
        WHEN question_id IS NULL THEN 'no parent'
        ELSE 'has parent'
    END as relationship_type
FROM markets
WHERE question_id IS NOT NULL
ORDER BY question_id, id
LIMIT 20;

-- ============================================================================
-- DIAGNOSTIC: Check if question_id values match any market IDs
-- ============================================================================
-- This shows which question_id values point to existing markets vs orphaned
SELECT 
    m1.id,
    m1.question,
    m1.question_id,
    CASE 
        WHEN m2.id IS NOT NULL THEN 'parent EXISTS'
        ELSE 'parent NOT found'
    END as parent_status,
    m2.id as parent_market_id
FROM markets m1
LEFT JOIN markets m2 ON m1.question_id = m2.id
WHERE m1.question_id IS NOT NULL
  AND m1.id != m1.question_id  -- Not self-referential
ORDER BY 
    CASE WHEN m2.id IS NOT NULL THEN 0 ELSE 1 END,  -- Parents that exist first
    m1.question_id
LIMIT 50;

-- ============================================================================
-- STEP 1: Identify Child Markets (Review Before Deleting)
-- ============================================================================
-- This query shows all child markets that should be removed
-- NOTE: Includes markets where parent exists AND where parent doesn't exist (orphaned)
SELECT 
    m1.id as child_market_id,
    m1.question as child_question,
    m1.slug as child_slug,
    m1.question_id,
    CASE 
        WHEN m2.id IS NOT NULL THEN 'parent EXISTS in DB'
        ELSE 'parent NOT in DB (orphaned)'
    END as parent_status,
    m2.id as parent_market_id,
    m2.question as parent_question,
    m2.slug as parent_slug,
    (SELECT COUNT(*) FROM outcomes WHERE market_id = m1.id) as outcome_count,
    (SELECT COUNT(*) FROM price_history WHERE market_id = m1.id) as price_history_count
FROM markets m1
LEFT JOIN markets m2 ON m1.question_id = m2.id
WHERE m1.question_id IS NOT NULL 
  AND m1.id != m1.question_id  -- question_id points to different market (not self-referential)
ORDER BY 
    CASE WHEN m2.id IS NOT NULL THEN 0 ELSE 1 END,  -- Parents that exist first
    m1.question_id,
    m1.question;

-- ============================================================================
-- STEP 2: Count Child Markets by Parent (Summary View)
-- ============================================================================
-- Shows child markets grouped by their question_id (parent identifier)
-- Note: Parent may or may not exist in database
SELECT 
    m1.question_id as parent_question_id,
    CASE 
        WHEN m2.id IS NOT NULL THEN m2.question
        ELSE 'Parent not in database'
    END as parent_question,
    CASE 
        WHEN m2.id IS NOT NULL THEN 'exists'
        ELSE 'orphaned'
    END as parent_status,
    COUNT(m1.id) as child_markets_count,
    SUM((SELECT COUNT(*) FROM outcomes WHERE market_id = m1.id)) as total_child_outcomes,
    SUM((SELECT COUNT(*) FROM price_history WHERE market_id = m1.id)) as total_price_records
FROM markets m1
LEFT JOIN markets m2 ON m1.question_id = m2.id
WHERE m1.question_id IS NOT NULL 
  AND m1.id != m1.question_id
GROUP BY m1.question_id, m2.id, m2.question
ORDER BY child_markets_count DESC;

-- ============================================================================
-- STEP 3: Check for Markets with Data (Requires Manual Review)
-- ============================================================================
-- These child markets have outcomes or price history - review before deleting
SELECT 
    m1.id as child_market_id,
    m1.question as child_question,
    m1.question_id,
    CASE 
        WHEN m2.id IS NOT NULL THEN 'parent EXISTS'
        ELSE 'parent NOT in DB'
    END as parent_status,
    m2.id as parent_market_id,
    m2.question as parent_question,
    (SELECT COUNT(*) FROM outcomes WHERE market_id = m1.id) as outcome_count,
    (SELECT COUNT(*) FROM price_history WHERE market_id = m1.id) as price_history_count,
    m1.volume,
    m1.volume_24h
FROM markets m1
LEFT JOIN markets m2 ON m1.question_id = m2.id
WHERE m1.question_id IS NOT NULL 
  AND m1.id != m1.question_id
  AND (
    (SELECT COUNT(*) FROM outcomes WHERE market_id = m1.id) > 0
    OR (SELECT COUNT(*) FROM price_history WHERE market_id = m1.id) > 0
    OR m1.volume > 0
  )
ORDER BY m1.volume DESC;

-- ============================================================================
-- STEP 4: Safe Delete - Only Empty Child Markets
-- ============================================================================
-- This deletes child markets that have NO outcomes, price history, or volume
-- Works for both markets with existing parents AND orphaned markets
-- Foreign key constraints will automatically delete related records
DELETE FROM markets
WHERE question_id IS NOT NULL
  AND id != question_id  -- Not self-referential
  AND NOT EXISTS (
    SELECT 1 FROM outcomes WHERE market_id = markets.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM price_history WHERE market_id = markets.id
  )
  AND (volume = 0 OR volume IS NULL)
  AND (volume_24h = 0 OR volume_24h IS NULL);

-- ============================================================================
-- STEP 5: Verify Deletion (Run After Step 4)
-- ============================================================================
-- Check how many child markets remain (including orphaned)
SELECT 
    COUNT(*) as remaining_child_markets,
    COUNT(CASE WHEN m2.id IS NOT NULL THEN 1 END) as with_parent_in_db,
    COUNT(CASE WHEN m2.id IS NULL THEN 1 END) as orphaned
FROM markets m1
LEFT JOIN markets m2 ON m1.question_id = m2.id
WHERE m1.question_id IS NOT NULL 
  AND m1.id != m1.question_id;

-- ============================================================================
-- STEP 6: Manual Review Required - Markets with Data
-- ============================================================================
-- For child markets with outcomes/price history, you need to decide:
-- Option A: Delete them (lose the data)
-- Option B: Convert outcomes to parent market (complex migration)
-- Option C: Keep them (not recommended - causes confusion)
--
-- To see what would be deleted (including related data):
SELECT 
    m1.id,
    m1.question,
    'outcomes' as related_table,
    COUNT(*) as record_count
FROM markets m1
JOIN markets m2 ON m1.question_id = m2.id
JOIN outcomes o ON o.market_id = m1.id
WHERE m1.question_id IS NOT NULL 
  AND m1.id != m1.question_id
  AND m1.question_id = m2.id
GROUP BY m1.id, m1.question
UNION ALL
SELECT 
    m1.id,
    m1.question,
    'price_history' as related_table,
    COUNT(*) as record_count
FROM markets m1
JOIN markets m2 ON m1.question_id = m2.id
JOIN price_history ph ON ph.market_id = m1.id
WHERE m1.question_id IS NOT NULL 
  AND m1.id != m1.question_id
  AND m1.question_id = m2.id
GROUP BY m1.id, m1.question;

-- ============================================================================
-- STEP 7: Force Delete All Child Markets (USE WITH CAUTION!)
-- ============================================================================
-- WARNING: This will delete ALL child markets and their related data
-- (outcomes, price_history) due to CASCADE foreign keys
-- This includes both markets with parents in DB AND orphaned markets
-- 
-- Only run this if you're sure you want to delete everything!
-- 
-- Uncomment to execute:
/*
DELETE FROM markets
WHERE question_id IS NOT NULL
  AND id != question_id;
*/

-- ============================================================================
-- STEP 8: Find Orphaned Markets (question_id points to non-existent parent)
-- ============================================================================
-- These markets have question_id but parent doesn't exist
-- They might be legitimate or might need cleanup
SELECT 
    m1.id,
    m1.question,
    m1.question_id,
    m1.slug,
    (SELECT COUNT(*) FROM outcomes WHERE market_id = m1.id) as outcome_count
FROM markets m1
WHERE m1.question_id IS NOT NULL
  AND m1.id != m1.question_id
  AND NOT EXISTS (
    SELECT 1 FROM markets m2 WHERE m2.id = m1.question_id
  )
ORDER BY m1.question_id;
