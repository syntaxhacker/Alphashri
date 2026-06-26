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

    const cancel = runStrategyRunner(
      state.config,
      (event: any) => {
        switch (event.type) {
          case "bot_start":
            sr.setProgress({
              currentBot: event.currentBot,
              totalBots: event.totalBots,
              currentBotName: event.botName || "",
            });
            break;
          case "trade":
            sr.addTrade(event as StrategyRunnerTrade);
            break;
          case "bot_done":
            sr.setProgress({
              currentBot: event.currentBot,
              totalBots: event.totalBots,
              currentBotName: event.botName || "",
            });
            break;
          case "summary":
            sr.setSummary(event as StrategyRunnerSummary);
            break;
          case "error":
            sr.setError(event.message || "Unknown error");
            break;
          case "done":
            sr.stopRunning();
            break;
        }
      },
      (error: Error) => {
        sr.setError(error.message);
      },
      () => {
        sr.stopRunning();
      },
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
