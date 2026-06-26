import { createSubscriber } from "./createSubscriber";
import type {
  StrategyRunnerConfig,
  StrategyRunnerState,
  StrategyRunnerTrade,
  StrategyRunnerSummary,
} from "../types/strategyRunner";

const { subscribe, notify } = createSubscriber();

const initialState: StrategyRunnerState = {
  config: {
    bot_uuids: [],
    date: "",
    end_date: "",
    symbols: [],
  },
  bots: [],
  isRunning: false,
  progress: { currentBot: 0, totalBots: 0, currentBotName: "" },
  trades: [],
  summary: null,
  error: null,
};

let state: StrategyRunnerState = { ...initialState };

export function getState(): StrategyRunnerState {
  return state;
}

export function subscribeToRunner(callback: () => void) {
  return subscribe(callback);
}

function update(partial: Partial<StrategyRunnerState>) {
  state = { ...state, ...partial };
  notify();
}

export function setConfig(config: Partial<StrategyRunnerConfig>) {
  update({ config: { ...state.config, ...config } });
}

export function setBots(bots: StrategyRunnerState["bots"]) {
  update({ bots });
}

export function startRunning() {
  update({
    isRunning: true,
    trades: [],
    summary: null,
    progress: { currentBot: 0, totalBots: 0, currentBotName: "" },
    error: null,
  });
}

export function stopRunning() {
  update({ isRunning: false });
}

export function addTrade(trade: StrategyRunnerTrade) {
  update({ trades: [...state.trades, trade] });
}

export function setSummary(summary: StrategyRunnerSummary) {
  update({ summary });
}

export function setProgress(progress: { currentBot: number; totalBots: number; currentBotName: string }) {
  update({ progress });
}

export function setError(error: string | null) {
  update({ error, isRunning: false });
}

export function reset() {
  state = { ...initialState };
  notify();
}
