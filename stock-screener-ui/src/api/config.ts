/**
 * Centralized API configuration for the frontend.
 */

const isProd = import.meta.env.PROD;

export const API_BASE =
  import.meta.env.VITE_API_BASE_URL ||
  (isProd ? "https://alphashri-backend.onrender.com" : "http://localhost:8765");

export const WS_BASE =
  import.meta.env.VITE_WS_BASE_URL ||
  (isProd ? "wss://alphashri-backend.onrender.com" : "ws://localhost:8765");

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
