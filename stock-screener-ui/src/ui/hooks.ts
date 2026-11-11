import { useState, useEffect, useCallback, useRef } from "react";
import { sxTheme } from "./sxTheme";
import type { UIUseColorSchemeResult } from "./types";

// rem: px -> rem (MUI compat)
export function rem(value: number | string): string {
  if (typeof value === "string") {
    const n = Number.parseFloat(value);
    if (Number.isNaN(n)) return value;
    return `${n / 16}rem`;
  }
  return `${value / 16}rem`;
}

// useMediaQuery: window.matchMedia only (no MUI)
export function useMediaQuery(query: string, defaultValue?: boolean, _options?: any): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return Boolean(defaultValue);
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    // Modern: addEventListener, fallback: addListener
    if ((mql as any).addEventListener) mql.addEventListener("change", handler as any);
    else (mql as any).addListener(handler);
    setMatches(mql.matches);
    return () => {
      if ((mql as any).removeEventListener) mql.removeEventListener("change", handler as any);
      else (mql as any).removeListener(handler);
    };
  }, [query]);

  return matches;
}

// useDebouncedValue: [debouncedValue]
export function useDebouncedValue<T>(value: T, wait: number): [T] {
  const [debounced, setDebounced] = useState<T>(value);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setDebounced(value), wait);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [value, wait]);

  return [debounced];
}

// useDisclosure: [opened, { open, close, toggle }]
export function useDisclosure(
  initialState = false,
  callbacks?: { onOpen?: () => void; onClose?: () => void },
): [boolean, { open: () => void; close: () => void; toggle: () => void }] {
  const [opened, setOpened] = useState(initialState);
  const open = useCallback(() => {
    setOpened(true);
    callbacks?.onOpen?.();
  }, [callbacks]);
  const close = useCallback(() => {
    setOpened(false);
    callbacks?.onClose?.();
  }, [callbacks]);
  const toggle = useCallback(() => {
    setOpened((v) => {
      const next = !v;
      if (next) callbacks?.onOpen?.();
      else callbacks?.onClose?.();
      return next;
    });
  }, [callbacks]);
  return [opened, { open, close, toggle }];
}

// useColorScheme: localStorage keys `mui-color-scheme` / `color-scheme` + data attributes
export function useColorScheme(): UIUseColorSchemeResult {
  const getInitial = (): "light" | "dark" => {
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem("mui-color-scheme") ?? window.localStorage.getItem("color-scheme");
      if (stored === "light" || stored === "dark") return stored;
      if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) return "dark";
    }
    return "light";
  };

  const [fallback, setFallback] = useState<"light" | "dark">(getInitial);
  const colorScheme: "light" | "dark" = fallback;

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-color-scheme", colorScheme);
      document.documentElement.setAttribute("data-mui-color-scheme", colorScheme);
      document.documentElement.style.colorScheme = colorScheme;
    }
  }, [colorScheme]);

  const setColorScheme = useCallback(
    (scheme: "light" | "dark") => {
      setFallback(scheme);
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem("mui-color-scheme", scheme);
          window.localStorage.setItem("color-scheme", scheme);
        } catch {}
        document.documentElement?.setAttribute("data-color-scheme", scheme);
        document.documentElement?.setAttribute("data-mui-color-scheme", scheme);
        document.documentElement.style.colorScheme = scheme;
      }
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const toggleColorScheme = useCallback(() => {
    const next = colorScheme === "dark" ? "light" : "dark";
    setColorScheme(next);
  }, [colorScheme, setColorScheme]);

  return {
    isDark: colorScheme === "dark",
    colorScheme,
    toggleColorScheme,
    setColorScheme,
  };
}

// useTheme: plain sxTheme (no MUI)
export function useTheme() {
  return sxTheme;
}

// useUICore: plain sxTheme (no MUI)
export function useUICore() {
  return sxTheme;
}

// Tree state: tracks expanded node values.
// initialExpandedState accepts an array of values or a record of value->bool.
export function useTree(options?: { initialExpandedState?: string[] | Record<string, boolean> }) {
  const initial = useRef<string[] | undefined>(undefined);
  if (initial.current === undefined) {
    const s = options?.initialExpandedState;
    initial.current = Array.isArray(s)
      ? [...s]
      : s && typeof s === "object"
        ? Object.keys(s).filter((k) => (s as Record<string, boolean>)[k])
        : [];
  }
  const [expanded, setExpandedState] = useState<string[]>(initial.current ?? []);
  const setExpanded = useCallback((next: string[]) => {
    setExpandedState([...next]);
  }, []);
  const toggleExpanded = useCallback((value: string) => {
    setExpandedState((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
  }, []);
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
