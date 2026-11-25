/**
 * Session-scoped chart-indicator preferences.
 *
 * A module-level Solid signal: the choice survives pattern navigation,
 * timeframe changes and fullscreen/dock remounts for this browser session, but
 * is deliberately never written to localStorage and starts from the canonical
 * defaults on a fresh page load.
 */

import { createSignal } from "solid-js";
import {
  DEFAULT_CHART_INDICATOR_PREFS,
  type ChartIndicatorId,
  type ChartIndicatorPrefs,
} from "@/config/chartIndicators";

const initialPrefs = (): ChartIndicatorPrefs => ({ ...DEFAULT_CHART_INDICATOR_PREFS });

const [prefs, setPrefs] = createSignal<ChartIndicatorPrefs>(initialPrefs());

/** Reactive snapshot; components may call this inside a memo/effect. */
export const chartIndicatorPrefs = prefs;

export function isChartIndicatorEnabled(id: ChartIndicatorId): boolean {
  return prefs()[id];
}

export function setChartIndicator(id: ChartIndicatorId, enabled: boolean): void {
  setPrefs((prev) => (prev[id] === enabled ? prev : { ...prev, [id]: enabled }));
}

export function toggleChartIndicator(id: ChartIndicatorId): void {
  setPrefs((prev) => ({ ...prev, [id]: !prev[id] }));
}

export function resetChartIndicatorPrefs(): void {
  setPrefs(initialPrefs());
}

/** Test-only teardown, matching the store `__resetX` convention. */
export function __resetChartIndicatorPrefsForTests(): void {
  resetChartIndicatorPrefs();
}
