/**
 * Backtest API Client
 */

import type {
  Strategy,
  BacktestResponse,
  SymbolChartData,
  BacktestProgress,
  CostBreakdown,
} from "../types/backtest";
import {
  setStrategies,
  setStrategiesLoading,
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

const API_BASE = "http://localhost:8765";

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
export async function runBacktest(): Promise<BacktestResponse | null> {
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
        symbols: state.selectedSymbols,
        params: state.params,
        days: state.days,
        include_costs: state.includeCosts,
      }),
    });

    const data: BacktestResponse & { chart_data?: any; candles?: any } = await response.json();

    if (data.error) {
      setError(data.error);
      return null;
    }

    if (data.results && data.totals) {
      setResults(data.results, data.totals);

      // Process chart data from response
      if (data.chart_data) {
        console.log("Processing chart data for symbols:", Object.keys(data.chart_data));
        for (const symbol of Object.keys(data.chart_data)) {
          const symbolChartData = data.chart_data[symbol];

          // Check if API already built full chart data (has pivot_levels, orb_zones, etc.)
          if (symbolChartData.pivot_levels || symbolChartData.orb_zones) {
            // API already built the chart data, use it directly
            console.log(
              `Using pre-built chart data for ${symbol}:`,
              symbolChartData.candles?.length || 0,
              "candles,",
              symbolChartData.trades?.length || 0,
              "trades",
            );
            setChartData(symbol, symbolChartData);
          } else if (data.candles && symbolChartData.trades) {
            // Legacy: API returned raw trades, build chart data on frontend
            console.log(
              `Building chart data for ${symbol}:`,
              symbolChartData.trades.length,
              "trades",
            );
            const chartData = buildChartData(
              symbol,
              data.candles[symbol],
              symbolChartData.trades,
              state.params.or_minutes || 45,
            );
            console.log(
              `Built chart data for ${symbol}:`,
              chartData.candles.length,
              "candles,",
              chartData.orb_zones.length,
              "zones,",
              chartData.trades.length,
              "trade markers",
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
export async function fetchChartData(symbol: string): Promise<SymbolChartData | null> {
  setChartLoading(true);

  try {
    const response = await fetchWithAuth(`${API_BASE}/api/backtest/chart/${symbol}`);
    const data: SymbolChartData = await response.json();

    if (data.error) {
      console.error("Chart data error:", data.error);
      setChartLoading(false);
      return null;
    }

    setChartData(symbol, data);
    return data;
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
