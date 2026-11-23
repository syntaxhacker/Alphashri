import { For, Show, Suspense, createEffect, createMemo, createSignal, lazy } from "solid-js";
import type { JSX } from "solid-js";

import { ActionIcon, Box, Button, Text, useMediaQuery } from "@/ui";
import * as palette from "@/ui/palette";
import type { NiftyStrike } from "@/types/niftyReport";

import { BreadthStrip } from "./BreadthStrip";
import { DeskDock } from "./DeskDock";
import type { DeskDockTab } from "./DeskDock";
import { NiftyWallsCard } from "./NiftyWallsCard";
import { useNiftyReport } from "./ReportContext";
import type { HeatMetric } from "./niftyReportStore";
import { NiftyOiChain, getNiftyOiColumns } from "./reportCells";
import { LiveTapeDisclosure } from "./reportBits";
import { REPORT_FONT, REPORT_GUTTER } from "./reportTokens";

// The chart, greeks, skew and heatmap are the heavy panels of the workspace.
// Each gets its own lazy boundary so the chain/table chrome paints first and a
// panel streams in behind a height-matched skeleton.
const NiftyChartPanel = lazy(() =>
  import("./NiftyChartPanel").then((m) => ({ default: m.NiftyChartPanel })),
);
const NiftyDeltaPositioning = lazy(() =>
  import("./NiftyDeltaPositioning").then((m) => ({ default: m.NiftyDeltaPositioning })),
);
const NiftyGexProfile = lazy(() =>
  import("./NiftyGexProfile").then((m) => ({ default: m.NiftyGexProfile })),
);
const NiftyIvSkew = lazy(() =>
  import("./NiftyIvSkew").then((m) => ({ default: m.NiftyIvSkew })),
);
const NiftyOiHeatmap = lazy(() =>
  import("./NiftyOiHeatmap").then((m) => ({ default: m.NiftyOiHeatmap })),
);

const CHART_HEIGHTS = { s: 180, m: 320, l: 520, xl: 760 } as const;
const CHART_ROW_CHROME = 48;
const FILL_MAX_HEIGHT = 300;

// The desktop chart is the largest block, but 77% of the viewport leaves the
// dock a 26px stub. The content grid settles it near 56% (496px at 890px tall,
// 538px at 950px), and 58vh is the hard ceiling for tall viewports — both well
// above the ~380px where a candle chart stops being readable. A viewport cap
// keeps the flex-1/min-h-0 chain intact; no fixed height is set on a flex panel.
const DESK_CHART_ROW_SHARE = "0.56";
const DESK_CHART_ROW_MAX_CLASS = "min-[1200px]:max-h-[58vh]";
const CHART_FILL_CHAIN = "flex-1 min-h-0";

// The dock used to grow a 354px drawer that stole height from the chart. That
// reclaimed band is now a permanent rail: walls (CW/PW/MP/PIN) and breadth are
// readable beside the chart with no click, and the drawer overlays the rail
// instead of resizing the chart. At 890px the chart canvas measures 467px, so
// 430px is the stated floor an open dock must never cross.
export const DESK_CHART_FLOOR_PX = 430;
const DESK_RAIL_HEIGHT_PX = 136;
// Replay keeps only the walls summary in this rail (breadth/movers are absent),
// so the extra row is dead space — give it back to the chart. The populated
// compact card is taller than the unavailable one and needs its own reserve.
const DESK_RAIL_REPLAY_HEIGHT_PX = 84;
const DESK_RAIL_REPLAY_WALLS_HEIGHT_PX = 112;

// On a wide desk the chain hugs its five rows (`align-self: flex-start` on the
// panel itself), so a growing chain slot would strand the same dead band under
// it. Pin that slot to its content and let the heatmap own the flex remainder.
const CHAIN_SLOT_BASE = "min-h-0 min-w-0 flex [&>*]:flex-1 [&>*]:min-w-0 [&>*]:min-h-0";
const CHAIN_SLOT_FILL = `flex-auto ${CHAIN_SLOT_BASE}`;
const CHAIN_SLOT_HUG = `shrink-0 ${CHAIN_SLOT_BASE}`;

