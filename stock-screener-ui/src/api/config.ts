/**
 * Centralized API configuration for the frontend.
 */

// In production (Cloudflare), we use relative paths so Cloudflare proxies to the backend.
// In development, we use the local dev server.
const isProd = import.meta.env.PROD;

export const API_BASE = isProd 
  ? "" // Empty string means relative to current domain
  : (import.meta.env.VITE_API_BASE_URL || "http://localhost:8765");

// WebSocket base URL
// In production, use env var or default to wss:// backend
// In development, use env var or localhost
export const WS_BASE = import.meta.env.VITE_WS_BASE_URL 
  || (isProd ? "wss://alphashri-backend.onrender.com" : "ws://localhost:8765");

// Endpoint-specific bases (for convenience)
export const API_ENDPOINTS = {
  SCREENER: `${API_BASE}/api/screener`,
  BACKTEST: `${API_BASE}/api/backtest`,
  PAPER: `${API_BASE}/api/paper`,
  AUTH: `${API_BASE}/api/auth`,
  SECTOR: `${API_BASE}/api/sector`,
  NEWS: `${API_BASE}/api/news`,
  SYMBOLS: `${API_BASE}/api/symbols`,
  MARKET_TICKER: `${API_BASE}/api/market-ticker`,
  CHART_PREVIEW: `${API_BASE}/api/chart/preview`,
};
