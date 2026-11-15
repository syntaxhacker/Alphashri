import { createContext, useContext } from "solid-js";

/** Imperative API exposed by the app-wide right-side symbol dock. */
export interface SymbolDockApi {
  /** Hover intent: the provider debounces and opens a preview when allowed. */
  preview: (symbol: string) => void;
  /** Pointer left the symbol: the provider dismisses an unpinned preview. */
  endPreview: () => void;
  /** Pin the symbol chart in the dock (chart icon / explicit open). */
  open: (symbol: string) => void;
  /** Close the dock and clear the selection. */
  close: () => void;
  /** True while the dock holds a user-pinned chart (previews are ignored). */
  pinned: boolean;
  /**
   * Symbol currently shown in the dock, or null. Lists use this to highlight
   * the row behind the chart — a link click opens the dock without touching
   * the list's own selection state.
   */
  symbol?: () => string | null;
  /** Inline mount node; null falls back to the fixed overlay. */
  setOutlet: (el: HTMLElement | null) => void;
}

const noop = () => {};

/**
 * Default is inert so `SymbolLink` stays renderable outside the provider
 * (unit tests, Storybook) without a Router or chart host.
 */
export const SymbolDockContext = createContext<SymbolDockApi>({
  preview: noop,
  endPreview: noop,
  open: noop,
  close: noop,
  pinned: false,
  setOutlet: noop,
});

export function useSymbolDock(): SymbolDockApi {
  return useContext(SymbolDockContext);
}
