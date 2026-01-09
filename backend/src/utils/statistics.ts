/**
 * Statistical utility functions for anomaly detection
 */

/**
 * Calculate mean (average) of an array of numbers
 */
export function calculateMean(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((acc, val) => acc + val, 0);
  return sum / values.length;
}

/**
 * Calculate standard deviation of an array of numbers
 */
export function calculateStandardDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return 0;
  
  const mean = calculateMean(values);
  const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
  const avgSquaredDiff = calculateMean(squaredDiffs);
  return Math.sqrt(avgSquaredDiff);
}

/**
 * Calculate Z-score: Z = (value - mean) / standardDeviation
 * Returns null if standard deviation is 0 (all values are the same)
 */
export function calculateZScore(value: number, mean: number, standardDeviation: number): number | null {
  if (standardDeviation === 0) return null; // Cannot calculate Z-score if all values are identical
  return (value - mean) / standardDeviation;
}

/**
 * Check if a Z-score indicates an anomaly (|Z| > threshold)
 * Default threshold is 3.5 (very rare event, ~0.05% probability)
 */
export function isAnomaly(zScore: number | null, threshold: number = 3.5): boolean {
  if (zScore === null) return false;
  return Math.abs(zScore) > threshold;
}

/**
 * Calculate percentage change between two values
 */
export function calculatePercentageChange(oldValue: number, newValue: number): number {
  if (oldValue === 0) return newValue > 0 ? Infinity : (newValue < 0 ? -Infinity : 0);
  return ((newValue - oldValue) / oldValue) * 100;
}

/**
 * Calculate moving average from a time series
 * Returns the average of values within the specified time window
 */
export function calculateMovingAverage(
  data: Array<{ timestamp: number; value: number }>,
  windowMs: number
): number {
  const now = Date.now();
  const cutoff = now - windowMs;
  
  const valuesInWindow = data
    .filter(d => d.timestamp >= cutoff)
    .map(d => d.value);
  
  return calculateMean(valuesInWindow);
}

/**
 * Calculate moving standard deviation from a time series
 */
export function calculateMovingStandardDeviation(
  data: Array<{ timestamp: number; value: number }>,
  windowMs: number
): number {
  const now = Date.now();
  const cutoff = now - windowMs;
  
  const valuesInWindow = data
    .filter(d => d.timestamp >= cutoff)
    .map(d => d.value);
  
  return calculateStandardDeviation(valuesInWindow);
}
