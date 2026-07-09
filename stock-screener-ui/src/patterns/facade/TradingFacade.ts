/**
 * TradingFacade — Facade that provides a single simplified interface to the
 * complex paper trading subsystem (~43 API functions + ~50 state fields).
 *
 * Intent (GoF): Provide a unified interface to a set of interfaces in a
 * subsystem. Facade defines a higher-level interface that makes the subsystem
 * easier to use.
 *
 * The paper trading module spreads its concerns across paperTrading.ts API,
 * botControlApi.ts, and the PaperTradingState store (~50 fields). Components
 * that need to render a dashboard view don't need to know about every
 * endpoint — they just need positions, portfolio, trades, analytics, and bot
 * status. TradingFacade hides the orchestration, error handling, and
 * aggregation behind a single loadDashboard() call.
 *
 * Testability: The facade accepts an injected TradingApiClient. In tests you
 * pass a mock client; in production the DefaultTradingApiClient delegates to
 * the real fetch-based API functions. This keeps the facade itself pure logic
 * with zero network calls.
 *
 * Usage:
 *   const facade = TradingFacade.getInstance();
 *   const dashboard = await facade.loadDashboard();
 *   console.log(dashboard.portfolio, dashboard.positions.length);
 */

import type {
  PaperPosition,
  PaperTrade,
  PortfolioStatus,
  AnalyticsData,
  BotInfo,
} from "../../types/paperTrading";

// ---------------------------------------------------------------------------
// Unified data shapes returned by the facade
// ---------------------------------------------------------------------------

export interface DashboardData {
  portfolio: PortfolioStatus | null;
  positions: PaperPosition[];
  trades: PaperTrade[];
  analytics: AnalyticsData | null;
  bots: BotInfo[];
  running: boolean;
  lastUpdated: string;
}

export interface DashboardMetadata {
  succeeded: string[];
  failed: string[];
}

export interface DashboardResult {
  data: DashboardData;
  meta: DashboardMetadata;
}

// ---------------------------------------------------------------------------
// API client contract (injectable for testability)
// ---------------------------------------------------------------------------

export interface TradingApiClient {
  fetchPortfolio(): Promise<PortfolioStatus | null>;
  fetchPositions(): Promise<PaperPosition[]>;
  fetchTrades(
    limit?: number,
    botId?: string | null,
    fromDate?: string | null,
    toDate?: string | null,
    daysBack?: number,
    signal?: AbortSignal,
  ): Promise<PaperTrade[]>;
  fetchAnalytics(daysBack?: number): Promise<AnalyticsData | null>;
  listBots(): Promise<BotInfo[]>;
  closeAllPositions(
    botId: string,
    prices: Record<string, number>,
  ): Promise<{ success: boolean; message: string }>;
  closePaperPosition(
    symbol: string,
    exitPrice: number,
    reason?: string,
  ): Promise<{ success: boolean; pnl?: number }>;
}

// ---------------------------------------------------------------------------
// Default client — delegates to the real fetch-based API layer
// ---------------------------------------------------------------------------

import {
  fetchPortfolio as realFetchPortfolio,
  fetchPositions as realFetchPositions,
  fetchTrades as realFetchTrades,
  fetchAnalytics as realFetchAnalytics,
  closePaperPosition as realClosePaperPosition,
  closeAllPositions as realCloseAllPositions,
} from "../../api/paperTrading";
import { listBots as realListBots } from "../../api/botControlApi";

export class DefaultTradingApiClient implements TradingApiClient {
  fetchPortfolio(): Promise<PortfolioStatus | null> {
    return realFetchPortfolio();
  }
  fetchPositions(): Promise<PaperPosition[]> {
    return realFetchPositions();
  }
  fetchTrades(
    limit?: number,
    botId?: string | null,
    fromDate?: string | null,
    toDate?: string | null,
    daysBack?: number,
    signal?: AbortSignal,
  ): Promise<PaperTrade[]> {
    return realFetchTrades(limit, botId, fromDate, toDate, daysBack, signal);
  }
  fetchAnalytics(daysBack?: number): Promise<AnalyticsData | null> {
    return realFetchAnalytics(daysBack);
  }
  listBots(): Promise<BotInfo[]> {
    return realListBots();
  }
  closeAllPositions(
    botId: string,
    prices: Record<string, number>,
  ): Promise<{ success: boolean; message: string }> {
    return realCloseAllPositions(botId, prices);
  }
  closePaperPosition(
    symbol: string,
    exitPrice: number,
    reason?: string,
  ): Promise<{ success: boolean; pnl?: number }> {
    return realClosePaperPosition(symbol, exitPrice, reason);
  }
}

// ---------------------------------------------------------------------------
// Facade
// ---------------------------------------------------------------------------

export class TradingFacade {
  private static instance: TradingFacade;
  private _api: TradingApiClient;

  private constructor(api?: TradingApiClient) {
    this._api = api ?? new DefaultTradingApiClient();
  }

