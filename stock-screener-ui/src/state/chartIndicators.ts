/**
 * Chart-indicator preferences, persisted across page loads.
 *
 * A module-level Solid signal seeded from localStorage: the choice survives
 * pattern navigation, timeframe changes, fullscreen/dock remounts and reloads.
 * Stored data is untrusted — unknown ids and non-boolean values are discarded
 * and every missing id keeps its canonical default.
 */

import { createSignal } from "solid-js";
import {
  DEFAULT_CHART_INDICATOR_PREFS,
  type ChartIndicatorId,
  type ChartIndicatorPrefs,
} from "@/config/chartIndicators";

export const CHART_INDICATOR_PREFS_STORAGE_KEY = "alphashri_chart_indicators_v1";

const VALID_IDS = new Set(Object.keys(DEFAULT_CHART_INDICATOR_PREFS));

const initialPrefs = (): ChartIndicatorPrefs => ({ ...DEFAULT_CHART_INDICATOR_PREFS });

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage ?? null;
  } catch {
    // Storage can be blocked by privacy settings; defaults still work.
    return null;
  }
}

function readStoredPrefs(): ChartIndicatorPrefs {
  const prefs = initialPrefs();
  const store = storage();
  if (!store) return prefs;
  try {
    const raw = store.getItem(CHART_INDICATOR_PREFS_STORAGE_KEY);
    if (!raw) return prefs;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return prefs;
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (VALID_IDS.has(id) && typeof value === "boolean") {
        prefs[id as ChartIndicatorId] = value;
      }
    }
  } catch {
    // Corrupt JSON is treated the same as a missing key.
  }
  return prefs;
}

function persistPrefs(prefs: ChartIndicatorPrefs): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(CHART_INDICATOR_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // A failed write must never interrupt toggling an indicator.
  }
}

const [prefs, setPrefs] = createSignal<ChartIndicatorPrefs>(readStoredPrefs());

/** Reactive snapshot; components may call this inside a memo/effect. */
export const chartIndicatorPrefs = prefs;

export function isChartIndicatorEnabled(id: ChartIndicatorId): boolean {
  return prefs()[id];
}

export function setChartIndicator(id: ChartIndicatorId, enabled: boolean): void {
  const previous = prefs();
  if (previous[id] === enabled) return;
  const next = { ...previous, [id]: enabled };
  setPrefs(next);
  persistPrefs(next);
}

export function toggleChartIndicator(id: ChartIndicatorId): void {
  const previous = prefs();
  const next = { ...previous, [id]: !previous[id] };
  setPrefs(next);
  persistPrefs(next);
}

export function resetChartIndicatorPrefs(): void {
  const next = initialPrefs();
  setPrefs(next);
  persistPrefs(next);
}

/** Test-only teardown, matching the store `__resetX` convention. */
export function __resetChartIndicatorPrefsForTests(): void {
  resetChartIndicatorPrefs();
  try {
    storage()?.removeItem(CHART_INDICATOR_PREFS_STORAGE_KEY);
  } catch {
    // Nothing to clean when storage is unavailable.
  }
}
