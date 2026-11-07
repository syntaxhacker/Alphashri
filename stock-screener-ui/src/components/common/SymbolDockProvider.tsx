import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { Box, Loader, useMediaQuery } from "@/ui";
import { useNavigate } from "react-router-dom";
import { usePatternFullscreen } from "@/hooks/usePatternFullscreen";
import { SymbolDockContext, type SymbolDockApi } from "./symbolDockContext";

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
      previewTimerRef.current = window.setTimeout(() => {
        previewFromSymbol(symbol);
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
          sx={{
            position: "fixed",
            top: DOCK_TOP,
            right: 0,
            bottom: 0,
            width: "clamp(420px, 36vw, 620px)",
            zIndex: 1100,
            bgcolor: "background.paper",
            borderLeft: 1,
            borderColor: "divider",
            boxShadow: 4,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <Suspense
            fallback={
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1 }}>
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
              loading={fullscreen?.loading ?? false}
              asOf={fullscreen?.asOf ?? null}
              fromDate={fullscreen?.fromDate ?? null}
              onClose={close}
              onLive={() => undefined}
            />
          </Suspense>
        </Box>
      ) : null}
    </SymbolDockContext.Provider>
  );
}
