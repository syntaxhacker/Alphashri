import { useCallback, useRef } from "react";
import { useStoreSubscription } from "./useStoreSubscription";
import * as sr from "../state/strategyRunner";
import { runStrategyRunner } from "../api/strategyRunner";
import { listBots } from "../api/bots";
import type {
  BotConfig,
} from "../types/bots";
import type {
  StrategyRunnerConfig,
  StrategyRunnerState,
  BotInfo,
  StrategyRunnerTrade,
  StrategyRunnerSummary,
} from "../types/strategyRunner";

function botConfigToBotInfo(bot: BotConfig): BotInfo {
  const primaryStrategy = bot.strategies?.[0];
  return {
    uuid: bot.uuid,
    name: bot.name,
    strategy_name: primaryStrategy?.name || "",
    strategy_type: primaryStrategy?.strategy_type || "",
    sl_pct: primaryStrategy?.sl_pct || 0,
    tp_pct: primaryStrategy?.tp_pct || 0,
    watchlist: [],
  };
}

export function useStrategyRunnerState(): StrategyRunnerState & {
  setConfig: (config: Partial<StrategyRunnerConfig>) => void;
  loadBots: () => Promise<void>;
  startRunner: () => void;
  stopRunner: () => void;
  reset: () => void;
} {
  useStoreSubscription(sr.subscribeToRunner);
  const state = sr.getState();
  const sseRef = useRef<(() => void) | null>(null);

  const loadBots = useCallback(async () => {
    try {
      const bots = await listBots();
      sr.setBots(bots.map(botConfigToBotInfo));
    } catch (err) {
      console.error("Failed to load bots:", err);
    }
  }, []);

  const startRunner = useCallback(() => {
    sr.startRunning();
    const collected: StrategyRunnerTrade[] = [];

    const cancel = runStrategyRunner(
      state.config,
      (ev: any) => {
        if (ev.event === "bot_start") {
          sr.setProgress({
            currentBot: ev.data.bot_index ?? 0,
            totalBots: ev.data.total_bots ?? 1,
            currentBotName: ev.data.bot_name || "",
          });
        } else if (ev.event === "progress") {
          sr.setProgress({
            currentBot: sr.getState().progress.currentBot,
            totalBots: sr.getState().progress.totalBots,
            currentBotName: `${ev.data.symbol || ""} ${ev.data.time || ""}`,
          });
        } else if (ev.event === "trade") {
          collected.push(ev.data as StrategyRunnerTrade);
          sr.addTrade(ev.data as StrategyRunnerTrade);
        } else if (ev.event === "bot_done") {
          sr.setProgress({
            currentBot: (ev.data.bot_index ?? 0) + 1,
            totalBots: sr.getState().progress.totalBots,
            currentBotName: `${ev.data.bot_name || ""} done (${ev.data.trades || 0} trades)`,
          });
        } else if (ev.event === "error") {
          sr.setError(ev.data?.message || "Unknown error");
        } else if (ev.event === "done") {
          // Build combined summary from collected trades
          const wins = collected.filter((t) => t.pnl > 0);
          const gp = wins.reduce((s, t) => s + t.pnl, 0);
          const gl = Math.abs(collected.filter((t) => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0));

          const byBot: Record<string, any> = {};
          for (const t of collected) {
            const bn = t.bot_name || "?";
            if (!byBot[bn]) byBot[bn] = { trades: [] };
            byBot[bn].trades.push(t);
          }
          for (const [bn, d] of Object.entries(byBot)) {
            const bt = d.trades;
            const bw = bt.filter((t: any) => t.pnl > 0).length;
            const bgp = bt.filter((t: any) => t.pnl > 0).reduce((s: number, t: any) => s + t.pnl, 0);
            const bgl = Math.abs(bt.filter((t: any) => t.pnl <= 0).reduce((s: number, t: any) => s + t.pnl, 0));
            d.summary = {
              total_trades: bt.length, winners: bw,
              win_rate: bt.length > 0 ? (bw / bt.length) * 100 : 0,
              net_pnl: bt.reduce((s: number, t: any) => s + t.net_pnl, 0),
              profit_factor: bgl > 0 ? bgp / bgl : bw > 0 ? Infinity : 0,
            };
          }

          const bySym: Record<string, any> = {};
          for (const t of collected) {
            const sym = t.symbol || "?";
            if (!bySym[sym]) bySym[sym] = { trades: [], bots: new Set() };
            bySym[sym].trades.push(t);
            bySym[sym].bots.add(t.bot_name || "?");
          }
          const symbolSummary: Record<string, any> = {};
          for (const [sym, d] of Object.entries(bySym)) {
            const st = d.trades;
            const sw = st.filter((t: any) => t.pnl > 0).length;
            const sgp = st.filter((t: any) => t.pnl > 0).reduce((s: number, t: any) => s + t.pnl, 0);
            const sgl = Math.abs(st.filter((t: any) => t.pnl <= 0).reduce((s: number, t: any) => s + t.pnl, 0));
            const botPnl: Record<string, number> = {};
            for (const t of st) botPnl[t.bot_name || "?"] = (botPnl[t.bot_name || "?"] || 0) + t.net_pnl;
            const best = Object.entries(botPnl).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
            symbolSummary[sym] = {
              total_trades: st.length, winners: sw,
              win_rate: st.length > 0 ? (sw / st.length) * 100 : 0,
              net_pnl: st.reduce((s: number, t: any) => s + t.net_pnl, 0),
              profit_factor: sgl > 0 ? sgp / sgl : sw > 0 ? Infinity : 0,
              bots_traded: d.bots.size, best_bot: best,
            };
          }

          sr.setSummary({
            total_trades: collected.length,
            winners: wins.length,
            win_rate: collected.length > 0 ? (wins.length / collected.length) * 100 : 0,
            net_pnl: collected.reduce((s, t) => s + t.net_pnl, 0),
            profit_factor: gl > 0 ? gp / gl : wins.length > 0 ? Infinity : 0,
            by_bot: Object.fromEntries(
              Object.entries(byBot).map(([k, v]) => [k, { summary: v.summary }]),
            ),
            by_symbol: symbolSummary,
          });
          sr.stopRunning();
        }
      },
      (err: Error) => sr.setError(err.message),
      () => sr.stopRunning(),
    );

    sseRef.current = cancel;
  }, [state.config]);

  const stopRunner = useCallback(() => {
    if (sseRef.current) {
      sseRef.current();
      sseRef.current = null;
    }
    sr.stopRunning();
  }, []);

  const reset = useCallback(() => {
    if (sseRef.current) {
      sseRef.current();
      sseRef.current = null;
    }
    sr.reset();
  }, []);

  return {
    ...state,
    setConfig: sr.setConfig,
    loadBots,
    startRunner,
    stopRunner,
    reset,
  };
}
