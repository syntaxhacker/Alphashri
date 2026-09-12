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

function viewportH(): number {
  return typeof window !== "undefined" && window.innerHeight ? window.innerHeight : 900;
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
          geometry: {
            x: Number(s.geometry.x) || base[id].geometry.x,
            y: Number(s.geometry.y) || base[id].geometry.y,
            width: Number(s.geometry.width) || base[id].geometry.width,
            height: Number(s.geometry.height) || base[id].geometry.height,
          },
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
    setWindows((prev) => (prev[id].open && !prev[id].minimized ? prev : { ...prev, [id]: { ...prev[id], open: true, minimized: false } }));
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
    setWindows((prev) => ({ ...prev, [id]: { ...prev[id], geometry: g } }));
  }, []);

  const reset = useCallback(() => {
    zCounter.current = 3;
    setWindows(defaultState());
  }, []);

  return { windows, open, close, toggle, minimize, focus, setGeometry, reset };
}
