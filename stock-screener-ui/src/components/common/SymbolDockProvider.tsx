import { lazy, Show, Suspense, createEffect, createSignal, onCleanup, type JSX } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { Box, Loader, Text, Badge, Tooltip, Portal, useMediaQuery } from "@/ui";
import { useNavigate } from "@solidjs/router";
import {
  usePatternFullscreen,
  istSessionDate,
  type FullscreenChartState,
} from "@/hooks/usePatternFullscreenSolid";
import type { PatternHitDTO } from "@/types/chartPatterns";
import { FALLBACK_TIMEFRAMES } from "@/components/patterns/TimeframeSelect";
import { formatChartTick } from "@/utils/istChartTime";
import {
  SymbolDockContext,
  chartHrefForSymbol,
  isUsMarket,
  type SymbolDockApi,
  type SymbolDockMode,
} from "./symbolDockContext";
import { ErrorBoundary } from "./ErrorBoundary";
import { close as closeOptionsDock, open as openOptionsDock } from "@/state/optionsDock";

// The chart engine is heavy; only download it once a dock is actually opened.
const PatternFullscreenView = lazy(() =>
  import("@/components/patterns/PatternFullscreenView").then((m) => ({
    default: m.PatternFullscreenView,
  })),
);

// Same rule for the options chain: the panel (and its payoff ECharts) must not
// reach the entry chunk for the many sessions that never open it.
const OptionsDockPanel = lazy(() =>
  import("@/components/options-dock/OptionsDockPanel").then((m) => ({
    default: m.OptionsDockPanel,
  })),
);

/** App header height (matches `FIN_HEADER_H`). */
const DOCK_TOP = "48px";
const PREVIEW_DEBOUNCE_MS = 300;
const PREVIEW_CLOSE_MS = 800;

