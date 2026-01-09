-- Migration: Add question_id column to markets table
-- This column stores the parent event identifier from Polymarket API
-- Run this migration to add question_id support to existing databases

-- Add question_id column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'markets' AND column_name = 'question_id'
    ) THEN
        ALTER TABLE markets ADD COLUMN question_id VARCHAR(255);
        RAISE NOTICE 'Added question_id column to markets table';
    ELSE
        RAISE NOTICE 'question_id column already exists in markets table';
    END IF;
END $$;

-- Create index on question_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_markets_question_id ON markets(question_id);

-- Note: Existing markets will have NULL question_id
-- The question_id will be populated during the next market sync
-- You can manually backfill question_id for existing markets by:
-- 1. Running the market sync service
-- 2. Or using the inspect-market-api.ts script to fetch question_id for specific markets
