/**
 * Backtest API Client
 */

import type {
  Strategy,
  StrategyVariation,
  BacktestResponse,
  SymbolChartData,
  BacktestProgress,
  CostBreakdown,
  BacktestHistoryItem,
  BacktestHistoryDetails,
  BacktestResult,
  BacktestTotals,
} from "../types/backtest";
import {
  setStrategies,
  setStrategiesLoading,
  setVariations,
  setResults,
  setRunning,
  setProgress,
  setError,
  setChartData,
  setChartLoading,
  setCostBreakdown,
  getBacktestState,
} from "../state/backtest";
import { buildChartData } from "./chartBuilder";
import { fetchWithAuth } from "../state/auth";
import { notifications } from "@mantine/notifications";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8765";

function showBacktestError(message: string) {
  notifications.show({
    title: "Backtest Error",
    message,
    color: "red",
  });
}

// Calculate totals from results
export function calculateTotals(results: BacktestResult[]): BacktestTotals {
  const totalTrades = results.reduce((sum, r) => sum + (r.trades || 0), 0);
  const totalWins = results.reduce((sum, r) => sum + (r.wins || 0), 0);
  const totalGrossPnl = results.reduce((sum, r) => sum + (r.gross_pnl || 0), 0);
  const totalCosts = results.reduce((sum, r) => sum + (r.total_costs || 0), 0);
  const winRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;

  return {
    trades: totalTrades,
    gross_pnl: totalGrossPnl,
    total_costs: totalCosts,
    net_pnl: totalGrossPnl - totalCosts,
    win_rate: winRate,
  };
}

// Fetch available strategies
export async function fetchStrategies(): Promise<Strategy[]> {
  setStrategiesLoading(true);

  try {
    const response = await fetchWithAuth(`${API_BASE}/api/backtest/strategies`);
    const data = await response.json();

    if (data.strategies) {
      setStrategies(data.strategies);
      return data.strategies;
    }
    return [];
  } catch (error) {
    console.error("Failed to fetch strategies:", error);
    setStrategiesLoading(false);
    return [];
  }
}

// Fetch strategy variations from database
export async function fetchVariations(): Promise<StrategyVariation[]> {
  try {
    const response = await fetchWithAuth(`${API_BASE}/api/strategies/variations`);
    const data = await response.json();

    if (Array.isArray(data)) {
      setVariations(data);
      return data;
    }
    return [];
  } catch (error) {
    console.error("Failed to fetch variations:", error);
    return [];
  }
}

// Fetch cost breakdown
export async function fetchCosts(): Promise<CostBreakdown | null> {
  try {
    const response = await fetchWithAuth(`${API_BASE}/api/backtest/costs`);
    const data = await response.json();

    if (data.costs) {
      setCostBreakdown(data.costs);
      return data.costs;
    }
    return null;
  } catch (error) {
    console.error("Failed to fetch costs:", error);
    return null;
  }
}

