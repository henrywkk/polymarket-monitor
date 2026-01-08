/**
 * Utility functions for grouping and displaying outcomes
 */

export interface Outcome {
  id: string;
  market_id: string;
  outcome: string;
  token_id: string;
  created_at: string;
  currentPrice?: {
    bid_price: number;
    ask_price: number;
    mid_price: number;
    implied_probability: number;
  };
}

/**
 * Check if an outcome string represents a Yes/No outcome
 */
export function isYesNoOutcome(outcome: string): boolean {
  const lower = outcome.toLowerCase().trim();
  return lower === 'yes' || lower === 'no' || lower === 'true' || lower === 'false' || lower === '1' || lower === '0';
}

/**
 * Extract bucket name from outcome string
 * For multi-outcome markets, outcomes might be like:
 * - "<0.5%" (bucket name)
 * - "Yes" (for <0.5% bucket)
 * - "No" (for <0.5% bucket)
 * 
 * We want to group by bucket name, not by Yes/No
 */
export function extractBucketName(outcome: string): string {
  // If it's already a bucket-like format (<0.5%, 0.5-1.0%, etc.), return as-is
  if (outcome.includes('%') || outcome.includes('-') || outcome.includes('<') || outcome.includes('>')) {
    return outcome;
  }
  
  // If it's Yes/No/True/False, we can't determine the bucket from the outcome alone
  // This means we need to look at other outcomes in the market to find the bucket
  // For now, return the outcome as-is
  return outcome;
}

/**
 * Group outcomes by bucket name
 * Returns a map of bucket name -> outcomes for that bucket
 */
export function groupOutcomesByBucket(outcomes: Outcome[]): Map<string, Outcome[]> {
  const buckets = new Map<string, Outcome[]>();
  
  // First, identify bucket names (outcomes that look like buckets)
  const bucketNames = outcomes
    .map(o => o.outcome)
    .filter(outcome => !isYesNoOutcome(outcome) && (outcome.includes('%') || outcome.includes('-') || outcome.includes('<') || outcome.includes('>')))
    .filter((value, index, self) => self.indexOf(value) === index); // unique
  
  // If we have bucket names, group Yes/No outcomes by their bucket
  if (bucketNames.length > 0) {
    // For each bucket, find its Yes/No outcomes
    for (const bucketName of bucketNames) {
      const bucketOutcomes: Outcome[] = [];
      
      // Add the bucket name itself if it exists as an outcome
      const bucketOutcome = outcomes.find(o => o.outcome === bucketName);
      if (bucketOutcome) {
        bucketOutcomes.push(bucketOutcome);
      }
      
      // For now, we'll treat each bucket name as a separate outcome
      // The Yes/No pairs are internal to Polymarket's structure
      buckets.set(bucketName, bucketOutcomes);
    }
    
    // Add any remaining outcomes that aren't buckets or Yes/No
    for (const outcome of outcomes) {
      if (!isYesNoOutcome(outcome.outcome) && !bucketNames.includes(outcome.outcome)) {
        if (!buckets.has(outcome.outcome)) {
          buckets.set(outcome.outcome, []);
        }
        buckets.get(outcome.outcome)!.push(outcome);
      }
    }
  } else {
    // No bucket structure detected - treat each outcome as its own bucket
    for (const outcome of outcomes) {
      const key = outcome.outcome;
      if (!buckets.has(key)) {
        buckets.set(key, []);
      }
      buckets.get(key)!.push(outcome);
    }
  }
  
  return buckets;
}

/**
 * Get the primary outcome for a bucket (prefer the bucket name itself, or Yes if available)
 */
export function getPrimaryOutcomeForBucket(bucketOutcomes: Outcome[]): Outcome | null {
  if (bucketOutcomes.length === 0) return null;
  
  // Prefer the bucket name itself (not Yes/No)
  const bucketNameOutcome = bucketOutcomes.find(o => !isYesNoOutcome(o.outcome));
  if (bucketNameOutcome) return bucketNameOutcome;
  
  // Otherwise, prefer Yes
  const yesOutcome = bucketOutcomes.find(o => 
    o.outcome.toLowerCase() === 'yes' || 
    o.outcome.toLowerCase() === 'true' ||
    o.outcome.toLowerCase() === '1'
  );
  if (yesOutcome) return yesOutcome;
  
  // Fallback to first outcome
  return bucketOutcomes[0];
}
