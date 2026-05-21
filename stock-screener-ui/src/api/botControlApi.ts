import type { PortfolioStatus } from "../types/paperTrading";
import {
  setBotStatus,
  setBotSnapshot,
  setLoading,
  setError,
  setupAutoRefresh,
  stopAutoRefresh,
  setPortfolio,
  setPositions,
} from "../state/paperTrading";
import { fetchWithAuth } from "../state/auth";
import { fetchTrades, refreshLiveData } from "./paperTrading";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8765";

type PaperBotStatus = {
  running: boolean;
  pid: number | null;
  log_file: string | null;
};

export type { PaperBotStatus };

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

// Initialize auto-refresh for live view
export function initLiveAutoRefresh() {
  setupAutoRefresh(refreshLiveData, 20000); // 20 seconds
}

// Stop auto-refresh
export function stopLiveAutoRefresh() {
  stopAutoRefresh();
}

export async function fetchBotSummaries(): Promise<any[]> {
  try {
    const response = await fetchWithAuth(`${API_BASE}/api/bots/summary`);
    const data = await response.json();
    return data || [];
  } catch (error) {
    console.error("Failed to fetch bot summaries:", error);
    return [];
  }
}

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
): Promise<{ success: boolean; pid?: number; log_file?: string | null; message?: string }> {
  try {
    const response = await fetchWithAuth(`${API_BASE}/api/bots/${botId}/start`, {
      method: "POST",
    });
    const data = await response.json();
    const started = !!data.pid;

    // The start endpoint does not return `running`, but the UI state depends on it.
    if (started) {
      setBotStatus(true, data.pid ?? null, data.log_file ?? null);
    }

    return {
      success: started,
      pid: data.pid,
      log_file: data.log_file ?? null,
      message: data.message,
    };
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

    setBotStatus(false, null, null);

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

export function normalizeBotPortfolio(
  portfolio: any,
  positions: any[],
  realizedToday: number,
): PortfolioStatus {
  const initialCapital = Number(portfolio?.initial_capital ?? 0);
  const unrealized = Number(portfolio?.unrealized_pnl ?? 0);
  const dailyPnl = realizedToday + unrealized;
  const totalPositions = Number(portfolio?.total_positions ?? positions.length ?? 0);

  return {
    initial_capital: initialCapital,
    cash: Number(portfolio?.cash ?? 0),
    margin_used: Number(portfolio?.margin_used ?? portfolio?.capital_used ?? 0),
    position_value: Number(portfolio?.position_value ?? 0),
    unrealized_pnl: unrealized,
    realized_pnl: Number(portfolio?.realized_pnl ?? 0),
    total_value: Number(portfolio?.total_value ?? 0),
    total_pnl: Number(portfolio?.total_pnl ?? 0),
    total_pnl_pct: Number(portfolio?.total_pnl_pct ?? 0),
    positions: totalPositions,
    trades: Number(portfolio?.trades ?? portfolio?.total_trades ?? 0),
    daily_pnl: dailyPnl,
    daily_pnl_pct: Number(
      portfolio?.daily_pnl_pct ?? (initialCapital > 0 ? (dailyPnl / initialCapital) * 100 : 0),
    ),
    daily_trades: Number(portfolio?.daily_trades ?? 0),
    open_positions: Number(portfolio?.open_positions ?? totalPositions),
    max_daily_loss_pct: Number(portfolio?.max_daily_loss_pct ?? 0),
    daily_loss_limit_exceeded: Boolean(portfolio?.daily_loss_limit_exceeded ?? false),
  };
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
    const trades = await fetchTrades(200, botId);
    const todayString = new Date().toDateString();
    const realizedToday = trades
      .filter((trade) => {
        if (!trade.exit_time) return false;
        const exitDate = new Date(trade.exit_time).toDateString();
        return exitDate === todayString;
      })
      .reduce((sum, trade) => sum + (trade.net_pnl ?? trade.pnl ?? 0), 0);

    // Update bot status
    if (botInfo) {
      setBotStatus(!!botInfo.running, botInfo.pid ?? null, null);
    }

    if (portfolioData) {
      const watchlist = Array.isArray(portfolioData.watchlist)
        ? portfolioData.watchlist
        : Array.from(new Set(scanItems.map((item: any) => item?.symbol).filter(Boolean)));

      // Convert bot positions to paper positions format
      const paperPositions = positions.map((p: any) => ({
        symbol: p.symbol,
        side: p.side,
        quantity: p.quantity,
        entry_price: p.entry_price,
        current_price: p.current_price || p.entry_price,
        entry_time: p.entry_time,
        stop_loss: p.stop_loss || 0,
        take_profit: p.take_profit || 0,
        pnl: p.unrealized_pnl || 0,
        pnl_pct: p.unrealized_pnl_pct || 0,
        margin_used: p.margin_used || 0,
        strategy_id: p.strategy_id,
        strategy_name: p.strategy_name,
        entry_reason: p.entry_reason || p.reason || "",
        exit_reason: null,
        peak_price: p.peak_price || 0,
        low_price: p.low_price || 0,
        notes: p.notes || "",
      }));

      setPortfolio(normalizeBotPortfolio(portfolioData.portfolio, positions, realizedToday));
      setPositions(paperPositions);

      // Convert scan items to bot snapshot format
      setBotSnapshot({
        timestamp: new Date().toISOString(),
        watchlist,
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
