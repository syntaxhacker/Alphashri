import { fetchNiftyReplayDates, fetchOptionsReplayDates } from "@/api/reportNifty";
import { fetchLiveSensex } from "@/api/reportNifty";
import type { NiftySensex } from "@/types/niftyReport";
import { CHART_SOURCE_VALUES, NIFTY_CHART_SOURCE_KEY, SENSEX_REQUEST_TIMEOUT_MS } from "./niftyReportStore.types";
import type { ChartSource, ReportSymbol } from "./niftyReportStore.types";

export function readStoredEnum<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
  } catch {
    return fallback;
  }
}

export function persist(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    return;
  }
}

export function readChartSource(): ChartSource {
  return readStoredEnum<ChartSource>(NIFTY_CHART_SOURCE_KEY, CHART_SOURCE_VALUES, "live");
}

export function persistChartSource(value: ChartSource): void {
  persist(NIFTY_CHART_SOURCE_KEY, value);
}

export function replayDatesFor(symbol: ReportSymbol, signal?: AbortSignal): Promise<string[]> {
  return symbol === "NIFTY" ? fetchNiftyReplayDates(signal) : fetchOptionsReplayDates(symbol, signal);
}

export async function fetchSensexWithinTimeout(controller: AbortController): Promise<NiftySensex> {
  let timedOut = false;
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, SENSEX_REQUEST_TIMEOUT_MS);
  try {
    return await fetchLiveSensex(controller.signal);
  } catch (fetchError) {
    if (timedOut) {
      const timeoutError = new Error("Sensex data request timed out");
      timeoutError.name = "SensexTimeoutError";
      throw timeoutError;
    }
    throw fetchError;
  } finally {
    window.clearTimeout(timer);
  }
}

export function isTimeoutError(value: unknown): boolean {
  return value instanceof Error && value.name === "SensexTimeoutError";
}

export function messageOf(value: unknown, fallback: string): string {
  return value instanceof Error ? value.message : fallback;
}

export function isAuthFailure(message: string): boolean {
  return /401|token|unauthor|expired/i.test(message);
}
