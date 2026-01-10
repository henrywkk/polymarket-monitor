-- ============================================================================
-- Diagnostic Queries: Understand Why Child Market Detection Returns Empty
-- ============================================================================
-- Run these queries to understand the data structure and why cleanup queries
-- might return empty results.
-- ============================================================================

-- ============================================================================
-- DIAG 1: Check if question_id column exists and has data
-- ============================================================================
SELECT 
    COUNT(*) as total_markets,
    COUNT(question_id) as markets_with_question_id,
    COUNT(*) - COUNT(question_id) as markets_without_question_id,
    COUNT(DISTINCT question_id) as unique_question_ids
FROM markets;

-- ============================================================================
-- DIAG 2: Sample markets with question_id populated
-- ============================================================================
SELECT 
    id,
    question,
    slug,
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
-- DIAG 3: Check if question_id values actually match any market IDs
-- ============================================================================
SELECT 
    m1.id,
    m1.question,
    m1.question_id,
    CASE 
        WHEN m2.id IS NOT NULL THEN 'parent exists'
        ELSE 'parent NOT found'
    END as parent_status,
    m2.id as parent_market_id,
    m2.question as parent_question
FROM markets m1
LEFT JOIN markets m2 ON m1.question_id = m2.id
WHERE m1.question_id IS NOT NULL
  AND m1.id != m1.question_id  -- Not self-referential
ORDER BY m1.question_id, m1.id
LIMIT 50;

-- ============================================================================
-- DIAG 4: Count markets by relationship type
-- ============================================================================
SELECT 
    CASE 
        WHEN question_id IS NULL THEN 'No question_id'
        WHEN question_id = id THEN 'Self-referential (parent market)'
        WHEN EXISTS (SELECT 1 FROM markets m2 WHERE m2.id = markets.question_id) THEN 'Has parent (child market)'
        ELSE 'Orphaned (question_id points to non-existent market)'
    END as market_type,
    COUNT(*) as count
FROM markets
GROUP BY 
    CASE 
        WHEN question_id IS NULL THEN 'No question_id'
        WHEN question_id = id THEN 'Self-referential (parent market)'
        WHEN EXISTS (SELECT 1 FROM markets m2 WHERE m2.id = markets.question_id) THEN 'Has parent (child market)'
        ELSE 'Orphaned (question_id points to non-existent market)'
    END
ORDER BY count DESC;

-- ============================================================================
-- DIAG 5: Check Infinex markets specifically (from your example)
-- ============================================================================
SELECT 
    id,
    question,
    slug,
    question_id,
    CASE 
        WHEN question_id IS NULL THEN 'no parent'
        WHEN question_id = id THEN 'self (parent)'
        WHEN EXISTS (SELECT 1 FROM markets m2 WHERE m2.id = markets.question_id) THEN 'has parent'
        ELSE 'orphaned'
    END as relationship_type
FROM markets
WHERE slug LIKE '%infinex%' OR question LIKE '%infinex%'
ORDER BY 
    CASE 
        WHEN question_id IS NULL THEN 1
        WHEN question_id = id THEN 2
        ELSE 3
    END,
    question_id,
    id;

-- ============================================================================
-- DIAG 6: Find all potential child markets (regardless of parent existence)
-- ============================================================================
SELECT 
    m1.id,
    m1.question,
    m1.slug,
    m1.question_id,
    m2.id as parent_exists,
    m2.question as parent_question
FROM markets m1
LEFT JOIN markets m2 ON m1.question_id = m2.id AND m1.question_id != m1.id
WHERE m1.question_id IS NOT NULL
  AND m1.question_id != m1.id  -- Not self-referential
ORDER BY 
    CASE WHEN m2.id IS NOT NULL THEN 0 ELSE 1 END,  -- Parents that exist first
    m1.question_id,
    m1.id
LIMIT 100;

-- ============================================================================
-- DIAG 7: Check data types and constraints
-- ============================================================================
SELECT 
    column_name,
    data_type,
    character_maximum_length,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'markets'
  AND column_name IN ('id', 'question_id')
ORDER BY column_name;
