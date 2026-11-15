import { lazy, Show, Suspense, createEffect, createSignal, onCleanup, type JSX } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { Box, Loader, Text, Badge, Tooltip, Portal, useMediaQuery } from "@/ui";
import { useNavigate } from "@solidjs/router";
import {
  usePatternFullscreen,
  type FullscreenChartState,
} from "@/pages/report/usePatternFullscreenSolid";
import type { PatternHitDTO } from "@/types/chartPatterns";
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
const DOCK_TOP = "48px";
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
export function SymbolDockProvider(props: { children?: JSX.Element }) {
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

  let previewTimer: number | null = null;
  let closeTimer: number | null = null;
  let fullscreenSnapshot = fullscreen();

  const clearTimers = () => {
    if (previewTimer) {
      window.clearTimeout(previewTimer);
      previewTimer = null;
    }
    if (closeTimer) {
      window.clearTimeout(closeTimer);
      closeTimer = null;
    }
  };
  // Mirror the latest fullscreen state into a plain variable so the debounce
  // timers can read it without subscribing to every chart tick.
  createEffect(() => {
    fullscreenSnapshot = fullscreen() ?? null;
  });
  onCleanup(clearTimers);

  const preview = (symbol: string) => {
    if (!isDesktop()) return;
    if (fullscreenSnapshot?.pinned) return;
    if (previewTimer) window.clearTimeout(previewTimer);
    // A close timer may be pending from leaving the previous symbol —
    // cancelling it keeps the new symbol's preview from being closed
    // when the old timer fires (A → B fast mouse move).
    if (closeTimer) {
      window.clearTimeout(closeTimer);
      closeTimer = null;
    }
    previewTimer = window.setTimeout(() => {
      previewFromSymbol(symbol, undefined, false);
    }, PREVIEW_DEBOUNCE_MS);
  };

  const endPreview = () => {
    if (previewTimer) {
      window.clearTimeout(previewTimer);
      previewTimer = null;
    }
    if (!isDesktop()) return;
    if (!fullscreenSnapshot || fullscreenSnapshot.pinned) return;
    if (closeTimer) window.clearTimeout(closeTimer);
    closeTimer = window.setTimeout(() => {
      if (fullscreenSnapshot && !fullscreenSnapshot.pinned) closeFullscreen();
    }, PREVIEW_CLOSE_MS);
  };

  const cancelClose = () => {
    if (closeTimer) {
      window.clearTimeout(closeTimer);
      closeTimer = null;
    }
  };

  const open = (symbol: string) => {
    clearTimers();
    if (!isDesktop()) {
      navigate(`/chart/${encodeURIComponent(symbol)}`);
      return;
    }
    openFromSymbol(symbol);
  };

  const close = () => {
    clearTimers();
    closeFullscreen();
  };

  const [outlet, setOutlet] = createSignal<HTMLElement | null>(null);

  const [api, setApi] = createStore<SymbolDockApi>({
    preview,
    endPreview,
    open,
    close,
    pinned: Boolean(fullscreen()?.pinned),
    setOutlet,
  });
  createEffect(() => {
    const pinned = Boolean(fullscreen()?.pinned);
    setApi(produce((s) => { s.pinned = pinned; }));
  });

  return (
    <SymbolDockContext.Provider value={api}>
      {props.children}
      <Show when={isDesktop() && fullscreen()}>
        <Show
          when={outlet()}
          fallback={
            <Box
              data-testid="symbol-dock"
              onMouseEnter={cancelClose}
              onMouseLeave={endPreview}
              onMouseDown={pinFullscreen}
              className="fixed right-0 bottom-0 z-[1100] flex flex-col overflow-hidden border-l border-fin-border bg-fin-surface shadow-lg"
              style={{ top: DOCK_TOP, width: "clamp(420px, 36vw, 620px)" }}
            >
              <DockContent
                state={fullscreen()!}
                onSelectHit={selectFullscreenHit}
                onTimeframeChange={changeFullscreenTimeframe}
                onClose={close}
                onLive={() => undefined}
              />
            </Box>
          }
        >
          <Portal target={outlet()!}>
            <Box
              data-testid="symbol-dock"
              onMouseEnter={cancelClose}
              onMouseLeave={endPreview}
              onMouseDown={pinFullscreen}
              className="flex h-full min-h-0 w-full flex-col overflow-hidden border-l border-fin-border bg-fin-surface"
            >
              <DockContent
                state={fullscreen()!}
                onSelectHit={selectFullscreenHit}
                onTimeframeChange={changeFullscreenTimeframe}
                onClose={close}
                onLive={() => undefined}
              />
            </Box>
          </Portal>
        </Show>
      </Show>
    </SymbolDockContext.Provider>
  );
}

/** A component, not a `fn()` call, so the chart is not rebuilt on every state tick. */
function DockContent(props: {
  state: FullscreenChartState;
  onSelectHit: (hit: PatternHitDTO) => void;
  onTimeframeChange: (tf: string) => void;
  onClose: () => void;
  onLive: () => void;
}) {
  return (
    <>
      <Show when={props.state.stale}>
        <Box className="absolute bottom-2 right-2 z-[1200]">
          <Tooltip label="Showing cached candles; refreshing in background">
            <Badge size="xs" variant="outline" color="warning" data-testid="dock-stale">
              {props.state.dataAsOf ? `Cached ${props.state.dataAsOf}` : "Cached"}
            </Badge>
          </Tooltip>
        </Box>
      </Show>
      <Show when={props.state.patternsLoading}>
        <Box
          data-testid="dock-patterns-loading"
          className="pointer-events-none absolute top-2 right-2 z-[1200] flex items-center gap-1 rounded-fin border border-fin-border bg-fin-surface px-1.5 py-0.5"
        >
          <Loader size="xs" />
          <Text size="xs" fw="medium">
            Computing patterns…
          </Text>
        </Box>
      </Show>
      <ErrorBoundary label="Chart" resetKey={props.state.symbol}>
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
            symbol={props.state.symbol ?? null}
            hit={props.state.hit ?? null}
            hits={props.state.hits ?? []}
            onSelectHit={props.onSelectHit}
            candles={props.state.candles ?? []}
            trendLines={props.state.trendLines ?? []}
            trendlinesView="both"
            timeframe={props.state.timeframe}
            timeframes={FALLBACK_TIMEFRAMES}
            onTimeframeChange={props.onTimeframeChange}
            loading={props.state.loading ?? false}
            asOf={props.state.asOf ?? null}
            fromDate={props.state.fromDate ?? null}
            onClose={props.onClose}
            onLive={props.onLive}
          />
        </Suspense>
      </ErrorBoundary>
    </>
  );
}
