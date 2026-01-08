/**
 * Calculate expected value for multi-outcome markets
 * Expected value = sum of (outcome_midpoint * probability) for all outcomes
 */

export interface OutcomeWithPrice {
  id: string;
  market_id: string;
  outcome: string;
  token_id: string;
  created_at: string;
  currentPrice?: {
    implied_probability: number;
    bid_price: number;
    ask_price: number;
    mid_price: number;
  };
}

/**
 * Parse numeric value from outcome string (e.g., "<0.5%" -> 0.25, "2.0-2.5%" -> 2.25)
 * Returns null if unable to parse
 */
function parseOutcomeMidpoint(outcome: string): number | null {
  // Remove common prefixes/suffixes
  const cleaned = outcome.trim().replace(/[<>%]/g, '');
  
  // Try to match range patterns like "0.5-1.0" or "2.0-2.5"
  const rangeMatch = cleaned.match(/^([\d.]+)\s*-\s*([\d.]+)$/);
  if (rangeMatch) {
    const min = parseFloat(rangeMatch[1]);
    const max = parseFloat(rangeMatch[2]);
    if (!isNaN(min) && !isNaN(max)) {
      return (min + max) / 2; // Midpoint of range
    }
  }
  
  // Try to match single value patterns like "<0.5" or ">2.5"
  const lessThanMatch = cleaned.match(/^<\s*([\d.]+)$/);
  if (lessThanMatch) {
    const value = parseFloat(lessThanMatch[1]);
    if (!isNaN(value)) {
      return value * 0.5; // Assume midpoint is half of the threshold
    }
  }
  
  const greaterThanMatch = cleaned.match(/^>\s*([\d.]+)$/);
  if (greaterThanMatch) {
    const value = parseFloat(greaterThanMatch[1]);
    if (!isNaN(value)) {
      return value * 1.5; // Assume midpoint is 1.5x the threshold
    }
  }
  
  // Try to match single number
  const singleMatch = cleaned.match(/^([\d.]+)$/);
  if (singleMatch) {
    const value = parseFloat(singleMatch[1]);
    if (!isNaN(value)) {
      return value;
    }
  }
  
  return null;
}

/**
 * Check if a market is a binary Yes/No market
 */
export function isBinaryMarket(outcomes: OutcomeWithPrice[]): boolean {
  if (!outcomes || outcomes.length === 0) return false;
  
  const outcomeNames = outcomes.map(o => o.outcome?.toLowerCase() || '').filter(Boolean);
  
  // Check for Yes/No pattern
  const hasYes = outcomeNames.some(name => 
    name === 'yes' || name === 'true' || name === '1'
  );
  const hasNo = outcomeNames.some(name => 
    name === 'no' || name === 'false' || name === '0'
  );
  
  return hasYes && hasNo && outcomes.length === 2;
}

/**
 * Calculate expected value for multi-outcome markets
 * Returns null if unable to calculate (e.g., binary market or missing data)
 */
export function calculateExpectedValue(outcomes: OutcomeWithPrice[]): number | null {
  if (!outcomes || outcomes.length === 0) return null;
  
  // Don't calculate expected value for binary markets
  if (isBinaryMarket(outcomes)) return null;
  
  // Need at least 2 outcomes for multi-outcome market
  if (outcomes.length < 2) return null;
  
  let totalExpected = 0;
  let hasValidData = false;
  
  for (const outcome of outcomes) {
    const probability = outcome.currentPrice?.implied_probability;
    if (probability === undefined || probability === null) continue;
    
    const midpoint = parseOutcomeMidpoint(outcome.outcome || '');
    if (midpoint === null) continue;
    
    // Convert probability from percentage (0-100) to decimal (0-1)
    const probDecimal = probability / 100;
    
    totalExpected += midpoint * probDecimal;
    hasValidData = true;
  }
  
  return hasValidData ? totalExpected : null;
}

/**
 * Get the primary outcome for display (Yes for binary, first for others)
 */
export function getPrimaryOutcome(outcomes: OutcomeWithPrice[]): OutcomeWithPrice | null {
  if (!outcomes || outcomes.length === 0) return null;
  
  // For binary markets, prefer "Yes"
  if (isBinaryMarket(outcomes)) {
    const yesOutcome = outcomes.find(o => {
      const name = o.outcome?.toLowerCase() || '';
      return name === 'yes' || name === 'true' || name === '1';
    });
    return yesOutcome || outcomes[0];
  }
  
  // For multi-outcome markets, return first outcome
  return outcomes[0];
}
