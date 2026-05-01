/**
 * Sector Correlation state management
 */

import { createSubscriber } from "./createSubscriber";
import { fetchSectorCorrelation } from "../api/sectorCorrelation";
import type { SectorCorrelationResponse } from "../types/sector";

const { subscribe, notify } = createSubscriber();
export { subscribe, notify };

export let market: "india" | "america" = "india";
export let lookbackDays: number = 90;
export let data: SectorCorrelationResponse | null = null;
export let isLoading = false;
export let error: string | null = null;

export function setMarket(m: "india" | "america") {
  market = m;
  notify();
}

export function setLookbackDays(days: number) {
  lookbackDays = days;
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

export function setCorrelationData(d: SectorCorrelationResponse) {
  data = d;
  notify();
}

export async function fetchCorrelationData() {
  setIsLoading(true);
  setError(null);
  try {
    const response = await fetchSectorCorrelation({
      market,
      lookback_days: lookbackDays,
    });
    setCorrelationData(response);
    setError(null);
  } catch (err) {
    setError(err instanceof Error ? err.message : "Failed to fetch correlation data");
  } finally {
    setIsLoading(false);
  }
}
