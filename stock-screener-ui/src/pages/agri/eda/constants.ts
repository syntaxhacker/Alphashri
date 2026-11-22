export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const BAND_WIDTH = 1.5;
export const IQR_MULTIPLIER = 1.5;
export const DAY_MS = 86_400_000;
/** Calendar holes beyond a week must not be treated as one observation step. */
export const DEFAULT_MAX_GAP_DAYS = 7;

/**
 * Change windows are anchored to the latest observation and only accept an
 * anchor within the listed tolerance — weekend/holiday drift is fine, a
 * collection gap is not.
 */
export const CHANGE_WINDOWS = [
  { key: "1W", days: 7, toleranceDays: 3 },
  { key: "1M", days: 30, toleranceDays: 7 },
  { key: "3M", days: 91, toleranceDays: 14 },
  { key: "6M", days: 182, toleranceDays: 21 },
] as const;