// Run backtest
export async function runBacktest(saveToHistory = false): Promise<BacktestResponse | null> {
  const state = getBacktestState();

  setRunning(true);
  setProgress({ current: 0, total: state.selectedSymbols.length, message: "Starting..." });

  try {
    const response = await fetchWithAuth(`${API_BASE}/api/backtest/run?include_chart_data=true`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        strategy: state.selectedStrategy,
        variation_id: state.selectedVariation,
        symbols: state.selectedSymbols,
        params: state.params,
        days: state.days,
        include_costs: state.includeCosts,
        save_to_history: saveToHistory,
      }),
    });

    if (!response.ok) {
      let msg = `Request failed (${response.status})`;
      try {
        const errBody = await response.json();
        msg = errBody.detail || errBody.error || msg;
      } catch {}
      setError(msg);
      showBacktestError(msg);
      return null;
    }

    const data: BacktestResponse & { chart_data?: any; candles?: any; saved_uuid?: string } =
      await response.json();

    if (data.error) {
      setError(data.error);
      showBacktestError(data.error);
      return null;
    }

    if (data.results) {
      // Calculate totals if not provided (single stock backtest)
      const totals = data.totals || calculateTotals(data.results);
      setResults(data.results, totals);

      // Process chart data from response
      if (data.chart_data) {
        for (const symbol of Object.keys(data.chart_data)) {
          const symbolChartData = data.chart_data[symbol];

          // Check if API already built full chart data (has pivot_levels, orb_zones, week52_levels, etc.)
          if (
            symbolChartData.pivot_levels ||
            symbolChartData.orb_zones ||
            symbolChartData.week52_levels
          ) {
            // API already built the chart data, use it directly
            setChartData(symbol, symbolChartData);
          } else if (data.candles && symbolChartData.trades) {
            // Legacy: API returned raw trades, build chart data on frontend
            const chartData = buildChartData(
              symbol,
              data.candles[symbol],
              symbolChartData.trades,
              state.params.or_minutes || 45,
            );
            setChartData(symbol, chartData);
          }
        }
      }

      return data;
    }

    return data;
  } catch (error) {
    console.error("Failed to run backtest:", error);
    setError(error instanceof Error ? error.message : "Unknown error");
    return null;
  }
}

// Fetch chart data for a symbol
export async function fetchChartData(symbol: string, tf?: number): Promise<SymbolChartData | null> {
  setChartLoading(true);

  try {
    const params = tf != null ? `?tf=${tf}` : "";
    const response = await fetchWithAuth(`${API_BASE}/api/backtest/chart/${symbol}${params}`);

    if (!response.ok) {
      console.error("Chart data error:", response.status);
      setChartLoading(false);
      return null;
    }

    const data = (await response.json()) as any;

    if (data.error || data.detail) {
      console.error("Chart data error:", data.error || data.detail);
      setChartLoading(false);
      return null;
    }

    if (!data.candles || !Array.isArray(data.candles)) {
      console.error("Chart data missing candles");
      setChartLoading(false);
      return null;
    }

    const chartData: SymbolChartData = data;
    setChartData(symbol, chartData);
    return chartData;
  } catch (error) {
    console.error("Failed to fetch chart data:", error);
    setChartLoading(false);
    return null;
  }
}

// Fetch progress (for long-running backtests)
export async function fetchProgress(): Promise<BacktestProgress | null> {
  try {
    const response = await fetchWithAuth(`${API_BASE}/api/backtest/progress`);
    return await response.json();
  } catch (error) {
    console.error("Failed to fetch progress:", error);
    return null;
  }
}

// Fetch cached results
export async function fetchResults(): Promise<BacktestResponse | null> {
  try {
    const response = await fetchWithAuth(`${API_BASE}/api/backtest/results`);
    return await response.json();
  } catch (error) {
    console.error("Failed to fetch results:", error);
    return null;
  }
}

// --- History Methods ---

// Fetch backtest history list
export async function fetchBacktestHistory(): Promise<BacktestHistoryItem[]> {
  try {
    const response = await fetchWithAuth(`${API_BASE}/api/backtest/history`);
    const data = await response.json();
    return data.history || [];
  } catch (error) {
    console.error("Failed to fetch backtest history:", error);
    return [];
  }
}

// Fetch detailed backtest from history
export async function fetchBacktestDetails(uuid: string): Promise<BacktestHistoryDetails | null> {
  try {
    const response = await fetchWithAuth(`${API_BASE}/api/backtest/history/${uuid}`);
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.error("Failed to fetch backtest details:", error);
    return null;
  }
}

// Delete backtest from history
export async function deleteBacktest(uuid: string): Promise<boolean> {
  try {
    const response = await fetchWithAuth(`${API_BASE}/api/backtest/history/${uuid}`, {
      method: "DELETE",
    });
    return response.ok;
  } catch (error) {
    console.error("Failed to delete backtest:", error);
    return false;
  }
}
