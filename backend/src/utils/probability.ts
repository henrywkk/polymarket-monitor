/**
 * Calculate implied probability from bid and ask prices
 * @param bestBid - Best bid price (0-1)
 * @param bestAsk - Best ask price (0-1)
 * @returns Implied probability as percentage (0-100)
 */
export const calculateImpliedProbability = (
  bestBid: number,
  bestAsk: number
): number => {
  const midPrice = (bestBid + bestAsk) / 2;
  return midPrice * 100; // Convert to percentage
};

/**
 * Calculate mid-market price from bid and ask
 * @param bestBid - Best bid price
 * @param bestAsk - Best ask price
 * @returns Mid-market price
 */
export const calculateMidPrice = (bestBid: number, bestAsk: number): number => {
  return (bestBid + bestAsk) / 2;
};

/**
 * Validate price is within valid range
 * @param price - Price to validate
 * @returns True if price is valid (0-1)
 */
export const isValidPrice = (price: number): boolean => {
  return price >= 0 && price <= 1;
};

