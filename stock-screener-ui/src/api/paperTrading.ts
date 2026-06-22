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
  StrategyConfig,
  AnalyticsData,
  ActivityEvent,
  AggregatedDashboardData,
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
  setChartFromDate,
  setError,
  setLoading,
  setStrategyConfig,
  setConfigLoading,
  setConfigError,
  setAnalyticsData,
  setAnalyticsLoading,
  setActivityEvents,
  setActivityLoading,
  setAggregatedData,
  setAggregatedLoading,
} from "../state/paperTrading";
import { fetchWithAuth } from "../state/auth";
import { isMarketClosedToday } from "../state/holidays";
import {
  startPaperBot,
  stopPaperBot,
  fetchPaperBotStatus,
  initLiveAutoRefresh,
  initBotAutoRefresh,
  stopLiveAutoRefresh,
  listBots,
  getBot,
  startBot,
  stopBot,
  fetchBotPortfolio,
  fetchBotPositions,
  fetchBotScanItems,
  fetchBotStrategyPerformance,
  normalizeBotPortfolio,
  refreshBotLiveData,
} from "./botControlApi";

export {
  startPaperBot,
  stopPaperBot,
  fetchPaperBotStatus,
  initLiveAutoRefresh,
  initBotAutoRefresh,
  stopLiveAutoRefresh,
  listBots,
  getBot,
  startBot,
  stopBot,
  fetchBotPortfolio,
  fetchBotPositions,
  fetchBotScanItems,
  fetchBotStrategyPerformance,
  normalizeBotPortfolio,
  refreshBotLiveData,
};

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8765";

// Fetch portfolio status
export async function fetchPortfolio(): Promise<PortfolioStatus | null> {
  try {
    const response = await fetchWithAuth(`${API_BASE}/api/paper/portfolio`);
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
    const response = await fetchWithAuth(`${API_BASE}/api/paper/positions`);
    const data = await response.json();
    const positions = data.positions || [];
    setPositions(positions);
    return positions;
  } catch (error) {
    console.error("Failed to fetch positions:", error);
    return [];
  }
}

export async function fetch52WLevels(symbol: string): Promise<{ high_52w: number; low_52w: number } | null> {
  try {
    const response = await fetchWithAuth(`${API_BASE}/api/paper/52w/${symbol}`);
    const data = await response.json();
    if (data.high_52w) {
      return { high_52w: data.high_52w, low_52w: data.low_52w || 0 };
    }
    return null;
  } catch (error) {
    console.error("Failed to fetch 52W levels:", error);
    return null;
  }
}

// Fetch trade history with optional bot and date filtering
export async function fetchTrades(
  limit: number = 100,
  botId?: string | null,
  fromDate?: string | null,
  toDate?: string | null,
  daysBack: number = 30,
): Promise<PaperTrade[]> {
  try {
    const params = new URLSearchParams();
    params.append("limit", limit.toString());
    if (botId) params.append("bot_id", botId);
    if (fromDate) params.append("from_date", fromDate);
    if (toDate) params.append("to_date", toDate);
    params.append("days_back", daysBack.toString());

    const response = await fetchWithAuth(`${API_BASE}/api/paper/trades?${params.toString()}`);
    const data = await response.json();
    const trades = data.trades || [];
    setTrades(trades);
    return trades;
  } catch (error) {
    console.error("Failed to fetch trades:", error);
    return [];
  }
}

// Delete a single trade
export async function deleteTrade(tradeId: string): Promise<{ success: boolean; message: string }> {
  try {
    const response = await fetchWithAuth(`${API_BASE}/api/paper/trades/${tradeId}`, {
      method: "DELETE",
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || "Failed to delete trade");
    }
    return { success: true, message: data.message || "Trade deleted" };
  } catch (error) {
    console.error("Failed to delete trade:", error);
    throw error;
  }
}

