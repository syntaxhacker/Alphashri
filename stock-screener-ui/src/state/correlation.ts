import { createSubscriber } from "./createSubscriber";
import { fetchCorrelation } from "../api/correlation";
import type { CorrelationDataPoint } from "../api/correlation";

const { subscribe, notify } = createSubscriber();
export { subscribe, notify };

export let symbols: string[] = [];
export let timeframe: "daily" | "intraday" = "daily";
export let period = 90;
let periodUnit: "days" | "minutes" = "days";
export let matrix: number[][] | null = null;
export let normalized: Record<string, CorrelationDataPoint[]> | null = null;
export let meta: { start_date: string; end_date: string; data_points: number } | null = null;
export let isLoading = false;
export let error: string | null = null;

export function setSymbols(s: string[]) {
  symbols = s;
  notify();
}

export function addSymbol(symbol: string) {
  if (!symbols.includes(symbol)) {
    symbols = [...symbols, symbol];
    notify();
  }
}

export function removeSymbol(symbol: string) {
  symbols = symbols.filter((s) => s !== symbol);
  notify();
}

export function setTimeframe(tf: "daily" | "intraday") {
  timeframe = tf;
  notify();
}

export function setPeriod(p: number) {
  period = p;
  notify();
}

export function setPeriodUnit(u: "days" | "minutes") {
  periodUnit = u;
  notify();
}

export function setIsLoading(loading: boolean) {
  isLoading = loading;
  notify();
}

export function setError(err: string | null) {
  error = err;
  notify();
}

export function setCorrelationData(data: {
  matrix: number[][];
  normalized: Record<string, CorrelationDataPoint[]>;
  meta: { start_date: string; end_date: string; data_points: number };
}) {
  matrix = data.matrix;
  normalized = data.normalized;
  meta = data.meta;
  notify();
}

// The deep-linked tab, the Calculate button and a Compare landing can all fire
// this fetch. Only the newest request may publish: a slower, older response
// must not overwrite its data, error or loading state.
let requestGeneration = 0;

export async function fetchCorrelationData() {
  const generation = ++requestGeneration;
  setIsLoading(true);
  setError(null);
  try {
    const response = await fetchCorrelation({
      symbols,
      timeframe,
      period,
      period_unit: periodUnit,
    });
    if (generation !== requestGeneration) return;
    setCorrelationData({
      matrix: response.matrix,
      normalized: response.normalized,
      meta: response.meta,
    });
    setError(null);
  } catch (err) {
    if (generation !== requestGeneration) return;
    setError(err instanceof Error ? err.message : "Failed to fetch correlation data");
  } finally {
    if (generation === requestGeneration) {
      setIsLoading(false);
    }
  }
}
