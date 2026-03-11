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
  StrategyConfig,
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
  setStrategyConfig,
  setConfigLoading,
  setConfigError,
} from "../state/paperTrading";
import { fetchWithAuth } from "../state/auth";

const API_BASE = "http://localhost:8765";

type PaperBotStatus = {
  running: boolean;
  pid: number | null;
  log_file: string | null;
};

export async function fetchPaperBotSnapshot(): Promise<PaperBotSnapshot | null> {
  try {
    const response = await fetchWithAuth(`${API_BASE}/api/paper/bot/snapshot`);
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

// Fetch trade history with optional bot filtering
export async function fetchTrades(
  limit: number = 100,
  botId?: string | null,
): Promise<PaperTrade[]> {
  try {
    const params = new URLSearchParams();
    params.append("limit", limit.toString());
    if (botId) params.append("bot_id", botId);
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
): Promise<PaperChartData | null> {
  setChartLoading(true);

  try {
    const params = new URLSearchParams();
    if (date) params.append("date", date);
    if (timeframe) params.append("timeframe", timeframe);
    const queryString = params.toString();
    const url = queryString
      ? `${API_BASE}/api/paper/chart/${symbol}?${queryString}`
      : `${API_BASE}/api/paper/chart/${symbol}`;
    console.log("[API] Fetching chart:", { symbol, date, timeframe, url });
    const response = await fetchWithAuth(url);
    const data = await response.json();
    console.log("[API] Chart response:", {
      candleCount: data.candles?.length,
      symbol: data.symbol,
      date: data.date,
    });

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
    const response = await fetchWithAuth(`${API_BASE}/api/paper/bot/status`);
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
    const response = await fetchWithAuth(`${API_BASE}/api/paper/bot/start`, { method: "POST" });
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
    const response = await fetchWithAuth(`${API_BASE}/api/paper/bot/stop`, { method: "POST" });
    const data = await response.json();
    setBotStatus(!!data.running, data.pid ?? null, data.log_file ?? null);
    return !data.running;
  } catch (error) {
    console.error("Failed to stop paper bot:", error);
    return false;
  }
}

// Refresh history data with optional bot filtering
export async function refreshHistoryData(botId?: string | null): Promise<void> {
  setLoading(true);

  try {
    await Promise.all([
      // Load a larger set so date-range filtering works reliably on the client.
      fetchTrades(1000, botId),
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

// ==================== Multi-Strategy Bot API Functions ====================

// List all available bots
export async function listBots(): Promise<any[]> {
  try {
    const response = await fetchWithAuth(`${API_BASE}/api/bots`);
    const data = await response.json();
    return data || [];
  } catch (error) {
    console.error("Failed to list bots:", error);
    return [];
  }
}

// Get bot details
export async function getBot(botId: string): Promise<any | null> {
  try {
    const response = await fetchWithAuth(`${API_BASE}/api/bots/${botId}`);
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Failed to get bot:", error);
    return null;
  }
}

// Start a multi-strategy bot
export async function startBot(
  botId: string,
): Promise<{ success: boolean; pid?: number; message?: string }> {
  try {
    const response = await fetchWithAuth(`${API_BASE}/api/bots/${botId}/start`, {
      method: "POST",
    });
    const data = await response.json();
    return { success: !!data.pid, pid: data.pid, message: data.message };
  } catch (error) {
    console.error("Failed to start bot:", error);
    return {
      success: false,
      message: error instanceof Error ? error.message : "Failed to start bot",
    };
  }
}

// Stop a multi-strategy bot
export async function stopBot(botId: string): Promise<{ success: boolean; message?: string }> {
  try {
    const response = await fetchWithAuth(`${API_BASE}/api/bots/${botId}/stop`, {
      method: "POST",
    });
    const data = await response.json();
    return { success: true, message: data.message };
  } catch (error) {
    console.error("Failed to stop bot:", error);
    return {
      success: false,
      message: error instanceof Error ? error.message : "Failed to stop bot",
    };
  }
}

// Get bot portfolio with per-strategy breakdown
export async function fetchBotPortfolio(botId: string): Promise<any | null> {
  try {
    const response = await fetchWithAuth(`${API_BASE}/api/bots/${botId}/portfolio`);
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Failed to fetch bot portfolio:", error);
    return null;
  }
}

// Get bot positions (optionally filtered by strategy)
export async function fetchBotPositions(botId: string, strategyId?: string): Promise<any[]> {
  try {
    const params = new URLSearchParams();
    if (strategyId) params.set("strategy_id", strategyId);
    const url = `${API_BASE}/api/bots/${botId}/positions${params.toString() ? "?" + params : ""}`;
    const response = await fetchWithAuth(url);
    const data = await response.json();
    return data.positions || [];
  } catch (error) {
    console.error("Failed to fetch bot positions:", error);
    return [];
  }
}

// Get bot scan items (optionally filtered by strategy)
export async function fetchBotScanItems(botId: string, strategyId?: string): Promise<any[]> {
  try {
    const params = new URLSearchParams();
    if (strategyId) params.set("strategy_id", strategyId);
    const url = `${API_BASE}/api/bots/${botId}/scan${params.toString() ? "?" + params : ""}`;
    const response = await fetchWithAuth(url);
    const data = await response.json();
    return data.scan_items || [];
  } catch (error) {
    console.error("Failed to fetch bot scan items:", error);
    return [];
  }
}

// Get bot strategy performance
export async function fetchBotStrategyPerformance(
  botId: string,
  includeTest: boolean = true,
): Promise<any | null> {
  try {
    const params = new URLSearchParams();
    if (!includeTest) params.set("include_test", "false");
    const url = `${API_BASE}/api/bots/${botId}/strategy-performance${params.toString() ? "?" + params : ""}`;
    const response = await fetchWithAuth(url);
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Failed to fetch bot strategy performance:", error);
    return null;
  }
}

// Refresh data from multi-strategy bot
export async function refreshBotLiveData(botId: string): Promise<void> {
  setLoading(true);
  try {
    const [botInfo, portfolioData, positions, scanItems] = await Promise.all([
      getBot(botId),
      fetchBotPortfolio(botId),
      fetchBotPositions(botId),
      fetchBotScanItems(botId),
    ]);

    // Update bot status
    if (botInfo) {
      setBotStatus(!!botInfo.running, botInfo.pid ?? null, null);
    }

    if (portfolioData) {
      setPortfolio(portfolioData.portfolio);
      // Convert bot positions to paper positions format
      const paperPositions = positions.map((p: any) => ({
        symbol: p.symbol,
        side: p.side,
        quantity: p.quantity,
        entry_price: p.entry_price,
        current_price: p.current_price || p.entry_price,
        entry_time: p.entry_time,
        stop_loss: p.sl_price || 0,
        take_profit: p.tp_price || 0,
        pnl: p.unrealized_pnl || 0,
        pnl_pct: p.unrealized_pnl_pct || 0,
        margin_used: p.margin_used || 0,
        strategy_id: p.strategy_id,
        strategy_name: p.strategy_name,
      }));
      setPositions(paperPositions);

      // Convert scan items to bot snapshot format
      setBotSnapshot({
        timestamp: new Date().toISOString(),
        watchlist: [],
        open_positions: positions.map((p: any) => p.symbol),
        scan_items: scanItems,
        signals: [],
      });
    }
  } catch (error) {
    setError(error instanceof Error ? error.message : "Unknown error");
  } finally {
    setLoading(false);
  }
}