export async function updateTradeNotes(
  tradeId: string,
  notes: string,
  reason: string,
): Promise<PaperTrade> {
  try {
    const response = await fetchWithAuth(`${API_BASE}/api/paper/trades/${tradeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes, reason }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "Failed to update trade");
    return data;
  } catch (error) {
    console.error("Failed to update trade notes:", error);
    throw error;
  }
}

export async function updatePositionNotes(
  positionId: string,
  notes: string | null,
  reason: string | null,
): Promise<any> {
  try {
    const response = await fetchWithAuth(`${API_BASE}/api/paper/positions/${positionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes, reason }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "Failed to update position");
    return data;
  } catch (error) {
    console.error("Failed to update position notes:", error);
    throw error;
  }
}

// Fetch daily report
export async function fetchDailyReport(date?: string): Promise<DailySummary | null> {
  try {
    const url = date
      ? `${API_BASE}/api/paper/journal/daily?date=${date}`
      : `${API_BASE}/api/paper/journal/daily`;
    const response = await fetchWithAuth(url);
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
    const response = await fetchWithAuth(`${API_BASE}/api/paper/journal/summary`);
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
    const response = await fetchWithAuth(`${API_BASE}/api/paper/journal/symbols`);
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
  timeframe?: string,
  strategyId?: number | null,
  fromDate?: string,
  silent?: boolean,
): Promise<PaperChartData | null> {
  if (!silent) setChartLoading(true);

  try {
    const params = new URLSearchParams();
    if (date) params.append("date", date);
    if (fromDate) params.append("from_date", fromDate);
    if (timeframe) params.append("timeframe", timeframe);
    if (strategyId) params.append("strategy_id", String(strategyId));
    const queryString = params.toString();
    const url = queryString
      ? `${API_BASE}/api/paper/chart/${symbol}?${queryString}`
      : `${API_BASE}/api/paper/chart/${symbol}`;
    const response = await fetchWithAuth(url);
    const data = await response.json();

    if (data.error) {
      console.error("Chart data error:", data.error);
      setError(data.error);
      if (!silent) setChartData(null);
      else setChartLoading(false);
      return null;
    }

    setChartData(data);
    setChartFromDate(fromDate ?? null);
    return data;
  } catch (error) {
    console.error("Failed to fetch chart data:", error);
    if (!silent) setChartData(null);
    else setChartLoading(false);
    return null;
  }
}

// Refresh all live data
export async function refreshLiveData(): Promise<void> {
  if (isMarketClosedToday()) return;
  setLoading(true);

  try {
    await Promise.all([
      fetchPortfolio(),
      fetchPositions(),
      fetchPaperBotStatus(),
    ]);
  } catch (error) {
    setError(error instanceof Error ? error.message : "Unknown error");
  } finally {
    setLoading(false);
  }
}

// Refresh history data with optional bot and date filtering
export async function refreshHistoryData(
  botId?: string | null,
  fromDate?: string | null,
  toDate?: string | null,
  daysBack: number = 60,
): Promise<void> {
  setLoading(true);

  try {
    // If fromDate is provided, daysBack is ignored by fetchTrades (due to API logic)
    await Promise.all([
      // Load a larger set so date-range filtering works reliably on the client.
      fetchTrades(1000, botId, fromDate, toDate, fromDate ? 0 : daysBack),
      fetchPerformanceSummary(),
    ]);
  } catch (error) {
    setError(error instanceof Error ? error.message : "Unknown error");
  } finally {
    setLoading(false);
  }
}

// Health check
export async function healthCheck(): Promise<boolean> {
  try {
    const response = await fetchWithAuth(`${API_BASE}/api/paper/health`);
    const data = await response.json();
    return data.status === "healthy";
  } catch {
    return false;
  }
}

// Close a position manually
export async function closePaperPosition(
  symbol: string,
  exitPrice: number,
  reason: string = "MANUAL",
): Promise<{ success: boolean; pnl?: number }> {
  try {
    const response = await fetchWithAuth(`${API_BASE}/api/paper/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol: symbol.toUpperCase(),
        exit_price: exitPrice,
        reason: reason,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || "Failed to close position");
    }
    return { success: true, pnl: data.pnl };
  } catch (error) {
    console.error("Failed to close position:", error);
    throw error;
  }
}

export async function closeAllPositions(
  botId: string,
  prices: Record<string, number>,
): Promise<{ success: boolean; message: string }> {
  try {
    const response = await fetchWithAuth(`${API_BASE}/api/bots/${botId}/close-all`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prices }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || "Failed to close all positions");
    }
    return { success: true, message: data.message };
  } catch (error) {
    console.error("Failed to close all positions:", error);
    throw error;
  }
}

// Fetch strategy configuration
export async function fetchStrategyConfig(strategyId?: number): Promise<StrategyConfig | null> {
  setConfigLoading(true);
  try {
    const url = strategyId
      ? `${API_BASE}/api/paper/config?strategy_id=${strategyId}`
      : `${API_BASE}/api/paper/config`;
    const response = await fetchWithAuth(url);
    const data = await response.json();
    if (data.config) {
      setStrategyConfig(data.config);
      return data.config;
    }
    setConfigLoading(false);
    return null;
  } catch (error) {
    console.error("Failed to fetch strategy config:", error);
    setConfigError(error instanceof Error ? error.message : "Failed to load config");
    return null;
  }
}

// Update strategy configuration
export async function updateStrategyConfig(config: Partial<StrategyConfig>): Promise<boolean> {
  setConfigLoading(true);
  try {
    const response = await fetchWithAuth(`${API_BASE}/api/paper/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || "Failed to update config");
    }
    if (data.config) {
      setStrategyConfig(data.config);
    }
    return true;
  } catch (error) {
    console.error("Failed to update strategy config:", error);
    setConfigError(error instanceof Error ? error.message : "Failed to save config");
    return false;
  }
}

