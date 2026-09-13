// useBacktestLayout — right-rail layout state for the backtest page.
// The rail holds three collapsible panels (Config / Results / Trades); the chart
// is full-bleed to the left. Panel open-state and rail width are persisted.
import { useCallback, useState, useEffect } from "react";

export type BacktestPanelId = "config" | "results" | "trades";

export interface BacktestLayoutState {
  railWidth: number;
  panels: Record<BacktestPanelId, boolean>;
}

const STORAGE_KEY = "alphashri.backtest.layout.v1";

export const RAIL_MIN_WIDTH = 320;
export const RAIL_MAX_WIDTH = 760;
export const RAIL_DEFAULT_WIDTH = 440;

const DEFAULT_PANELS: Record<BacktestPanelId, boolean> = {
  config: true,
  results: false,
  trades: false,
};

function clampWidth(w: number): number {
  return Math.min(RAIL_MAX_WIDTH, Math.max(RAIL_MIN_WIDTH, Math.round(w) || RAIL_DEFAULT_WIDTH));
}

function defaultState(): BacktestLayoutState {
  return { railWidth: RAIL_DEFAULT_WIDTH, panels: { ...DEFAULT_PANELS } };
}

function loadState(): BacktestLayoutState {
  const base = defaultState();
  if (typeof localStorage === "undefined") return base;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw) as Partial<BacktestLayoutState>;
    if (saved.railWidth) base.railWidth = clampWidth(saved.railWidth);
    if (saved.panels) {
      (Object.keys(base.panels) as BacktestPanelId[]).forEach((id) => {
        if (typeof saved.panels?.[id] === "boolean") base.panels[id] = saved.panels[id] as boolean;
      });
    }
  } catch {
    /* ignore corrupt storage */
  }
  return base;
}

export interface BacktestLayoutApi {
  railWidth: number;
  panels: Record<BacktestPanelId, boolean>;
  togglePanel: (id: BacktestPanelId) => void;
  setPanelOpen: (id: BacktestPanelId, open: boolean) => void;
  openPanel: (id: BacktestPanelId) => void;
  setRailWidth: (w: number) => void;
  reset: () => void;
}

export function useBacktestLayout(): BacktestLayoutApi {
  const [state, setState] = useState<BacktestLayoutState>(loadState);

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage unavailable */
    }
  }, [state]);

  const togglePanel = useCallback((id: BacktestPanelId) => {
    setState((p) => ({ ...p, panels: { ...p.panels, [id]: !p.panels[id] } }));
  }, []);

  const setPanelOpen = useCallback((id: BacktestPanelId, open: boolean) => {
    setState((p) => (p.panels[id] === open ? p : { ...p, panels: { ...p.panels, [id]: open } }));
  }, []);

  const openPanel = useCallback((id: BacktestPanelId) => {
    setState((p) => (p.panels[id] ? p : { ...p, panels: { ...p.panels, [id]: true } }));
  }, []);

  const setRailWidth = useCallback((w: number) => {
    setState((p) => ({ ...p, railWidth: clampWidth(w) }));
  }, []);

  const reset = useCallback(() => setState(defaultState()), []);

  return {
    railWidth: state.railWidth,
    panels: state.panels,
    togglePanel,
    setPanelOpen,
    openPanel,
    setRailWidth,
    reset,
  };
}
