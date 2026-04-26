import { createSubscriber } from "./createSubscriber";
import type {
  ReplayConfig,
  ReplayProgress,
  ReplayTrade,
  ReplayOpenPosition,
  ReplayORLevels,
  ReplayPivotLevels,
  Replay52WLevel,
  ReplayEMAData,
  ReplaySummary,
  ReplayCandle,
  ReplayChartOptions,
} from "../types/replay";

const { subscribe, notify } = createSubscriber();

const defaultChartOptions: ReplayChartOptions = {
  show_orb_zones: false,
  show_pivot_levels: false,
  show_52w_high: false,
  show_ema: false,
  show_markers: false,
  show_all_trades: false,
};

const initialState = {
  config: {
    date: "",
    strategy: "ALL",
    symbols: null,
    refresh_cache: false,
    bot_uuid: "",
  } as ReplayConfig,
  isRunning: false,
  progress: null as ReplayProgress | null,
  trades: [] as ReplayTrade[],
  openPositions: [] as ReplayOpenPosition[],
  orLevels: [] as ReplayORLevels[],
  pivotLevels: [] as ReplayPivotLevels[],
  high52wLevels: [] as Replay52WLevel[],
  emaData: {} as Record<string, ReplayEMAData>,
  summary: null as ReplaySummary | null,
  candlesBySymbol: {} as Record<string, ReplayCandle[]>,
  selectedSymbol: "",
  strategyFilter: "ALL",
  error: null as string | null,
  totalCandles: 0,
  totalSymbols: 0,
  chartOptions: defaultChartOptions,
  highlightedTradeId: null as number | null,
};

let state = { ...initialState };

export function getReplayState() {
  return state;
}

export function subscribeToReplay(callback: () => void) {
  return subscribe(callback);
}

function update(partial: Partial<typeof state>) {
  state = { ...state, ...partial };
  notify();
}

export function setConfig(config: Partial<ReplayConfig>) {
  update({ config: { ...state.config, ...config } });
}

export function startRunning() {
  update({
    isRunning: true,
    trades: [],
    openPositions: [],
    orLevels: [],
    pivotLevels: [],
    high52wLevels: [],
    emaData: {},
    summary: null,
    progress: null,
    error: null,
    candlesBySymbol: {},
    selectedSymbol: "",
  });
}

export function stopRunning() {
  update({ isRunning: false });
}

export function addTrade(trade: Omit<ReplayTrade, "id">) {
  const id = state.trades.length + 1;
  update({ trades: [...state.trades, { ...trade, id }] });
}

export function addOpenPosition(position: Omit<ReplayOpenPosition, "id">) {
  const id = state.openPositions.length + 1;
  update({ openPositions: [...state.openPositions, { ...position, id }] });
}

export function closeOpenPosition(symbol: string, strategy: string) {
  update({
    openPositions: state.openPositions.filter(
      (p) => !(p.symbol === symbol && p.strategy === strategy),
    ),
  });
}

export function setProgress(progress: ReplayProgress | null) {
  update({ progress });
}

export function setSummary(summary: ReplaySummary) {
  update({ summary });
}

export function addCandles(symbol: string, candles: ReplayCandle[]) {
  const existing = state.candlesBySymbol[symbol] || [];
  update({
    candlesBySymbol: {
      ...state.candlesBySymbol,
      [symbol]: [...existing, ...candles],
    },
  });
}

export function addORLevels(levels: ReplayORLevels) {
  update({ orLevels: [...state.orLevels, levels] });
}

export function addPivotLevels(levels: ReplayPivotLevels) {
  update({ pivotLevels: [...state.pivotLevels, levels] });
}

export function add52WLevel(level: Replay52WLevel) {
  update({ high52wLevels: [...state.high52wLevels, level] });
}

export function setEMAData(data: ReplayEMAData) {
  update({ emaData: { ...state.emaData, [data.symbol]: data } });
}

export function setSelectedSymbol(symbol: string) {
  update({ selectedSymbol: symbol });
}

export function setStrategyFilter(filter: string) {
  update({ strategyFilter: filter });
}

export function setChartOptions(options: Partial<ReplayChartOptions>) {
  update({ chartOptions: { ...state.chartOptions, ...options } });
}

export function setHighlightedTrade(tradeId: number | null) {
  if (tradeId !== null) {
    const trade = state.trades.find((t) => t.id === tradeId);
    if (trade) {
      update({ highlightedTradeId: tradeId });
      autoToggleOverlays(trade.strategy);
      return;
    }
  }
  update({ highlightedTradeId: tradeId });
}

export function autoToggleOverlays(_strategy: string) {
  update({
    chartOptions: {
      ...state.chartOptions,
      show_all_trades: false,
    },
  });
}

export function setError(error: string | null) {
  update({ error, isRunning: false });
}

export function setTotals(symbols: number, candles: number) {
  update({ totalSymbols: symbols, totalCandles: candles });
}

export function reset() {
  state = { ...initialState };
  notify();
}