// Fetch analytics data (equity curve, P&L analytics)
export async function fetchAnalytics(daysBack: number = 90): Promise<AnalyticsData | null> {
  setAnalyticsLoading(true);
  try {
    const response = await fetchWithAuth(`${API_BASE}/api/paper/analytics?days_back=${daysBack}`);
    const data = await response.json();
    setAnalyticsData(data);
    return data;
  } catch (error) {
    console.error("Failed to fetch analytics:", error);
    setAnalyticsLoading(false);
    return null;
  }
}

// Fetch activity feed
export async function fetchActivityFeed(since?: string): Promise<ActivityEvent[]> {
  setActivityLoading(true);
  try {
    const params = new URLSearchParams();
    if (since) params.append("since", since);
    const qs = params.toString() ? `?${params.toString()}` : "";
    const response = await fetchWithAuth(`${API_BASE}/api/paper/activity/feed${qs}`);
    const data = await response.json();
    setActivityEvents(data.events || []);
    return data.events || [];
  } catch (error) {
    console.error("Failed to fetch activity feed:", error);
    setActivityLoading(false);
    return [];
  }
}

// Fetch aggregated dashboard
export async function fetchAggregatedDashboard(): Promise<AggregatedDashboardData | null> {
  setAggregatedLoading(true);
  try {
    const response = await fetchWithAuth(`${API_BASE}/api/paper/aggregated`);
    const data = await response.json();
    setAggregatedData(data);
    return data;
  } catch (error) {
    console.error("Failed to fetch aggregated dashboard:", error);
    setAggregatedLoading(false);
    return null;
  }
}

// Reset strategy configuration to defaults
export async function resetStrategyConfig(): Promise<boolean> {
  setConfigLoading(true);
  try {
    const response = await fetchWithAuth(`${API_BASE}/api/paper/config/reset`, {
      method: "POST",
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || "Failed to reset config");
    }
    if (data.config) {
      setStrategyConfig(data.config);
    }
    return true;
  } catch (error) {
    console.error("Failed to reset strategy config:", error);
    setConfigError(error instanceof Error ? error.message : "Failed to reset config");
    return false;
  }
}
