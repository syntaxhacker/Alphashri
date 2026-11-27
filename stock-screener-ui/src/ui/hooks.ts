import { createSignal, createEffect, onCleanup } from "solid-js";
import { sxTheme } from "./sxTheme";
import type { UIUseColorSchemeResult } from "./types";

// Kept for API parity with the old scale.
export function rem(value: number | string): string {
  if (typeof value === "string") {
    const n = Number.parseFloat(value);
    if (Number.isNaN(n)) return value;
    return `${n / 16}rem`;
  }
  return `${value / 16}rem`;
}

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
 * Pass either a plain value or an **accessor** — a plain value is read once,
 * because a Solid component body runs exactly once, so
 * `useDebouncedValue(count(), 300)` would never track `count`.
 *
 * Returns `[debounced]`, read as `debounced()`.
 */
export function useDebouncedValue<T>(value: T | (() => T), wait: number): [() => T] {
  const read = () => (typeof value === "function" ? (value as () => T)() : value);
  const [debounced, setDebounced] = createSignal<T>(read());

  createEffect(() => {
    // This read must stay INSIDE the effect: it is the reactive dependency that
    // re-runs the effect and restarts the timer on every later input. Reading the
    // accessor once outside would pin the debounce to the first value forever.
    const next = read();
    const timer = setTimeout(() => setDebounced(() => next), wait);
    onCleanup(() => clearTimeout(timer));
  });

  return [debounced];
}

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
// The order here is duplicated by the pre-paint bootstrap in index.html, which must
// read the same keys in the same order (src/ui/useColorScheme.test.ts guards it).
const SCHEME_KEYS = ["color-scheme", "mui-color-scheme"] as const;

function storedScheme(): "light" | "dark" | null {
  if (typeof window === "undefined") return null;
  for (const key of SCHEME_KEYS) {
    const value = window.localStorage.getItem(key);
    if (value === "light" || value === "dark") return value;
  }
  return null;
}

/** True when the user already saved a scheme — used to keep `defaultColorScheme` a seed. */
export function hasStoredColorScheme(): boolean {
  return storedScheme() !== null;
}

function initialScheme(): "light" | "dark" {
  // The pre-paint bootstrap already resolved the scheme onto <html>. Follow it
  // so JS tokens (e.g. the agri chart) cannot disagree with the painted CSS.
  if (typeof document !== "undefined") {
    const applied = document.documentElement.getAttribute("data-color-scheme");
    if (applied === "light" || applied === "dark") return applied;
  }
  const stored = storedScheme();
  if (stored) return stored;
  // The financial theme is dark by default. The OS preference is deliberately
  // not a fallback: a light OS must not paint a dark app's shell white.
  return "dark";
}

/** Keep the painted CSS and the `body[data-color-scheme]` hints in lockstep. */
function applyScheme(scheme: "light" | "dark") {
  if (typeof document === "undefined") return;
  for (const el of [document.documentElement, document.body]) {
    if (!el) continue;
    el.setAttribute("data-color-scheme", scheme);
    el.style.colorScheme = scheme;
  }
}

/**
 * One scheme for the whole app. A theme is global, so the signal cannot live
 * inside the hook: with a per-caller signal the toolbar toggle wrote
 * `data-color-scheme` (CSS flipped) while every chart that reads `colorScheme()`
 * kept the old value until it remounted.
 */
const [colorScheme, setColorSchemeSignal] = createSignal<"light" | "dark">(initialScheme());

/**
 * Apply a prop-driven scheme (UIProvider's force/default) without persisting it.
 * The stored `color-scheme` key is the user's choice and is written only by the
 * toolbar's `setColorScheme`/`toggleColorScheme`, so a provider prop cannot
 * silently overwrite it. Updating the shared signal keeps every `useColorScheme`
 * consumer (charts, toolbar, JS token accessor) on the same scheme; applying the
 * attribute here rather than waiting for the effect makes it visible immediately.
 */
export function applyColorScheme(scheme: "light" | "dark"): void {
  setColorSchemeSignal(scheme);
  applyScheme(scheme);
}

export function useColorScheme(): UIUseColorSchemeResult {
  createEffect(() => {
    applyScheme(colorScheme());
  });

  const setColorScheme = (scheme: "light" | "dark") => {
    setColorSchemeSignal(scheme);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem("color-scheme", scheme);
      } catch {}
    }
    applyScheme(scheme);
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

export function useTheme() {
  return sxTheme;
}

export function useUICore() {
  return sxTheme;
}

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
