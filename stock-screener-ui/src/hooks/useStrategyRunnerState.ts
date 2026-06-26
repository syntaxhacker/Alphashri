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

  const startRunner = useCallback(async () => {
    sr.startRunning();

    try {
      const result = await runStrategyRunner(state.config);
      const trades = result.trades || [];
      const summary = result.summary;

      for (const t of trades) {
        sr.addTrade(t as StrategyRunnerTrade);
      }
      if (summary) {
        sr.setSummary(summary as StrategyRunnerSummary);
      }
    } catch (err) {
      sr.setError(err instanceof Error ? err.message : String(err));
    } finally {
      sr.stopRunning();
    }
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
