/**
 * Constants for Alphashri
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8765";
export const API_URL = `${API_BASE}/api/screener`;
export const SCREENERS_URL = `${API_BASE}/api/screeners`;

// Timing constants
export const NEW_ROW_HIGHLIGHT_MS = 12000;
export const DEFAULT_AUTO_REFRESH_SECONDS = 60;
