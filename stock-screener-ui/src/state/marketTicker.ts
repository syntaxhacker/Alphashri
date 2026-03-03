/**
 * Market Ticker State
 * Live market data for indices and commodities
 */

import * as state from "./index";

export interface MarketTickerItem {
  symbol: string;
  name: string;
  price: number;
  change: number;
  change_percent: number;
  is_positive: boolean;
  high: number | null;
  low: number | null;
  timestamp: Date | null;
  last_updated: Date | null;
  loading: boolean;
  error: string | null;
}

export interface MarketTickerData {
  tickers: Record<string, MarketTickerItem>;
  last_updated: Date | null;
  loading: boolean;
  error: string | null;
}

const MARKET_TICKER_API = "http://localhost:8765/api/market-ticker";

// Cache for ticker data
let _tickerCache: MarketTickerData | null;
let _cacheTime: number = 0;
const CACHE_TTL = 30000; // 30 seconds

export async function fetchMarketTicker(): Promise<MarketTickerData> {
  const now = Date.now();

  // Return cached data if still fresh
  if (_tickerCache && now - _cacheTime < CACHE_TTL) {
    return _tickerCache;
  }

  // Fetch fresh data
  try {
    const response = await fetch(MARKET_TICKER_API);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    _tickerCache = data;
    _cacheTime = now;
    return data;
  } catch (error) {
    return {
      tickers: {},
      last_updated: new Date(),
      loading: false,
      error: error instanceof Error ? error.message : "Failed to fetch market data",
    };
  }
}

export function getMarketTicker(): MarketTickerData | null {
  return _tickerCache;
}

export function clearMarketTickerCache(): void {
  _tickerCache = null;
  _cacheTime = 0;
}

export function isMarketTickerLoading(): boolean {
  return _tickerCache?.loading ?? false;
}

// Auto-refresh interval handle
let _refreshInterval: ReturnType<typeof setInterval> | null = null;

export function initMarketTickerRefresh(intervalMs: number = 30000): void {
  // Clear any existing interval
  if (_refreshInterval) {
    clearInterval(_refreshInterval);
  }

  // Fetch immediately
  fetchMarketTicker()
    .then((data) => {
      _tickerCache = data;
      _cacheTime = Date.now();
    })
    .catch((error) => {
      console.error("Failed to fetch market ticker:", error);
    });

  // Set up auto-refresh
  _refreshInterval = setInterval(async () => {
    try {
      const data = await fetchMarketTicker();
      _tickerCache = data;
      _cacheTime = Date.now();
    } catch (error) {
      console.error("Failed to refresh market ticker:", error);
    }
  }, intervalMs);
}

// Initialize on load
fetchMarketTicker()
  .then((data) => {
    _tickerCache = data;
    _cacheTime = Date.now();
  })
  .catch((error) => {
    console.error("Failed to fetch market ticker:", error);
  });
