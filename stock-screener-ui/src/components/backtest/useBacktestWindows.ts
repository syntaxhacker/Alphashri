// useBacktestWindows — floating-window layout state for the backtest page.
// Open/close, z-order, and geometry persisted to localStorage. Geometry is
// committed only when a drag/resize gesture ends (see FloatingWindow), so this
// state changes at most a few times per interaction.
import { useCallback, useEffect, useRef, useState } from "react";
import type { FloatingWindowGeometry } from "@/ui";

export type BacktestWindowId = "config" | "results" | "trades";

interface WindowState {
  open: boolean;
  minimized: boolean;
  geometry: FloatingWindowGeometry;
  z: number;
}

type WindowsState = Record<BacktestWindowId, WindowState>;

const STORAGE_KEY = "alphashri.backtest.windows.v3";

export const WINDOW_MIN_SIZES: Record<BacktestWindowId, { w: number; h: number }> = {
  config: { w: 420, h: 240 },
  results: { w: 320, h: 220 },
  trades: { w: 560, h: 160 },
};

function viewportW(): number {
  return typeof window !== "undefined" && window.innerWidth ? window.innerWidth : 1440;
}

function viewportH(): number {
  return typeof window !== "undefined" && window.innerHeight ? window.innerHeight : 900;
}

/** Keep a window reachable: enforce min size and clamp inside the viewport. */
function clampGeometry(id: BacktestWindowId, g: FloatingWindowGeometry): FloatingWindowGeometry {
  const min = WINDOW_MIN_SIZES[id];
  const width = Math.max(min.w, Math.round(g.width) || min.w);
  const height = Math.max(min.h, Math.round(g.height) || min.h);
  const x = Math.min(Math.max(-width + 80, Math.round(g.x) || 0), Math.max(0, viewportW() - 80));
  const y = Math.min(Math.max(0, Math.round(g.y) || 0), Math.max(0, viewportH() - 28));
  return { x, y, width, height };
}

function defaultState(): WindowsState {
  const h = viewportH();
  const contentH = Math.max(400, h - 110); // header + toolbar approx
  return {
    config: { open: true, minimized: false, geometry: { x: 12, y: 48, width: 660, height: 360 }, z: 1 },
    results: { open: false, minimized: false, geometry: { x: 12, y: 420, width: 500, height: 360 }, z: 2 },
    trades: { open: false, minimized: false, geometry: { x: 12, y: Math.max(150, contentH - 234), width: 980, height: 212 }, z: 3 },
  };
}

function loadState(): WindowsState {
  const base = defaultState();
  if (typeof localStorage === "undefined") return base;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw) as Partial<WindowsState>;
    (Object.keys(base) as BacktestWindowId[]).forEach((id) => {
      const s = saved[id];
      if (s && s.geometry) {
        base[id] = {
          open: Boolean(s.open),
          minimized: Boolean(s.minimized),
          geometry: clampGeometry(id, {
            x: Number(s.geometry.x) || base[id].geometry.x,
            y: Number(s.geometry.y) || base[id].geometry.y,
            width: Number(s.geometry.width) || base[id].geometry.width,
            height: Number(s.geometry.height) || base[id].geometry.height,
          }),
          z: Number(s.z) || base[id].z,
        };
      }
    });
  } catch {
    /* ignore corrupt storage */
  }
  return base;
}

export interface BacktestWindowsApi {
  windows: WindowsState;
  open: (id: BacktestWindowId) => void;
  close: (id: BacktestWindowId) => void;
  toggle: (id: BacktestWindowId) => void;
  minimize: (id: BacktestWindowId) => void;
  focus: (id: BacktestWindowId) => void;
  setGeometry: (id: BacktestWindowId, g: FloatingWindowGeometry) => void;
  reset: () => void;
}

export function useBacktestWindows(): BacktestWindowsApi {
  const [windows, setWindows] = useState<WindowsState>(loadState);
  const zCounter = useRef(Math.max(...Object.values(windows).map((w) => w.z)));

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(windows));
    } catch {
      /* storage full / unavailable */
    }
  }, [windows]);

  const focus = useCallback((id: BacktestWindowId) => {
    setWindows((prev) => {
      const top = ++zCounter.current;
      if (prev[id].z === top) return prev;
      return { ...prev, [id]: { ...prev[id], z: top } };
    });
  }, []);

  const open = useCallback((id: BacktestWindowId) => {
    focus(id);
    setWindows((prev) => {
      const w = prev[id];
      const restored = clampGeometry(id, w.geometry);
      if (w.open && !w.minimized && restored === w.geometry) return prev;
      return { ...prev, [id]: { ...w, open: true, minimized: false, geometry: restored } };
    });
  }, [focus]);

  const close = useCallback((id: BacktestWindowId) => {
    setWindows((prev) => (prev[id].open ? { ...prev, [id]: { ...prev[id], open: false } } : prev));
  }, []);

  const toggle = useCallback((id: BacktestWindowId) => {
    setWindows((prev) => {
      const w = prev[id];
      if (w.open && !w.minimized) return { ...prev, [id]: { ...w, open: false } };
      const top = ++zCounter.current;
      return { ...prev, [id]: { ...w, open: true, minimized: false, z: top } };
    });
  }, []);

  const minimize = useCallback((id: BacktestWindowId) => {
    setWindows((prev) => ({ ...prev, [id]: { ...prev[id], minimized: true } }));
  }, []);

  const setGeometry = useCallback((id: BacktestWindowId, g: FloatingWindowGeometry) => {
    setWindows((prev) => ({ ...prev, [id]: { ...prev[id], geometry: clampGeometry(id, g) } }));
  }, []);

  const reset = useCallback(() => {
    zCounter.current = 3;
    setWindows(defaultState());
  }, []);

  return { windows, open, close, toggle, minimize, focus, setGeometry, reset };
}
