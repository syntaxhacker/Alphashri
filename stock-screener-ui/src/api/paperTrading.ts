/**
 * Paper Trading API Client
 */

import type {
  PaperPosition,
  PaperTrade,
  PortfolioStatus,
  DailySummary,
  PerformanceSummary,
  SymbolPerformance,
  PaperChartData,
  PaperBotSnapshot,
} from "../types/paperTrading";
import {
  setPositions,
  setPortfolio,
  setTrades,
  setDailySummary,
  setPerformanceSummary,
  setSymbolPerformance,
  setChartData,
  setChartLoading,
  setError,
  setLoading,
  setBotStatus,
  setBotSnapshot,
  setupAutoRefresh,
  stopAutoRefresh,
} from "../state/paperTrading";

const API_BASE = "http://localhost:8765";

type PaperBotStatus = {
  running: boolean;
  pid: number | null;
  log_file: string | null;
};

export async function fetchPaperBotSnapshot(): Promise<PaperBotSnapshot | null> {
  try {
    const response = await fetch(`${API_BASE}/api/paper/bot/snapshot`);
    const data = await response.json();
    setBotSnapshot(data);
    return data;
  } catch (error) {
    console.error("Failed to fetch paper bot snapshot:", error);
    return null;
  }
}

// Fetch portfolio status
export async function fetchPortfolio(): Promise<PortfolioStatus | null> {
  try {
    const response = await fetch(`${API_BASE}/api/paper/portfolio`);
    const data = await response.json();
    setPortfolio(data);
    return data;
  } catch (error) {
    console.error("Failed to fetch portfolio:", error);
    return null;
  }
}

// Fetch open positions
export async function fetchPositions(): Promise<PaperPosition[]> {
  try {
    const response = await fetch(`${API_BASE}/api/paper/positions`);
    const data = await response.json();
    const positions = data.positions || [];
    setPositions(positions);
    return positions;
  } catch (error) {
    console.error("Failed to fetch positions:", error);
    return [];
  }
}

// Fetch trade history
export async function fetchTrades(limit: number = 100): Promise<PaperTrade[]> {
  try {
    const response = await fetch(`${API_BASE}/api/paper/trades?limit=${limit}`);
    const data = await response.json();
    const trades = data.trades || [];
    setTrades(trades);
    return trades;
  } catch (error) {
    console.error("Failed to fetch trades:", error);
    return [];
  }
}

// Fetch daily report
export async function fetchDailyReport(date?: string): Promise<DailySummary | null> {
  try {
    const url = date
      ? `${API_BASE}/api/paper/journal/daily?date=${date}`
      : `${API_BASE}/api/paper/journal/daily`;
    const response = await fetch(url);
    const data = await response.json();
    setDailySummary(data);
    return data;
  } catch (error) {
    console.error("Failed to fetch daily report:", error);
    return null;
  }
}

// Fetch performance summary
export async function fetchPerformanceSummary(): Promise<PerformanceSummary | null> {
  try {
    const response = await fetch(`${API_BASE}/api/paper/journal/summary`);
    const data = await response.json();
    setPerformanceSummary(data);
    return data;
  } catch (error) {
    console.error("Failed to fetch performance summary:", error);
    return null;
  }
}

// Fetch symbol performance
export async function fetchSymbolPerformance(): Promise<SymbolPerformance[]> {
  try {
    const response = await fetch(`${API_BASE}/api/paper/journal/symbols`);
    const data = await response.json();
    const performance = Object.values(data) as SymbolPerformance[];
    setSymbolPerformance(performance);
    return performance;
  } catch (error) {
    console.error("Failed to fetch symbol performance:", error);
    return [];
  }
}

// Fetch chart data for a symbol
export async function fetchPaperChart(
  symbol: string,
  date?: string,
): Promise<PaperChartData | null> {
  setChartLoading(true);

  try {
    const url = date
      ? `${API_BASE}/api/paper/chart/${symbol}?date=${date}`
      : `${API_BASE}/api/paper/chart/${symbol}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.error) {
      console.error("Chart data error:", data.error);
      // Clear chart data to show error state instead of stale data
      setChartData(null);
      setChartLoading(false);
      return null;
    }

    setChartData(data);
    return data;
  } catch (error) {
    console.error("Failed to fetch chart data:", error);
    // Clear chart data on error
    setChartData(null);
    setChartLoading(false);
    return null;
  }
}

// Refresh all live data
export async function refreshLiveData(): Promise<void> {
  setLoading(true);

  try {
    await Promise.all([
      fetchPortfolio(),
      fetchPositions(),
      fetchPaperBotStatus(),
      fetchPaperBotSnapshot(),
    ]);
  } catch (error) {
    setError(error instanceof Error ? error.message : "Unknown error");
  } finally {
    setLoading(false);
  }
}

export async function fetchPaperBotStatus(): Promise<PaperBotStatus | null> {
  try {
    const response = await fetch(`${API_BASE}/api/paper/bot/status`);
    const data = await response.json();
    setBotStatus(!!data.running, data.pid ?? null, data.log_file ?? null);
    return data;
  } catch (error) {
    console.error("Failed to fetch paper bot status:", error);
    setBotStatus(false, null, null);
    return null;
  }
}

export async function startPaperBot(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/api/paper/bot/start`, { method: "POST" });
    const data = await response.json();
    setBotStatus(!!data.running, data.pid ?? null, data.log_file ?? null);
    return !!data.running;
  } catch (error) {
    console.error("Failed to start paper bot:", error);
    return false;
  }
}

export async function stopPaperBot(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/api/paper/bot/stop`, { method: "POST" });
    const data = await response.json();
    setBotStatus(!!data.running, data.pid ?? null, data.log_file ?? null);
    return !data.running;
  } catch (error) {
    console.error("Failed to stop paper bot:", error);
    return false;
  }
}

// Refresh history data
export async function refreshHistoryData(): Promise<void> {
  setLoading(true);

  try {
    await Promise.all([
      // Load a larger set so date-range filtering works reliably on the client.
      fetchTrades(1000),
      fetchPerformanceSummary(),
    ]);
  } catch (error) {
    setError(error instanceof Error ? error.message : "Unknown error");
  } finally {
    setLoading(false);
  }
}

// Initialize auto-refresh for live view
export function initLiveAutoRefresh() {
  setupAutoRefresh(refreshLiveData, 20000); // 20 seconds
}

// Stop auto-refresh
export function stopLiveAutoRefresh() {
  stopAutoRefresh();
}

// Health check
export async function healthCheck(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/api/paper/health`);
    const data = await response.json();
    return data.status === "healthy";
  } catch {
    return false;
  }
}
