import { createSignal, createEffect, onCleanup } from "solid-js";
import { sxTheme } from "./sxTheme";
import type { UIUseColorSchemeResult } from "./types";

// rem: px -> rem (kept for API parity with the old scale)
export function rem(value: number | string): string {
  if (typeof value === "string") {
    const n = Number.parseFloat(value);
    if (Number.isNaN(n)) return value;
    return `${n / 16}rem`;
  }
  return `${value / 16}rem`;
}

// useMediaQuery: window.matchMedia only. Reads reactively via a signal so
// Solid subscribers re-run when the media query flips.
export function useMediaQuery(query: string, defaultValue?: boolean, _options?: any): () => boolean {
  let initial = Boolean(defaultValue);
  if (typeof window !== "undefined" && window.matchMedia) {
    try {
      const mql = window.matchMedia(query);
      if (mql) initial = mql.matches;
    } catch {
      // matchMedia threw — keep the default.
    }
  }
  const [matches, setMatches] = createSignal<boolean>(initial);

  createEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    let mql: MediaQueryList | null;
    try {
      mql = window.matchMedia(query);
    } catch {
      return;
    }
    if (!mql) return;
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    // Modern: addEventListener, fallback: addListener
    if ((mql as any).addEventListener) mql.addEventListener("change", handler as any);
    else (mql as any).addListener(handler);
    setMatches(mql.matches);
    onCleanup(() => {
      if ((mql as any).removeEventListener) mql.removeEventListener("change", handler as any);
      else (mql as any).removeListener(handler);
    });
  });

  return matches;
}

/**
 * Debounce a value. Pass either a plain value or an **accessor** — a plain
 * value is read once, because a Solid component body runs exactly once, so
 * `useDebouncedValue(count(), 300)` would never track `count`.
 *
 * Returns `[debounced]`, read as `debounced()`.
 */
export function useDebouncedValue<T>(value: T | (() => T), wait: number): [() => T] {
  const read = () => (typeof value === "function" ? (value as () => T)() : value);
  const [debounced, setDebounced] = createSignal<T>(read());

  createEffect(() => {
    const next = read(); // tracked: re-runs when an accessor's dependency changes
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const run = () => {
      timeout = null;
      setDebounced(() => next);
    };
    timeout = setTimeout(run, wait);
    onCleanup(() => {
      if (timeout) clearTimeout(timeout);
    });
  });

  return [debounced];
}

// useDisclosure: [opened, { open, close, toggle }] — opened is a signal
export function useDisclosure(
  initialState = false,
  callbacks?: { onOpen?: () => void; onClose?: () => void },
): [() => boolean, { open: () => void; close: () => void; toggle: () => void }] {
  const [opened, setOpened] = createSignal(initialState);

  const open = () => {
    setOpened(true);
    callbacks?.onOpen?.();
  };
  const close = () => {
    setOpened(false);
    callbacks?.onClose?.();
  };
  const toggle = () => {
    const next = !opened();
    if (next) callbacks?.onOpen?.();
    else callbacks?.onClose?.();
    setOpened(next);
  };

  return [opened, { open, close, toggle }];
}

// useColorScheme: `color-scheme` is the stored key. The legacy MUI-era key is still
// READ as a fallback so existing users keep their saved preference; it is never written.
export function useColorScheme(): UIUseColorSchemeResult {
  const getInitial = (): "light" | "dark" => {
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem("mui-color-scheme") ?? window.localStorage.getItem("color-scheme");
      if (stored === "light" || stored === "dark") return stored;
      if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) return "dark";
    }
    return "light";
  };

  const [colorScheme, setColorSchemeSignal] = createSignal(getInitial());

  createEffect(() => {
    const scheme = colorScheme();
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-color-scheme", scheme);
      document.documentElement.style.colorScheme = scheme;
    }
  });

  const setColorScheme = (scheme: "light" | "dark") => {
    setColorSchemeSignal(scheme);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem("color-scheme", scheme);
      } catch {}
      document.documentElement?.setAttribute("data-color-scheme", scheme);
      document.documentElement.style.colorScheme = scheme;
    }
  };

  const toggleColorScheme = () => {
    setColorScheme(colorScheme() === "dark" ? "light" : "dark");
  };

  return {
    isDark: () => colorScheme() === "dark",
    colorScheme,
    toggleColorScheme,
    setColorScheme,
  };
}

// useTheme: plain sxTheme
export function useTheme() {
  return sxTheme;
}

// useUICore: plain sxTheme
export function useUICore() {
  return sxTheme;
}

// Tree state: tracks expanded node values.
// initialExpandedState accepts an array of values or a record of value->bool.
export function useTree(options?: { initialExpandedState?: string[] | Record<string, boolean> }) {
  const initial = options?.initialExpandedState;
  const [expanded, setExpandedSignal] = createSignal<string[]>(
    Array.isArray(initial)
      ? [...initial]
      : initial && typeof initial === "object"
        ? Object.keys(initial).filter((k) => (initial as Record<string, boolean>)[k])
        : [],
  );

  const setExpanded = (next: string[]) => {
    setExpandedSignal([...next]);
  };
  const toggleExpanded = (value: string) => {
    const prev = expanded();
    setExpandedSignal(prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]);
  };
  return { expanded, toggleExpanded, setExpanded } as any;
}
export function getTreeExpandedState(data: any, value: any): string[] {
  // "*" expands every node in the tree (recursive over children)
  if (value === "*") {
    const out: string[] = [];
    const walk = (nodes: any[]) => {
      for (const n of nodes ?? []) {
        if (n?.value !== undefined) out.push(String(n.value));
        if (Array.isArray(n?.children)) walk(n.children);
      }
    };
    walk(Array.isArray(data) ? data : []);
    return out;
  }
  if (Array.isArray(value)) return [...value];
  if (value && typeof value === "object") {
    return Object.keys(value).filter((k) => (value as Record<string, boolean>)[k]);
  }
  return [];
}
