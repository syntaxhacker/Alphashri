/**
 * Constants for Alphashri
 */

// API endpoints
export const API_URL = "http://localhost:8765/api/screener";
export const SCREENERS_URL = "http://localhost:8765/api/screeners";

// Timing constants
export const NEW_ROW_HIGHLIGHT_MS = 12000;
export const DEFAULT_AUTO_REFRESH_SECONDS = 30;

// Default filter values
export const DEFAULT_FILTERS = {
  minScore: 0,
  maxPrice: 7000,
  minReturn: -100,
  sector: "",
};
