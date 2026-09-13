// useBacktestWindows — layout state for the backtest page.
//  • Config + Results are floating windows (draggable/resizable), persisted.
//  • Trades is a fixed right-side dock (always visible, collapsible, resizable)
//    so the blotter can never be lost off-screen.
import { useCallback, useEffect, useRef, useState } from "react";
import type { FloatingWindowGeometry } from "@/ui";

export type BacktestWindowId = "config" | "results";

interface WindowState {
  open: boolean;
  minimized: boolean;
  geometry: FloatingWindowGeometry;
  z: number;
}

type WindowsState = Record<BacktestWindowId, WindowState>;

export interface TradesDock {
  open: boolean;
  width: number;
}

export interface BacktestLayout {
  windows: WindowsState;
  dock: TradesDock;
}

const STORAGE_KEY = "alphashri.backtest.windows.v4";

export const WINDOW_MIN_SIZES: Record<BacktestWindowId, { w: number; h: number }> = {
  config: { w: 420, h: 240 },
  results: { w: 320, h: 220 },
};

export const DOCK_MIN_WIDTH = 300;
export const DOCK_MAX_WIDTH = 760;
export const DOCK_DEFAULT_WIDTH = 420;

function viewportW(): number {
  return typeof window !== "undefined" && window.innerWidth ? window.innerWidth : 1440;
}

function viewportH(): number {
  return typeof window !== "undefined" && window.innerHeight ? window.innerHeight : 900;
}

function clampGeometry(id: BacktestWindowId, g: FloatingWindowGeometry): FloatingWindowGeometry {
  const min = WINDOW_MIN_SIZES[id];
  const width = Math.max(min.w, Math.round(g.width) || min.w);
  const height = Math.max(min.h, Math.round(g.height) || min.h);
  const x = Math.min(Math.max(-width + 80, Math.round(g.x) || 0), Math.max(0, viewportW() - 80));
  const y = Math.min(Math.max(0, Math.round(g.y) || 0), Math.max(0, viewportH() - 28));
  return { x, y, width, height };
}

function clampDockWidth(w: number): number {
  return Math.min(DOCK_MAX_WIDTH, Math.max(DOCK_MIN_WIDTH, Math.round(w) || DOCK_DEFAULT_WIDTH));
}

function defaultLayout(): BacktestLayout {
  const h = viewportH();
  const contentH = Math.max(400, h - 110);
  return {
    windows: {
      config: { open: true, minimized: false, geometry: { x: 12, y: 48, width: 660, height: 360 }, z: 1 },
      results: { open: false, minimized: false, geometry: { x: 12, y: 420, width: 520, height: 360 }, z: 2 },
    },
    dock: { open: false, width: DOCK_DEFAULT_WIDTH },
  };
}

function loadLayout(): BacktestLayout {
  const base = defaultLayout();
  if (typeof localStorage === "undefined") return base;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw) as Partial<BacktestLayout>;
    (Object.keys(base.windows) as BacktestWindowId[]).forEach((id) => {
      const s = saved.windows?.[id];
      if (s && s.geometry) {
        base.windows[id] = {
          open: Boolean(s.open),
          minimized: Boolean(s.minimized),
          geometry: clampGeometry(id, {
            x: Number(s.geometry.x) || base.windows[id].geometry.x,
            y: Number(s.geometry.y) || base.windows[id].geometry.y,
            width: Number(s.geometry.width) || base.windows[id].geometry.width,
            height: Number(s.geometry.height) || base.windows[id].geometry.height,
          }),
          z: Number(s.z) || base.windows[id].z,
        };
      }
    });
    if (saved.dock) {
      base.dock = { open: Boolean(saved.dock.open), width: clampDockWidth(Number(saved.dock.width)) };
    }
  } catch {
    /* ignore corrupt storage */
  }
  return base;
}

export interface BacktestWindowsApi {
  windows: WindowsState;
  dock: TradesDock;
  open: (id: BacktestWindowId) => void;
  close: (id: BacktestWindowId) => void;
  toggle: (id: BacktestWindowId) => void;
  minimize: (id: BacktestWindowId) => void;
  focus: (id: BacktestWindowId) => void;
  setGeometry: (id: BacktestWindowId, g: FloatingWindowGeometry) => void;
  openDock: () => void;
  closeDock: () => void;
  toggleDock: () => void;
  setDockWidth: (w: number) => void;
  reset: () => void;
}

export function useBacktestWindows(): BacktestWindowsApi {
  const [layout, setLayout] = useState<BacktestLayout>(loadLayout);
  const zCounter = useRef(Math.max(...Object.values(layout.windows).map((w) => w.z)));

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch {
      /* storage full / unavailable */
    }
  }, [layout]);

  const focus = useCallback((id: BacktestWindowId) => {
    setLayout((prev) => {
      const top = ++zCounter.current;
      if (prev.windows[id].z === top) return prev;
      return { ...prev, windows: { ...prev.windows, [id]: { ...prev.windows[id], z: top } } };
    });
  }, []);

  const open = useCallback((id: BacktestWindowId) => {
    focus(id);
    setLayout((prev) => {
      const w = prev.windows[id];
      const restored = clampGeometry(id, w.geometry);
      if (w.open && !w.minimized) return prev;
      return { ...prev, windows: { ...prev.windows, [id]: { ...w, open: true, minimized: false, geometry: restored } } };
    });
  }, [focus]);

  const close = useCallback((id: BacktestWindowId) => {
    setLayout((prev) => {
      if (!prev.windows[id].open) return prev;
      return { ...prev, windows: { ...prev.windows, [id]: { ...prev.windows[id], open: false } } };
    });
  }, []);

  const toggle = useCallback((id: BacktestWindowId) => {
    setLayout((prev) => {
      const w = prev.windows[id];
      if (w.open && !w.minimized) return { ...prev, windows: { ...prev.windows, [id]: { ...w, open: false } } };
      const top = ++zCounter.current;
      return { ...prev, windows: { ...prev.windows, [id]: { ...w, open: true, minimized: false, z: top } } };
    });
  }, []);

  const minimize = useCallback((id: BacktestWindowId) => {
    setLayout((prev) => ({ ...prev, windows: { ...prev.windows, [id]: { ...prev.windows[id], minimized: true } } }));
  }, []);

  const setGeometry = useCallback((id: BacktestWindowId, g: FloatingWindowGeometry) => {
    setLayout((prev) => ({ ...prev, windows: { ...prev.windows, [id]: { ...prev.windows[id], geometry: clampGeometry(id, g) } } }));
  }, []);

  const openDock = useCallback(() => setLayout((p) => (p.dock.open ? p : { ...p, dock: { ...p.dock, open: true } })), []);
  const closeDock = useCallback(() => setLayout((p) => (p.dock.open ? { ...p, dock: { ...p.dock, open: false } } : p)), []);
  const toggleDock = useCallback(() => setLayout((p) => ({ ...p, dock: { ...p.dock, open: !p.dock.open } })), []);
  const setDockWidth = useCallback((w: number) => setLayout((p) => ({ ...p, dock: { ...p.dock, width: clampDockWidth(w) } })), []);

  const reset = useCallback(() => {
    zCounter.current = 2;
    setLayout(defaultLayout());
  }, []);

  return {
    windows: layout.windows,
    dock: layout.dock,
    open, close, toggle, minimize, focus, setGeometry,
    openDock, closeDock, toggleDock, setDockWidth, reset,
  };
}
