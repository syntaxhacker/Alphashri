import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { Box, Loader, Text, Badge, Tooltip, useMediaQuery } from "@/ui";
import { useNavigate } from "react-router-dom";
import { usePatternFullscreen } from "@/hooks/usePatternFullscreen";
import { FALLBACK_TIMEFRAMES } from "@/components/patterns/TimeframeSelect";
import { SymbolDockContext, type SymbolDockApi } from "./symbolDockContext";
import { ErrorBoundary } from "./ErrorBoundary";

// The chart engine is heavy; only download it once a dock is actually opened.
const PatternFullscreenView = lazy(() =>
  import("@/components/patterns/PatternFullscreenView").then((m) => ({
    default: m.PatternFullscreenView,
  })),
);

/** App header height (matches `FIN_HEADER_H`). */
const DOCK_TOP = 48;
const PREVIEW_DEBOUNCE_MS = 300;
const PREVIEW_CLOSE_MS = 800;

/**
 * App-wide right-side symbol dock.
 *
 * Any `SymbolLink` on any page gets hover-preview + chart-icon-open for free:
 * the link falls back to this context when the page doesn't supply its own
 * handlers (the Patterns page does, because it owns a richer dock with a
 * stepper and as-of replay).
 *
 * Desktop only; below 1200px `open` navigates to `/chart/:symbol` and hover
 * does nothing (no hidden mid-screen panel).
 */
export function SymbolDockProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const isDesktop = useMediaQuery("(min-width: 1200px)");
  const {
    fullscreen,
    openFromSymbol,
    previewFromSymbol,
    changeFullscreenTimeframe,
    pinFullscreen,
    closeFullscreen,
    selectFullscreenHit,
  } = usePatternFullscreen({ timeframe: "1D", computeTrendlines: true });

  const previewTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const fullscreenRef = useRef(fullscreen);
  fullscreenRef.current = fullscreen;

  const clearTimers = useCallback(() => {
    if (previewTimerRef.current) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  const preview = useCallback(
    (symbol: string) => {
      if (!isDesktop) return;
      if (fullscreenRef.current?.pinned) return;
      if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current);
      // A close timer may be pending from leaving the previous symbol —
      // cancelling it keeps the new symbol's preview from being closed
      // when the old timer fires (A → B fast mouse move).
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      previewTimerRef.current = window.setTimeout(() => {
        previewFromSymbol(symbol, undefined, false);
      }, PREVIEW_DEBOUNCE_MS);
    },
    [isDesktop, previewFromSymbol],
  );

  const endPreview = useCallback(() => {
    if (previewTimerRef.current) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    if (!isDesktop) return;
    if (!fullscreenRef.current || fullscreenRef.current.pinned) return;
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      if (fullscreenRef.current && !fullscreenRef.current.pinned) closeFullscreen();
    }, PREVIEW_CLOSE_MS);
  }, [isDesktop, closeFullscreen]);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const open = useCallback(
    (symbol: string) => {
      clearTimers();
      if (!isDesktop) {
        navigate(`/chart/${encodeURIComponent(symbol)}`);
        return;
      }
      openFromSymbol(symbol);
    },
    [isDesktop, openFromSymbol, navigate, clearTimers],
  );

  const close = useCallback(() => {
    clearTimers();
    closeFullscreen();
  }, [clearTimers, closeFullscreen]);

  const api = useMemo<SymbolDockApi>(
    () => ({ preview, endPreview, open, close, pinned: Boolean(fullscreen?.pinned) }),
    [preview, endPreview, open, close, fullscreen?.pinned],
  );

  return (
    <SymbolDockContext.Provider value={api}>
      {children}
      {isDesktop && fullscreen ? (
        <Box
          data-testid="symbol-dock"
          onMouseEnter={cancelClose}
          onMouseLeave={endPreview}
          onMouseDown={pinFullscreen}
          className="fixed right-0 bottom-0 z-[1100] flex flex-col overflow-hidden border-l border-fin-border bg-fin-surface shadow-lg"
          style={{ top: DOCK_TOP, width: "clamp(420px, 36vw, 620px)" }}
        >
          {fullscreen?.stale ? (
            <Box className="absolute bottom-2 right-2 z-[1200]">
              <Tooltip label="Showing cached candles; refreshing in background">
                <Badge size="xs" variant="outline" color="warning" data-testid="dock-stale">
                  {fullscreen?.dataAsOf ? `Cached ${fullscreen.dataAsOf}` : "Cached"}
                </Badge>
              </Tooltip>
            </Box>
          ) : null}
          {fullscreen?.patternsLoading && (
            <Box
              data-testid="dock-patterns-loading"
              className="pointer-events-none absolute top-2 right-2 z-[1200] flex items-center gap-1 rounded-fin border border-fin-border bg-fin-surface px-1.5 py-0.5"
            >
              <Loader size="xs" />
              <Text size="xs" fw="medium">
                Computing patterns…
              </Text>
            </Box>
          )}
          <ErrorBoundary label="Chart" resetKey={fullscreen?.symbol}>
          <Suspense
            fallback={
              <Box className="flex flex-1 items-center justify-center">
                <Loader size="sm" />
              </Box>
            }
          >
            <PatternFullscreenView
              opened
              docked
              symbol={fullscreen?.symbol ?? null}
              hit={fullscreen?.hit ?? null}
              hits={fullscreen?.hits ?? []}
              onSelectHit={selectFullscreenHit}
              candles={fullscreen?.candles ?? []}
              trendLines={fullscreen?.trendLines ?? []}
              trendlinesView="both"
              timeframe={fullscreen?.timeframe}
              timeframes={FALLBACK_TIMEFRAMES}
              onTimeframeChange={changeFullscreenTimeframe}
              loading={fullscreen?.loading ?? false}
              asOf={fullscreen?.asOf ?? null}
              fromDate={fullscreen?.fromDate ?? null}
              onClose={close}
              onLive={() => undefined}
            />
          </Suspense>
          </ErrorBoundary>
        </Box>
      ) : null}
    </SymbolDockContext.Provider>
  );
}
