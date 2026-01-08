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
 * Note: Returns the percentage value directly (e.g., 0.25 for 0.25%, 2.25 for 2.25%)
 */
function parseOutcomeMidpoint(outcome: string): number | null {
  const trimmed = outcome.trim();
  
  // Try to match range patterns like "0.5-1.0%" or "2.0–2.5%" (note: may use en-dash or hyphen)
  const rangeMatch = trimmed.match(/^([\d.]+)\s*[–-]\s*([\d.]+)\s*%?$/);
  if (rangeMatch) {
    const min = parseFloat(rangeMatch[1]);
    const max = parseFloat(rangeMatch[2]);
    if (!isNaN(min) && !isNaN(max)) {
      return (min + max) / 2; // Midpoint of range
    }
  }
  
  // Try to match less-than patterns like "<0.5%" (check BEFORE removing <)
  const lessThanMatch = trimmed.match(/^<\s*([\d.]+)\s*%?$/);
  if (lessThanMatch) {
    const value = parseFloat(lessThanMatch[1]);
    if (!isNaN(value)) {
      // For "<0.5%", assume midpoint is 0.25% (halfway between 0 and 0.5%)
      return value / 2;
    }
  }
  
  // Try to match greater-than patterns like ">2.5%" (check BEFORE removing >)
  const greaterThanMatch = trimmed.match(/^>\s*([\d.]+)\s*%?$/);
  if (greaterThanMatch) {
    const value = parseFloat(greaterThanMatch[1]);
    if (!isNaN(value)) {
      // For ">2.5%", we need to estimate. A reasonable approach:
      // Assume the range extends to some reasonable upper bound (e.g., 2x the threshold)
      // Midpoint would be halfway between threshold and upper bound
      // For ">2.5%", if we assume upper bound of 5%, midpoint is (2.5 + 5) / 2 = 3.75%
      // Or more conservatively, use threshold + 1% as midpoint: 2.5 + 1 = 3.5%
      return value + 1.0; // Conservative estimate: threshold + 1%
    }
  }
  
  // Try to match single number with % (e.g., "5%")
  const singleMatch = trimmed.match(/^([\d.]+)\s*%?$/);
  if (singleMatch) {
    const value = parseFloat(singleMatch[1]);
    if (!isNaN(value)) {
      return value;
    }
  }
  
  return null;
}

/**
 * Get sort key for outcome string to enable human-readable sorting
 * Returns a number for sorting, or Infinity for unparseable outcomes
 */
export function getOutcomeSortKey(outcome: string): number {
  const trimmed = outcome.trim();
  
  // Less-than patterns should come first (negative sort key)
  const lessThanMatch = trimmed.match(/^<\s*([\d.]+)\s*%?$/);
  if (lessThanMatch) {
    const value = parseFloat(lessThanMatch[1]);
    if (!isNaN(value)) {
      return value - 1000; // Negative offset to sort before ranges
    }
  }
  
  // Range patterns: use the minimum value for sorting
  const rangeMatch = trimmed.match(/^([\d.]+)\s*[–-]\s*([\d.]+)\s*%?$/);
  if (rangeMatch) {
    const min = parseFloat(rangeMatch[1]);
    if (!isNaN(min)) {
      return min;
    }
  }
  
  // Greater-than patterns should come last (large sort key)
  const greaterThanMatch = trimmed.match(/^>\s*([\d.]+)\s*%?$/);
  if (greaterThanMatch) {
    const value = parseFloat(greaterThanMatch[1]);
    if (!isNaN(value)) {
      return value + 1000; // Large offset to sort after ranges
    }
  }
  
  // Single number
  const singleMatch = trimmed.match(/^([\d.]+)\s*%?$/);
  if (singleMatch) {
    const value = parseFloat(singleMatch[1]);
    if (!isNaN(value)) {
      return value;
    }
  }
  
  // Unparseable outcomes go to the end
  return Infinity;
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