/**
 * The dock's `options` mode is the same rail, not a second one: one pin state,
 * one outlet, one close gesture.
 *
 * Desktop only; below 1200px `open` navigates to `/chart/:symbol` and hover
 * does nothing (no hidden mid-screen panel). Options has no route to fall back
 * to, so below 1200px it opens the bottom sheet the same way.
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
    refreshSymbolChart,
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

  const [mode, setMode] = createSignal<SymbolDockMode>("chart");
  const [optionsSymbol, setOptionsSymbol] = createSignal<string | null>(null);

  const preview = (symbol: string, market?: string) => {
    if (!isDesktop()) return;
    // US symbols have no NSE chart data — never open the NSE dock for them.
    if (isUsMarket(market)) return;
    if (mode() === "options") return;
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
    if (mode() === "options") return;
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

  const open = (symbol: string, nextMode: SymbolDockMode = "chart", market?: string) => {
    clearTimers();
    if (isUsMarket(market)) {
      // US listings have no NSE chart/options data. Route to the US chart
      // provider at every width instead of leaving an NSE dock over the page.
      if (mode() === "options") {
        closeOptionsDock();
        setOptionsSymbol(null);
      }
      closeFullscreen();
      setMode("chart");
      navigate(chartHrefForSymbol(symbol, market));
      return;
    }
    if (nextMode === "options") {
      setMode("options");
      setOptionsSymbol(symbol);
      openOptionsDock(symbol, "options");
      return;
    }
    // Leaving options tears its polling down; the chart keeps its own state.
    if (mode() === "options") {
      closeOptionsDock();
      setOptionsSymbol(null);
    }
    setMode("chart");
    if (!isDesktop()) {
      navigate(`/chart/${encodeURIComponent(symbol)}`);
      return;
    }
    openFromSymbol(symbol);
  };

  const close = () => {
    clearTimers();
    if (mode() === "options") {
      closeOptionsDock();
      setOptionsSymbol(null);
    }
    closeFullscreen();
    setMode("chart");
  };

  const [outlet, setOutlet] = createSignal<HTMLElement | null>(null);

  const [api, setApi] = createStore<SymbolDockApi>({
    preview,
    endPreview,
    open,
    close,
    pinned: Boolean(fullscreen()?.pinned),
    mode,
    symbol: () => (mode() === "options" ? optionsSymbol() : fullscreen()?.symbol ?? null),
    setOutlet,
  });
  createEffect(() => {
    const pinned = Boolean(fullscreen()?.pinned);
    setApi(produce((s) => { s.pinned = pinned; }));
  });

  /** Options has no route fallback, so it opens the rail at any width. */
  const showDock = () => {
    if (mode() === "options") return optionsSymbol() != null;
    return isDesktop() && Boolean(fullscreen());
  };

  // The inline outlet is a flex item with `basis-[38%]`. Solid's Portal leaves
  // its unclassed wrapper <div> in the outlet after the dock closes, so `:empty`
  // never matches and the table cannot reclaim the width. Mirror the open state
  // onto the outlet instead; style.css collapses it while the dock is closed.
  createEffect(() => {
    const el = outlet();
    if (el) {
      el.setAttribute("data-dock-open", showDock() ? "true" : "false");
    }
    // Desktop rail (fixed overlay, no inline outlet): reserve its width on
    // #app-main so page content can't hide behind it. Below 1200 px the dock
    // is a bottom sheet; with an outlet it ports inline — neither needs the
    // inset. The attribute mirrors open/close, width change, and unmount.
    const railOpen = showDock() && !el && isDesktop();
    document.documentElement.dataset.dockRailOpen = railOpen ? "true" : "false";
    onCleanup(() => {
      document.documentElement.dataset.dockRailOpen = "false";
    });
  });

  /**
   * Escape dismisses an open chart dock.
   *
   * `PatternFullscreenView` is always `docked` here, so its Modal Escape path is
   * unreachable; this listener is the chart dock's only Escape gesture. It is
   * attached only while the dock is open and removed on cleanup.
   *
   * The options panel owns Escape itself (restore when maximized, close
   * otherwise), so this provider never closes in options mode — that avoids
   * double-firing with the panel's own handler. Escape is also ignored when it
   * originates in an input/textarea/select/contenteditable so the user can
   * dismiss a picker without losing the dock.
   */
  const onDockKeydown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    if (mode() === "options") return;
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable)
    ) {
      return;
    }
    close();
  };

  createEffect(() => {
    const open = showDock();
    if (open) {
      document.addEventListener("keydown", onDockKeydown);
    } else {
      document.removeEventListener("keydown", onDockKeydown);
    }
    onCleanup(() => document.removeEventListener("keydown", onDockKeydown));
  });

  const renderPanel = () => (
    <Show
      when={mode() === "options"}
      fallback={
        <Box
          data-testid="symbol-dock"
          onMouseEnter={cancelClose}
          onMouseLeave={endPreview}
          onMouseDown={pinFullscreen}
          className="flex flex-1 min-h-0 w-full flex-col overflow-hidden border-l border-fin-border bg-fin-surface"
        >
          <DockContent
            state={fullscreen()!}
            onSelectHit={selectFullscreenHit}
            onTimeframeChange={changeFullscreenTimeframe}
            onRefresh={refreshSymbolChart}
            onClose={close}
            onLive={() => undefined}
          />
        </Box>
      }
    >
      <Box
        data-testid="symbol-dock"
        data-mode="options"
        className="flex flex-1 min-h-0 w-full flex-col overflow-hidden border-l border-fin-border bg-fin-surface"
      >
        <ErrorBoundary label="Options" resetKey={optionsSymbol() ?? undefined}>
          <Suspense
            fallback={
              <Box className="flex flex-1 items-center justify-center">
                <Loader size="sm" />
              </Box>
            }
          >
            <OptionsDockPanel onClose={close} />
          </Suspense>
        </ErrorBoundary>
      </Box>
    </Show>
  );

  return (
    <SymbolDockContext.Provider value={api}>
      {props.children}
      <Show when={showDock()}>
        <Show
          when={outlet()}
          fallback={
            <Show
              when={isDesktop()}
              fallback={
                // Below 1200 px the chart dock navigates away; options has no
                // route to fall back to, so it becomes a bottom sheet instead of
                // a rail that hangs off the left edge.
                <Box
                  onMouseEnter={cancelClose}
                  onMouseLeave={endPreview}
                  className="fixed bottom-0 left-0 right-0 z-[1100] flex flex-col overflow-hidden border-t border-fin-border bg-fin-surface shadow-lg"
                  style={{ height: "62dvh" }}
                  data-testid="options-dock-sheet"
                >
                  {renderPanel()}
                </Box>
              }
            >
              <Box
                onMouseEnter={cancelClose}
                onMouseLeave={endPreview}
                onMouseDown={pinFullscreen}
                className="fixed right-0 bottom-0 z-[1100] flex flex-col overflow-hidden border-l border-fin-border bg-fin-surface shadow-lg"
                style={{ top: DOCK_TOP, width: "clamp(480px, 36vw, 620px)" }}
              >
                {renderPanel()}
              </Box>
            </Show>
          }
        >
          <Portal target={outlet()!}>
            <Box
              onMouseEnter={cancelClose}
              onMouseLeave={endPreview}
              onMouseDown={pinFullscreen}
              className="flex flex-1 min-h-0 w-full flex-col overflow-hidden border-l border-fin-border bg-fin-surface"
            >
              {renderPanel()}
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
  onRefresh: () => void;
  onClose: () => void;
  onLive: () => void;
}) {
  /**
   * Detection can trail the displayed series: the 1D chart appends today's tape
   * bar for display only, so `hits`/`bars_ago` stay on the completed-session
   * frame. Without this the dock presents a two-session-old pattern read as if
   * it described the last candle. `stale` already covers the opposite case (the
   * display itself lagging), so it stays untouched here.
   */
  const detectionNote = () => {
    const detected = props.state.detectionAsOf;
    if (!detected) return null;
    const candles = props.state.candles ?? [];
    const barDate = istSessionDate(candles.length ? candles[candles.length - 1].t : null);
    if (!barDate || detected >= barDate) return null;
    return `Detection through ${formatChartTick(detected).toUpperCase()}`;
  };

  return (
    <Box
      data-testid="symbol-dock-body"
      className="relative flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <Show when={detectionNote() || props.state.stale}>
        <Box className="pointer-events-none absolute bottom-2 right-2 z-[1200] flex max-w-[70%] flex-col items-end gap-1">
          <Show when={detectionNote()}>
            {(note) => (
              <Text
                size="xs"
                c="dimmed"
                truncate
                maw={220}
                title="Patterns were detected on this session; the chart also shows newer display-only bars"
                data-testid="dock-detection-asof"
                className="pointer-events-auto text-ui-micro leading-none"
              >
                {note()}
              </Text>
            )}
          </Show>
          <Show when={props.state.stale}>
            <Box className="pointer-events-auto">
              <Tooltip label="Showing cached candles; refreshing in background">
                <Badge size="xs" variant="outline" color="warning" data-testid="dock-stale">
                  {props.state.dataAsOf ? `Cached ${props.state.dataAsOf}` : "Cached"}
                </Badge>
              </Tooltip>
            </Box>
          </Show>
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
            onRefresh={props.onRefresh}
            loading={props.state.loading ?? false}
            asOf={props.state.asOf ?? null}
            fromDate={props.state.fromDate ?? null}
            chartError={props.state.chartError ?? null}
            chartNote={props.state.chartNote ?? null}
            livePrice={props.state.livePrice ?? null}
            liveChange={props.state.liveChange ?? null}
            onClose={props.onClose}
            onLive={props.onLive}
          />
        </Suspense>
      </ErrorBoundary>
    </Box>
  );
}
