import { useState, useEffect, useCallback, useRef } from "react";
import { useTheme as useMuiTheme } from "@mui/material/styles";
import useMuiMediaQuery from "@mui/material/useMediaQuery";
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

// useMediaQuery: MUI hook with fallback to window.matchMedia
export function useMediaQuery(query: string, defaultValue?: boolean, options?: any): boolean {
  const muiResult = (() => {
    try {
      // useMuiMediaQuery requires a query string; it handles SSR via options
      return useMuiMediaQuery(query, options);
    } catch {
      return undefined as unknown as boolean;
    }
  })();

  const [fallback, setFallback] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return Boolean(defaultValue);
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent | MediaQueryList) => setFallback((e as MediaQueryListEvent).matches ?? (e as MediaQueryList).matches);
    // Modern: addEventListener, fallback: addListener
    if ((mql as any).addEventListener) mql.addEventListener("change", handler as any);
    else (mql as any).addListener(handler);
    setFallback(mql.matches);
    return () => {
      if ((mql as any).removeEventListener) mql.removeEventListener("change", handler as any);
      else (mql as any).removeListener(handler);
    };
  }, [query]);

  if (typeof muiResult === "boolean") return muiResult;
  return fallback;
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

// useColorScheme: localStorage + MUI fallback (no legacy)
export function useColorScheme(): UIUseColorSchemeResult {
  const muiTheme: any = (() => {
    try {
      return useMuiTheme();
    } catch {
      return null;
    }
  })();
  const muiColorScheme: string | undefined = muiTheme?.colorScheme;

  const getInitial = (): "light" | "dark" => {
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem("mui-color-scheme") ?? window.localStorage.getItem("mui-color-scheme") ?? window.localStorage.getItem("color-scheme");
      if (stored === "light" || stored === "dark") return stored;
      if (muiColorScheme === "light" || muiColorScheme === "dark") return muiColorScheme;
      if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) return "dark";
    }
    return "dark";
  };

  const [colorScheme, setColorSchemeState] = useState<"light" | "dark">(getInitial);

  useEffect(() => {
    // sync from storage on mount (in case SSR mismatch)
    const stored = typeof window !== "undefined" ? (window.localStorage.getItem("mui-color-scheme") ?? window.localStorage.getItem("mui-color-scheme")) : null;
    if (stored === "light" || stored === "dark") setColorSchemeState(stored);
  }, []);

  const setColorScheme = useCallback((scheme: "light" | "dark") => {
    setColorSchemeState(scheme);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem("mui-color-scheme", scheme);
        window.localStorage.setItem("mui-color-scheme", scheme);
      } catch {}
      document.documentElement?.setAttribute("data-color-scheme", scheme);
      document.documentElement?.setAttribute("data-color-scheme", scheme);
    }
  }, []);

  const toggleColorScheme = useCallback(() => {
    setColorSchemeState((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem("mui-color-scheme", next);
          window.localStorage.setItem("mui-color-scheme", next);
        } catch {}
        document.documentElement?.setAttribute("data-color-scheme", next);
        document.documentElement?.setAttribute("data-color-scheme", next);
      }
      return next;
    });
  }, []);

  return {
    isDark: colorScheme === "dark",
    colorScheme,
    toggleColorScheme,
    setColorScheme,
  };
}

export function useTheme() {
  return useMuiTheme();
}

export function useUICore() {
  return { useMantineColorScheme: useColorScheme, useMantineTheme: useMuiTheme };
}
export function useMantineCore() {
  return { useMantineColorScheme: useColorScheme, useMantineTheme: useMuiTheme };
}

// Minimal Tree shim for compat (no legacy Tree)
export function useTree() {
  return { expanded: [], toggleExpanded: () => {}, setExpanded: () => {} } as any;
}
export function getTreeExpandedState(_data: any, _value: any): string[] {
  return [];
}