const ANALYTICS_CELL_CLASS = "min-w-0 min-h-0 flex flex-col [&>*]:flex-1 [&>*]:min-h-0";

const ANALYTICS_FILL_CELL_CLASS = `${ANALYTICS_CELL_CLASS} [contain:none] min-[1200px]:[contain:size]`;

const SIDE_TAB_STYLE: JSX.CSSProperties = {
  height: "28px",
  "min-width": "0",
  "padding-left": "8px",
  "padding-right": "8px",
  "padding-top": "0",
  "padding-bottom": "0",
  "font-size": `${REPORT_FONT.micro}px`,
  "font-weight": 800,
  "letter-spacing": "0.06em",
};

const HEAT_METRIC_STYLE: JSX.CSSProperties = {
  "min-width": "32px",
  "padding-left": "8px",
  "padding-right": "8px",
  "padding-top": "0",
  "padding-bottom": "0",
  "font-size": `${REPORT_FONT.micro}px`,
  "line-height": 1.4,
};

const EXPAND_ICON_STYLE: JSX.CSSProperties = {
  color: palette.TEXT_MUTED,
  "background-color": palette.TERM_HEADER,
};

const EXPAND_ICON_CLASS = "absolute top-0.5 right-0.5 p-[2px] rounded-none hover:text-fin-text!";

const EXPAND_GLYPH_STYLE: JSX.CSSProperties = {
  "font-size": `${REPORT_FONT.micro}px`,
  "line-height": 1,
};

const HEAT_METRICS: HeatMetric[] = ["oi", "volume", "premium"];

const HEATMAP_EXPAND_CLASS =
  "absolute top-0 right-0 w-[22px] h-[18px] min-w-[22px] px-0 py-0 leading-[18px] text-ui-micro z-[3]";

// A 57px treemap is noise. On a phone the side row becomes just the disclosure
// plus this summary, and the heatmap moves to the existing full-view drawer.
// `auto` sizes that row to its content: 28px collapsed, ~64px open, so the
// collapsed state returns its dead band to the chart instead of reserving it.
// Static literals so Tailwind emits both variants.
const MOBILE_GRID_DEFAULT = "max-[600px]:grid-rows-[minmax(0,1fr)_minmax(0,96px)]";
const MOBILE_GRID_HEATMAP = "max-[600px]:grid-rows-[minmax(0,1fr)_auto]";
// The chain rail needs two full strike rows on a phone, not just its header.
// 156px = 32px tabs + ~40px panel header + 28px table header + 2×26px rows,
// with a few pixels of the next row showing as the vertical scroll cue. The old
// 80px reserve showed only the sticky table header — an empty strip. The chart
// still owns the first grid track; heatmap keeps its content-sized row.
const MOBILE_GRID_CHAIN = "max-[600px]:grid-rows-[minmax(0,1fr)_minmax(0,156px)]!";

// The phone dock bar has more tabs than the viewport. Keep it horizontally
// scrollable and fade the clipped label under a chevron instead of cutting the
// word in half; the cue sits over the bar but never takes a pointer event.
const DOCK_OVERFLOW_WRAP_CLASS = [
  "relative mt-auto w-full shrink-0",
  "max-[600px]:[&_[data-testid='desk-dock']]:flex-nowrap!",
  "max-[600px]:[&_[data-testid='desk-dock']]:overflow-x-auto!",
].join(" ");
const DOCK_OVERFLOW_CUE_CLASS =
  "pointer-events-none absolute right-0 bottom-0 z-30 hidden h-[36px] w-[28px] items-center justify-center max-[600px]:flex";
const DOCK_OVERFLOW_CUE_STYLE: JSX.CSSProperties = {
  background: `linear-gradient(to left, ${palette.TERM_HEADER} 45%, transparent)`,
  color: palette.TEXT_MUTED,
  "font-size": `${REPORT_FONT.micro}px`,
  "font-weight": 800,
};

