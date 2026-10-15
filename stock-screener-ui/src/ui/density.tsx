import {
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";

/**
 * Table density: Comfortable | Compact (default Compact).
 *
 * The default is byte-identical to the pre-density Compact styling, so
 * nothing shifts visually unless the user opts into Comfortable.
 * Persisted to localStorage; also mirrored to the `--table-row-py` CSS var
 * for any non-React consumer.
 */

export type Density = "compact" | "comfortable";

export const DENSITY_STORAGE_KEY = "alphashri_ui_density";
export const TABLE_ROW_PY_VAR = "--table-row-py";

export interface DensityTokens {
  /** Vertical cell padding, e.g. "3px" (mirrored to --table-row-py). */
  tableRowPy: string;
  /** Full cell padding shorthand. */
  tableCellPad: string;
  /** Body row height in px. */
  tableRowHeight: number;
  /** CompactPanel content padding (theme spacing units). */
  panelPad: number;
  /** CompactStat content padding (theme spacing units). */
  statPad: number;
}

export const DENSITY_TOKENS: Record<Density, DensityTokens> = {
  // Compact matches the pre-density styling exactly.
  compact: {
    tableRowPy: "3px",
    tableCellPad: "3px 8px",
    tableRowHeight: 20,
    panelPad: 1,
    statPad: 1,
  },
  comfortable: {
    tableRowPy: "6px",
    tableCellPad: "6px 12px",
    tableRowHeight: 28,
    panelPad: 2,
    statPad: 2,
  },
};

export function getStoredDensity(): Density {
  try {
    const raw = localStorage.getItem(DENSITY_STORAGE_KEY);
    if (raw === "comfortable" || raw === "compact") return raw;
  } catch {
    // Storage unavailable (SSR / privacy mode) — fall through to default.
  }
  return "compact";
}

function applyRowPyVar(py: string): void {
  try {
    document.documentElement.style.setProperty(TABLE_ROW_PY_VAR, py);
  } catch {
    // No DOM (SSR / tests without document) — skip.
  }
}

let currentDensity: Density = getStoredDensity();
const listeners = new Set<() => void>();

function getDensitySnapshot(): Density {
  return currentDensity;
}

function subscribeDensity(notify: () => void): () => void {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

export function setDensity(next: Density): void {
  if (next !== "compact" && next !== "comfortable") return;
  if (next === currentDensity) {
    // Still ensure the CSS var exists (e.g. first load with stored value).
    applyRowPyVar(DENSITY_TOKENS[next].tableRowPy);
    return;
  }
  currentDensity = next;
  try {
    localStorage.setItem(DENSITY_STORAGE_KEY, next);
  } catch {
    // Storage unavailable — density still applies for this session.
  }
  applyRowPyVar(DENSITY_TOKENS[next].tableRowPy);
  for (const notify of listeners) notify();
}

// Ensure the CSS var exists on module load (matches stored/default density).
applyRowPyVar(DENSITY_TOKENS[currentDensity].tableRowPy);

export interface DensityValue {
  density: Density;
  setDensity: (next: Density) => void;
  tokens: DensityTokens;
}

/** Reactive density value; no provider required (module store + localStorage). */
export function useDensity(): DensityValue {
  const density = useSyncExternalStore(
    subscribeDensity,
    getDensitySnapshot,
    getDensitySnapshot,
  );
  return { density, setDensity, tokens: DENSITY_TOKENS[density] };
}

interface DensityProviderProps {
  children: ReactNode;
  /** Test/story override: applied on mount (and restored on unmount). */
  value?: Density;
}

/**
 * Optional subtree override for tests/stories. The app itself needs no
 * provider — `useDensity` reads the module store by default.
 */
export function DensityProvider({ children, value }: DensityProviderProps) {
  useEffect(() => {
    if (value === undefined) return;
    const prev = getDensitySnapshot();
    setDensity(value);
    return () => {
      setDensity(prev);
    };
  }, [value]);
  return <>{children}</>;
}
