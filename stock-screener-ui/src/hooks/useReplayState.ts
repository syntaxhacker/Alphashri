import { useCallback, useEffect } from "react";
import { useStoreSubscription } from "./useStoreSubscription";
import * as rs from "../state/replay";
import { runReplay, fetchReplaySymbols } from "../api/replay";
import type { ReplayConfig, ReplayEvent, ReplayState } from "../types/replay";

function configToParams(config: ReplayConfig): Record<string, string> {
  const p: Record<string, string> = {};
  if (config.date) p.date = config.date;
  if (config.end_date) p.end_date = config.end_date;
  if (config.strategy && config.strategy !== "ALL") p.strategy = config.strategy;
  if (config.symbols && config.symbols.length > 0) p.symbols = config.symbols.join(",");
  if (config.bot_uuid) p.bot = config.bot_uuid;
  return p;
}

function paramsToConfig(searchParams: URLSearchParams): Partial<ReplayConfig> {
  const p: Partial<ReplayConfig> = {};
  const date = searchParams.get("date");
  if (date) p.date = date;
  const end_date = searchParams.get("end_date");
  if (end_date) p.end_date = end_date;
  const strategy = searchParams.get("strategy");
  if (strategy) p.strategy = strategy;
  const symbols = searchParams.get("symbols");
  if (symbols) p.symbols = symbols.split(",").map(s => s.trim()).filter(Boolean);
  const bot = searchParams.get("bot");
  if (bot) p.bot_uuid = bot;
  return p;
}

export function useReplayState(): ReplayState & {
  setConfig: (config: Partial<ReplayConfig>) => void;
  startReplay: () => void;
  stopReplay: () => void;
  reset: () => void;
  setSelectedSymbol: (symbol: string) => void;
  setStrategyFilter: (filter: string) => void;
  loadSymbols: () => Promise<string[]>;
} {
  useStoreSubscription(rs.subscribeToReplay);
  const state = rs.getReplayState();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = paramsToConfig(params);
    if (Object.keys(fromUrl).length > 0) {
      rs.setConfig(fromUrl);
    }
  }, []);

  useEffect(() => {
    const params = configToParams(state.config);
    const qs = new URLSearchParams(params).toString();
    const newUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    if (window.location.href !== `${window.location.origin}${newUrl}`) {
      window.history.replaceState(null, "", newUrl);
    }
  }, [state.config.date, state.config.end_date, state.config.strategy, state.config.symbols, state.config.bot_uuid]);

  const startReplay = useCallback(() => {
    rs.startRunning();
    let tradeId = 0;

    runReplay(
      state.config,
      (event: ReplayEvent) => {
        switch (event.type) {
          case "loaded":
            rs.setTotals(event.symbols, event.candles);
            break;
          case "progress":
            rs.setProgress(event);
            break;
          case "or_levels":
            rs.addORLevels(event);
            if (!rs.getReplayState().selectedSymbol) {
              rs.setSelectedSymbol(event.symbol);
            }
            break;
          case "pivot_levels": {
            const normalized = {
              ...event,
              pp: (event as any).PP ?? (event as any).pp,
              r1: (event as any).R1 ?? (event as any).r1,
              r2: (event as any).R2 ?? (event as any).r2,
              s1: (event as any).S1 ?? (event as any).s1,
              s2: (event as any).S2 ?? (event as any).s2,
            };
            rs.addPivotLevels(normalized);
            break;
          }
          case "52w_high":
            rs.add52WLevel(event);
            break;
          case "ema_series":
            rs.setEMAData(event);
            break;
          case "candles":
            rs.addCandles(event.symbol, event.candles);
            if (!rs.getReplayState().selectedSymbol) {
              rs.setSelectedSymbol(event.symbol);
            }
            break;
          case "trade_open":
            if (!rs.getReplayState().selectedSymbol) {
              rs.setSelectedSymbol(event.symbol);
            }
            rs.addOpenPosition({
              strategy: event.strategy,
              symbol: event.symbol,
              side: event.side,
              entry_price: event.price,
              sl: event.sl,
              tp: event.tp,
              entry_time: event.time,
              quantity: event.quantity,
            });
            break;
          case "trade_close":
            tradeId++;
            rs.closeOpenPosition(event.symbol, event.strategy);
            rs.addTrade({ ...event, id: tradeId, exit_reason: event.reason });
            rs.setSelectedSymbol(event.symbol);
            break;
          case "summary":
            rs.setSummary(event);
            break;
          case "error":
            rs.setError(event.message);
            break;
          case "done":
            rs.stopRunning();
            break;
        }
      },
      (error: Error) => {
        rs.setError(error.message);
      },
      () => {
        rs.stopRunning();
      },
    );
  }, [state.config]);

  const stopReplay = useCallback(() => {
    rs.stopRunning();
  }, []);

  const reset = useCallback(() => {
    rs.reset();
  }, []);

  const loadSymbols = useCallback(async (): Promise<string[]> => {
    return fetchReplaySymbols();
  }, []);

  return {
    ...state,
    setConfig: rs.setConfig,
    startReplay,
    stopReplay,
    reset,
    setSelectedSymbol: rs.setSelectedSymbol,
    setStrategyFilter: rs.setStrategyFilter,
    setChartOptions: rs.setChartOptions,
    setHighlightedTrade: rs.setHighlightedTrade,
    loadSymbols,
  };
}