const MOBILE_HEAT_METRIC_STYLE: JSX.CSSProperties = {
  height: "24px",
  "min-height": "24px",
  "min-width": "32px",
  "padding-left": "8px",
  "padding-right": "8px",
  "padding-top": "0",
  "padding-bottom": "0",
  "font-size": `${REPORT_FONT.micro}px`,
  "line-height": "1.2",
};

const MOBILE_HEAT_OPEN_STYLE: JSX.CSSProperties = {
  height: "24px",
  "min-height": "24px",
  "padding-left": "8px",
  "padding-right": "8px",
  "font-size": `${REPORT_FONT.micro}px`,
  "line-height": "1.2",
};

function MobileHeatmapSummary(props: {
  open: boolean;
  onToggle: () => void;
  metric: HeatMetric;
  onMetric: (metric: HeatMetric) => void;
  onOpenFull: () => void;
}) {
  return (
    <LiveTapeDisclosure
      open={props.open}
      onToggle={props.onToggle}
      testId="nifty-heatmap-mobile-disclosure"
      label="OI HEATMAP"
      openHint="hide"
      closedHint="tap for view options"
    >
      <Box
        data-testid="nifty-heatmap-metric-toggle"
        className="flex flex-wrap items-center gap-2 px-2 pb-2"
      >
        <For each={HEAT_METRICS}>
          {(metric) => (
            <Button
              data-testid={`nifty-heatmap-metric-${metric}`}
              size="sm"
              variant={props.metric === metric ? "filled" : "subtle"}
              aria-pressed={props.metric === metric}
              title={metricTitle(metric)}
              onClick={() => props.onMetric(metric)}
              style={MOBILE_HEAT_METRIC_STYLE}
            >
              {metricLabel(metric)}
            </Button>
          )}
        </For>
        <Button
          data-testid="nifty-heatmap-expand"
          size="sm"
          variant="subtle"
          aria-label="Expand the OI heatmap"
          title="Expand the OI heatmap"
          onClick={props.onOpenFull}
          style={MOBILE_HEAT_OPEN_STYLE}
        >
          FULL VIEW ↗
        </Button>
      </Box>
    </LiveTapeDisclosure>
  );
}

function metricLabel(metric: HeatMetric): string {
  return metric === "oi" ? "OI" : metric === "volume" ? "VOL" : "PREM";
}

function metricTitle(metric: HeatMetric): string {
  return metric === "oi"
    ? "Colour by OI change"
    : metric === "volume"
      ? "Colour by traded volume"
      : "Colour by premium change";
}

function DockSummary(props: { text: () => string }) {
  return <span>{props.text()}</span>;
}

/** Height-matched placeholder for a streaming workspace panel. */
function PanelSkeleton(props: { h: number }) {
  return (
    <Box
      class="w-full min-w-0"
      style={{
        height: `${props.h}px`,
        "background-color": palette.SURFACE_ALT,
        "border-radius": "2px",
      }}
    />
  );
}

