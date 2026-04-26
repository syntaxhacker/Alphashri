/**
 * Constants for Alphashri
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8765";
export const API_URL = `${API_BASE}/api/screener`;
export const SCREENERS_URL = `${API_BASE}/api/screeners`;

// Timing constants
export const NEW_ROW_HIGHLIGHT_MS = 12000;
export const DEFAULT_AUTO_REFRESH_SECONDS = 60;

// Chart timeframe options
export const TIMEFRAMES = [
  { value: 1, label: "1m" },
  { value: 5, label: "5m" },
  { value: 15, label: "15m" },
  { value: 30, label: "30m" },
  { value: 60, label: "1h" },
  { value: 120, label: "2h" },
  { value: 240, label: "4h" },
  { value: 720, label: "12h" },
  { value: 1440, label: "1d" },
];

// Opening range options
export const OR_MINUTES_OPTIONS = [
  { value: 30, label: "OR 30m" },
  { value: 45, label: "OR 45m" },
  { value: 60, label: "OR 60m" },
  { value: 120, label: "OR 2h" },
  { value: 240, label: "OR 4h" },
];