  /**
   * Return the singleton TradingFacade. An optional TradingApiClient can be
   * provided on first call (e.g. a mock in tests); subsequent calls always
   * return the same instance.
   */
  public static getInstance(api?: TradingApiClient): TradingFacade {
    if (!TradingFacade.instance) {
      TradingFacade.instance = new TradingFacade(api);
    }
    return TradingFacade.instance;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Load the full dashboard in one call. Runs positions, portfolio, trades,
   * analytics, and bots in parallel, then assembles a single DashboardData
   * object. Partial failures are captured in DashboardResult.meta rather
   * than rejecting — the caller always gets back whatever data succeeded.
   */
  async loadDashboard(): Promise<DashboardResult> {
    const succeeded: string[] = [];
    const failed: string[] = [];

    const [positions, portfolio, trades, analytics, bots] = await Promise.all([
      this._safeCall("positions", succeeded, failed, () => this._api.fetchPositions()),
      this._safeCall("portfolio", succeeded, failed, () => this._api.fetchPortfolio()),
      this._safeCall("trades", succeeded, failed, () => this._api.fetchTrades()),
      this._safeCall("analytics", succeeded, failed, () => this._api.fetchAnalytics()),
      this._safeCall("bots", succeeded, failed, () => this._api.listBots()),
    ]);

    return {
      data: {
        positions: positions ?? [],
        portfolio: portfolio ?? null,
        trades: trades ?? [],
        analytics: analytics ?? null,
        bots: bots ?? [],
        running: (bots ?? []).some((b) => b.running),
        lastUpdated: new Date().toISOString(),
      },
      meta: { succeeded, failed },
    };
  }

  /**
   * Load portfolio summary (portfolio status + open positions) in parallel.
   */
  async loadPortfolioSummary(): Promise<{
    portfolio: PortfolioStatus | null;
    positions: PaperPosition[];
  }> {
    const [portfolio, positions] = await Promise.all([
      this._call("portfolio", () => this._api.fetchPortfolio()),
      this._call("positions", () => this._api.fetchPositions()),
    ]);

    return {
      portfolio: portfolio ?? null,
      positions: positions ?? [],
    };
  }

  /**
   * Load trade history, optionally filtered by date range.
   */
  async loadTradeHistory(
    fromDate?: string,
    toDate?: string,
  ): Promise<PaperTrade[]> {
    return this._call("trades", () =>
      this._api.fetchTrades(undefined, null, fromDate ?? null, toDate ?? null),
    );
  }

  /**
   * Load analytics data.
   */
  async loadAnalytics(daysBack?: number): Promise<AnalyticsData | null> {
    return this._call("analytics", () => this._api.fetchAnalytics(daysBack));
  }

  /**
   * Orchestrate closing all positions across all bots.
   * 1. Fetch current positions.
   * 2. Collect current prices.
   * 3. Close each bot's positions via the API.
   * 4. Report per-bot results in `errors`.
   */
  async closeAllPositions(): Promise<{
    success: boolean;
    closed: number;
    errors: string[];
  }> {
    const errors: string[] = [];
    let closed = 0;

    const bots = await this._call("bots", () => this._api.listBots());
    if (!bots || bots.length === 0) {
      return { success: true, closed: 0, errors: [] };
    }

    const results = await Promise.all(
      bots.map(async (bot) => {
        const prices: Record<string, number> = {};
        const result = await this._safeCall(
          `close-bot-${bot.id}`,
          [] as string[],
          errors,
          async () => {
            const positions = await this._api.fetchPositions();
            for (const pos of positions) {
              prices[pos.symbol] = pos.current_price;
            }
            if (Object.keys(prices).length === 0) {
              return { success: true, closed: 0 };
            }
            await this._api.closeAllPositions(bot.id, prices);
            return { success: true, closed: Object.keys(prices).length };
          },
        );
        return result;
      }),
    );

    for (const r of results) {
      if (r) closed += r.closed ?? 0;
    }

    return {
      success: errors.length === 0,
      closed,
      errors,
    };
  }

  /**
   * Refresh the list of available bots.
   */
  async refreshBotStatus(): Promise<BotInfo[]> {
    return this._call("bots", () => this._api.listBots());
  }

  // -----------------------------------------------------------------------
  // Replace the backing client (useful for tests or swapping impls)
  // -----------------------------------------------------------------------

  setApiClient(client: TradingApiClient): void {
    this._api = client;
  }

  /**
   * Reset the singleton instance for test isolation.
   */
  static reset(): void {
    TradingFacade.instance = undefined as unknown as TradingFacade;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Call an async API function and return its result. If the call throws,
   * log the error and re-throw so the caller knows it failed.
   */
  private async _call<T>(name: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      console.error(`[TradingFacade] "${name}" failed:`, err);
      throw err;
    }
  }

  /**
   * Call an async API function and return its result (or `null` on failure).
   * The provided `succeeded` / `failed` arrays are mutated so the caller can
   * report which endpoints succeeded or failed overall.
   */
  private async _safeCall<T>(
    name: string,
    succeeded: string[],
    failed: string[],
    fn: () => Promise<T>,
  ): Promise<T | null> {
    try {
      const result = await fn();
      succeeded.push(name);
      return result;
    } catch (err) {
      console.error(`[TradingFacade] "${name}" failed (graceful):`, err);
      failed.push(name);
      return null;
    }
  }
}