export function ReportWorkspace(props: { secondaryTabs?: DeskDockTab[] }) {
  const store = useNiftyReport();
  const isMobile = useMediaQuery("(max-width: 600px)");
  const [heatOpen, setHeatOpen] = createSignal(false);

  const isDesk = () => store.ui.isDesk();
  const sideTab = () => store.ui.sideTab();
  const chartSize = () => store.ui.chartSize();
  const heatMetric = () => store.ui.heatMetric();
  const mobileHeatmap = () => isDesk() && isMobile() && sideTab() === "heatmap";
  // Wide desk: the side column is tall enough for two panels. The chain hugs its
  // rows and the heatmap fills the rest, so the column never ends in dead black.
  // The HEATMAP tab still hides the chain, keeping the two tabs distinct.
  const deskSplit = () => isDesk() && !isMobile();
  const showChain = () => !isDesk() || sideTab() === "chain";
  const showSideHeatmap = () => isDesk() && (sideTab() === "heatmap" || !isMobile());

  const chartRowHeight = createMemo(() => {
    const size = chartSize();
    return size === "fill"
      ? FILL_MAX_HEIGHT + CHART_ROW_CHROME
      : CHART_HEIGHTS[size] + CHART_ROW_CHROME;
  });

  const maxWalls = createMemo(() => {
    const walls = store.walls.data();
    return walls ? { calls: walls.calls, puts: walls.puts } : null;
  });

  const oiColumns = createMemo(() => {
    const scale = store.data.oiScale();
    return getNiftyOiColumns(store.data.atmStrike(), {
      maxCeOiChange: scale.maxCeOiChange,
      maxPeOiChange: scale.maxPeOiChange,
      spot: store.data.report()?.spot,
      walls: store.data.oiWalls(),
      showLegChange: !store.ui.isDesk(),
    });
  });

  const gexDegraded = createMemo(() => {
    const current = store.data.report();
    if (!current?.gex) return false;
    if (current.gex.degraded === true) return true;
    const strikes = current.strikes ?? [];
    if (strikes.length === 0) return false;
    const hasGamma = (value: number | null | undefined) =>
      typeof value === "number" && Number.isFinite(value);
    return !strikes.some((strike) => hasGamma(strike.ce.gamma) || hasGamma(strike.pe.gamma));
  });

  const gexForDisplay = createMemo(() =>
    gexDegraded() ? undefined : store.data.report()?.gex,
  );

  const getOiRowStyle = (row: NiftyStrike): JSX.CSSProperties | undefined => {
    const atm = store.data.atmStrike();
    return atm !== null && row.strike === atm
      ? { background: palette.alpha(palette.TERM_FLIP, 0.08) }
      : undefined;
  };

  const getOiRowTestId = (row: NiftyStrike): string | undefined => {
    const atm = store.data.atmStrike();
    return atm !== null && row.strike === atm ? "nifty-strike-atm" : `nifty-strike-row-${row.strike}`;
  };

  let oiWrapRef: HTMLDivElement | undefined;

  createEffect(() => {
    const current = store.data.report();
    const atm = store.data.atmStrike();
    store.data.visibleStrikes();
    if (!current || atm === null) return;
    try {
      const root = oiWrapRef;
      if (!root) return;
      const row = root.querySelector('[data-testid="nifty-strike-atm"]');
      if (!row || !(row instanceof HTMLElement)) return;
      let node: HTMLElement | null = row.parentElement;
      let scroller: HTMLElement | null = null;
      while (node && node !== root) {
        if (node.scrollHeight > node.clientHeight + 1) {
          scroller = node;
          break;
        }
        node = node.parentElement;
      }
      if (!scroller && root.scrollHeight > root.clientHeight + 1) scroller = root;
      if (!scroller) return;
      const scrollerRect = scroller.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      scroller.scrollTop +=
        rowRect.top - scrollerRect.top - (scrollerRect.height / 2 - rowRect.height / 2);
    } catch {
      return;
    }
  });

  // Only the active desk drawer builds its panel; the tab content getters are
  // read by DeskDock when (and only when) that drawer opens.
  const deskTabs = createMemo<DeskDockTab[]>(() => {
    if (!isDesk()) return [];
    return [
      {
        key: "flow",
        label: "DELTA",
        summary: <DockSummary text={() => store.data.report()?.positioning?.verdict ?? "—"} />,
        get content() {
          return (
            <Suspense fallback={<PanelSkeleton h={180} />}>
              <NiftyDeltaPositioning
                positioning={store.data.report()?.positioning}
                spot={store.data.report()?.spot}
              />
            </Suspense>
          );
        },
      },
      {
        key: "setup",
        label: "GEX",
        summary: <DockSummary text={() => gexForDisplay()?.regime ?? "—"} />,
        get content() {
          return (
            <Suspense fallback={<PanelSkeleton h={180} />}>
              <NiftyGexProfile gex={gexForDisplay()} spot={store.data.report()?.spot ?? 0} />
            </Suspense>
          );
        },
      },
      {
        key: "market",
        label: "IV",
        summary: <DockSummary text={() => `${store.data.visibleStrikes().length} strikes`} />,
        get content() {
          return (
            <Suspense fallback={<PanelSkeleton h={180} />}>
              <NiftyIvSkew
                strikes={store.data.report()?.strikes}
                spot={store.data.report()?.spot}
                ivSurface={store.data.report()?.iv_surface}
              />
            </Suspense>
          );
        },
      },
      ...(props.secondaryTabs ?? []),
    ];
  });

  return (
    <>
      {/* The shell owns the phone order for every content child; declaring it
          here as well would tie the chart with the shell's own rule. */}
      <Box
        data-testid="nifty-main-row"
        data-left-edge={String(REPORT_GUTTER.inline)}
        data-report-order="chart"
        data-chart-primary={isDesk() && chartSize() === "fill" ? "true" : undefined}
        data-chart-row-share={isDesk() ? DESK_CHART_ROW_SHARE : undefined}
        data-chart-chain={CHART_FILL_CHAIN}
        data-chart-floor={isDesk() ? String(DESK_CHART_FLOOR_PX) : undefined}
        className={`grid grid-cols-1 ${isDesk() ? "min-[1200px]:grid-cols-[minmax(0,1fr)_minmax(0,420px)]" : "min-[1200px]:grid-cols-[minmax(0,1fr)_minmax(0,624px)]"} grid-rows-[minmax(0,1fr)_minmax(0,120px)] ${mobileHeatmap() ? MOBILE_GRID_HEATMAP : `${MOBILE_GRID_DEFAULT} ${MOBILE_GRID_CHAIN}`} min-[1200px]:grid-rows-[minmax(0,1fr)] gap-0 items-stretch w-full max-w-full min-w-0 flex-1 min-h-[300px] overflow-hidden${isDesk() ? ` ${DESK_CHART_ROW_MAX_CLASS}` : ""}`}
        style={{
          "max-height":
            isDesk() && chartSize() !== "fill" ? `${chartRowHeight()}px` : undefined,
        }}
      >
        {/* Hold the wide first grid track while the report is absent; without
            this the side column becomes grid child #1 and fills the 1fr track,
            stranding the fixed 420/624px track empty. */}
        <Show when={!store.data.report()}>
          <Box data-testid="nifty-chart-placeholder" className="min-w-0 min-h-0" />
        </Show>

        <Show when={store.data.report()}>
          {(current) => (
            <Suspense fallback={<PanelSkeleton h={chartRowHeight()} />}>
              <NiftyChartPanel
                report={current()}
                bursts={store.data.effectiveBursts()}
                tape={store.data.tape()}
                spotPoints={store.data.oiPoints()}
                flipAt={store.data.flipAt()}
                maxWalls={maxWalls()}
                mode={store.selection.mode()}
                view={store.ui.view()}
                symbol={store.selection.symbol()}
                asOf={store.selection.mode() === "eod" ? store.replay.frameT() ?? undefined : undefined}
                timeframe={store.ui.chartTf()}
                onTimeframeChange={(tf) => store.ui.handleChartTf(tf)}
                onSizeChange={(size) => store.ui.handleChartSize(size)}
                onExpand={() => store.ui.openChartFull()}
                fillContainer={isDesk() && chartSize() === "fill"}
              />
            </Suspense>
          )}
        </Show>

        <Box
          data-testid="nifty-side-col"
          data-side-secondary={deskSplit() ? "heatmap" : undefined}
          className="flex flex-col min-w-0 min-h-0"
        >
          <Show when={isDesk()}>
            <Box
              data-testid="nifty-side-tabs"
              className="flex items-center gap-2 h-8 min-h-8 px-1"
              style={{
                "background-color": palette.TERM_HEADER,
                "border-bottom": `1px solid ${palette.alpha(palette.BORDER, 0.6)}`,
              }}
            >
              <Button
                data-testid="nifty-side-tab-chain"
                size="sm"
                variant={sideTab() === "chain" ? "filled" : "subtle"}
                aria-pressed={sideTab() === "chain"}
                onClick={() => store.ui.setSideTab("chain")}
                style={SIDE_TAB_STYLE}
              >
                CHAIN
              </Button>
              <Button
                data-testid="nifty-side-tab-heatmap"
                size="sm"
                variant={sideTab() === "heatmap" ? "filled" : "subtle"}
                aria-pressed={sideTab() === "heatmap"}
                onClick={() => store.ui.setSideTab("heatmap")}
                style={SIDE_TAB_STYLE}
              >
                HEATMAP
              </Button>
            </Box>
          </Show>

          <Show when={showChain()}>
            <Box data-side-slot="chain" className={deskSplit() ? CHAIN_SLOT_HUG : CHAIN_SLOT_FILL}>
              <NiftyOiChain
                strikes={store.data.visibleStrikes()}
                columns={oiColumns()}
                getRowStyle={getOiRowStyle}
                getRowTestId={getOiRowTestId}
                panelTestId="nifty-oi-panel"
                tableTestId="nifty-oi-table"
                wrapTestId="nifty-oi-wrap"
                wrapRef={(el) => {
                  oiWrapRef = el;
                }}
                onExpand={() => store.ui.openOiExpand()}
              />
            </Box>
          </Show>

          <Show when={showSideHeatmap()}>
            <Box
              data-testid="nifty-chart-side-heatmap"
              data-side-slot="heatmap"
              className="relative flex-auto min-h-0 min-w-0 flex flex-col"
            >
              <Show
                when={!isMobile()}
                fallback={
                  <MobileHeatmapSummary
                    open={heatOpen()}
                    onToggle={() => setHeatOpen((v) => !v)}
                    metric={heatMetric()}
                    onMetric={(m) => store.ui.setHeatMetric(m)}
                    onOpenFull={() => store.ui.setHeatExpand(true)}
                  />
                }
              >
                <Box
                  data-testid="nifty-heatmap-metric-toggle"
                  className="flex gap-2 items-center h-[30px] min-h-[30px] shrink-0 px-1 mb-1"
                >
                  <For each={HEAT_METRICS}>
                    {(metric) => (
                      <Button
                        data-testid={`nifty-heatmap-metric-${metric}`}
                        size="sm"
                        variant={heatMetric() === metric ? "filled" : "subtle"}
                        aria-pressed={heatMetric() === metric}
                        title={metricTitle(metric)}
                        onClick={() => store.ui.setHeatMetric(metric)}
                        style={HEAT_METRIC_STYLE}
                      >
                        {metricLabel(metric)}
                      </Button>
                    )}
                  </For>
                  <Text className="ml-auto mr-6 text-ui-body font-semibold text-fin-text-muted">
                    OI change
                  </Text>
                </Box>
                <Box data-testid="nifty-heatmap-wrap" className="flex-1 min-h-0 min-w-0 flex overflow-hidden">
                  <Suspense fallback={<PanelSkeleton h={220} />}>
                    <NiftyOiHeatmap
                      rows={store.data.tapeRows()}
                      bucketMin={1}
                      widthPts={store.data.metrics()?.heatmapWidthPts ?? 250}
                      viewBoxHeight={240}
                      metric={heatMetric()}
                      startTime={store.data.intradayStart()}
                      flipAt={store.data.flipAt()}
                    />
                  </Suspense>
                </Box>
                <Button
                  data-testid="nifty-heatmap-expand"
                  size="sm"
                  variant="subtle"
                  aria-label="Expand the OI heatmap"
                  title="Expand the OI heatmap"
                  onClick={() => store.ui.setHeatExpand(true)}
                  className={HEATMAP_EXPAND_CLASS}
                  style={{ "background-color": palette.TERM_HEADER }}
                >
                  ⤢
                </Button>
              </Show>
            </Box>
          </Show>
        </Box>
      </Box>

      {/* Desktop-only permanent desk rail. It occupies the band the dock drawer
          used to steal, so walls (CW/PW/MP/PIN) and breadth stay visible while
          the chart keeps its full canvas. Mobile keeps its own stacked flow. */}
      <Show when={isDesk() && !isMobile()}>
        <Box
          data-testid="desk-insight-rail"
          data-left-edge={String(REPORT_GUTTER.inline)}
          className="flex flex-col gap-2 shrink-0 w-full min-w-0 overflow-hidden"
          style={{
            height: `${store.selection.mode() !== "eod"
              ? DESK_RAIL_HEIGHT_PX
              : store.walls.data()
                ? DESK_RAIL_REPLAY_WALLS_HEIGHT_PX
                : DESK_RAIL_REPLAY_HEIGHT_PX}px`,
          }}
        >
          <Box className="flex-1 min-h-0 min-w-0">
            <NiftyWallsCard
              testId="nifty-walls-card-rail"
              compact
              walls={store.walls.data()}
              onExpand={() => store.walls.openDrawer()}
              onOpenDesk={() => store.ui.setDeskOpen(true)}
              emptyText="Waiting for walls data."
              unavailableInReplay={store.selection.mode() === "eod"}
            />
          </Box>
          {/* Replay has no breadth snapshot. It is named once by the mode banner
              instead of holding a 24px empty band in the permanent rail. */}
          <Show when={store.selection.mode() === "live"}>
            <BreadthStrip data={store.data.breadth()} />
          </Show>
        </Box>
      </Show>

      <Show when={isDesk()}>
        <Box data-testid="desk-dock-overflow-wrap" className={DOCK_OVERFLOW_WRAP_CLASS}>
          <DeskDock
            tabs={deskTabs()}
            active={store.ui.deskDockTab()}
            onActiveChange={(key) => store.ui.setDeskDockTab(key)}
          />
          <Box
            data-testid="desk-dock-overflow-cue"
            aria-hidden="true"
            className={DOCK_OVERFLOW_CUE_CLASS}
            style={DOCK_OVERFLOW_CUE_STYLE}
          >
            ›
          </Box>
        </Box>
      </Show>

      <Show when={!isDesk()}>
        <Show when={store.data.report()}>
          {(current) => (
            <>
              <Box
                data-testid="nifty-analytics-row"
                className="grid grid-cols-1 min-[1200px]:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] items-stretch gap-2 w-full max-w-full min-w-0 shrink-0"
              >
                <Box className={ANALYTICS_FILL_CELL_CLASS}>
                  <Suspense fallback={<PanelSkeleton h={160} />}>
                    <NiftyDeltaPositioning positioning={current().positioning} spot={current().spot} />
                  </Suspense>
                </Box>
                <Box className={`${ANALYTICS_CELL_CLASS} relative`}>
                  <Suspense fallback={<PanelSkeleton h={160} />}>
                    <NiftyGexProfile gex={gexForDisplay()} spot={current().spot} />
                  </Suspense>
                  <ActionIcon
                    data-testid="nifty-gex-expand"
                    aria-label="Expand GEX profile"
                    title="Expand"
                    size={20}
                    onClick={() => store.ui.setGexOpen(true)}
                    className={EXPAND_ICON_CLASS}
                    style={EXPAND_ICON_STYLE}
                  >
                    <Text span size="xs" fw={700} style={EXPAND_GLYPH_STYLE}>
                      ⤢
                    </Text>
                  </ActionIcon>
                </Box>
              </Box>

              <Box
                data-testid="nifty-iv-skew-row"
                className="grid grid-cols-1 min-[1200px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-2 items-stretch w-full max-w-full min-w-0 shrink-0"
              >
                <Box className="min-w-0 min-h-0 relative">
                  <Suspense fallback={<PanelSkeleton h={160} />}>
                    <NiftyIvSkew
                      strikes={current().strikes}
                      spot={current().spot}
                      ivSurface={current().iv_surface}
                    />
                  </Suspense>
                  <ActionIcon
                    data-testid="nifty-ivskew-expand"
                    aria-label="Expand IV skew"
                    title="Expand"
                    size={20}
                    onClick={() => store.ui.setIvOpen(true)}
                    className={EXPAND_ICON_CLASS}
                    style={EXPAND_ICON_STYLE}
                  >
                    <Text span size="xs" fw={700} style={EXPAND_GLYPH_STYLE}>
                      ⤢
                    </Text>
                  </ActionIcon>
                </Box>
              </Box>
            </>
          )}
        </Show>
      </Show>
    </>
  );
}