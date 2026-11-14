import { For, Show, Suspense, createEffect, createMemo, lazy } from "solid-js";
import type { JSX } from "solid-js";

import { ActionIcon, Box, Button, Text } from "@/ui";
import * as palette from "@/ui/palette";
import { hexToRgba } from "@/utils/color";
import type { NiftyStrike } from "@/types/niftyReport";

import { DeskDock } from "./DeskDock";
import type { DeskDockTab } from "./DeskDock";
import { useNiftyReport } from "./ReportContext";
import type { HeatMetric } from "./niftyReportStore";
import { NiftyOiChain, getNiftyOiColumns } from "./reportCells";

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

// Mirrors NiftyChartPanel's layout presets. Duplicated so the chart panel can
// stay behind its lazy boundary without pulling its module into this chunk.
const CHART_HEIGHTS = { s: 180, m: 320, l: 520, xl: 760 } as const;
const CHART_ROW_CHROME = 48;
const FILL_MAX_HEIGHT = 300;

const ANALYTICS_CELL_CLASS = "min-w-0 min-h-0 flex flex-col [&>*]:flex-1 [&>*]:min-h-0";

const ANALYTICS_FILL_CELL_CLASS = `${ANALYTICS_CELL_CLASS} [contain:none] min-[1200px]:[contain:size]`;

const SIDE_TAB_STYLE: JSX.CSSProperties = {
  height: "18px",
  "min-width": "0",
  "padding-left": "4.8px",
  "padding-right": "4.8px",
  "padding-top": "0",
  "padding-bottom": "0",
  "font-size": "9px",
  "font-weight": 800,
  "letter-spacing": "0.4px",
};

const HEAT_METRIC_STYLE: JSX.CSSProperties = {
  "min-width": "26px",
  "padding-left": "3px",
  "padding-right": "3px",
  "padding-top": "0",
  "padding-bottom": "0",
  "font-size": "8.5px",
  "line-height": 1.4,
};

const EXPAND_ICON_STYLE: JSX.CSSProperties = {
  color: palette.TEXT_MUTED,
  "background-color": palette.TERM_HEADER,
};

const EXPAND_ICON_CLASS = "absolute top-0.5 right-0.5 p-[2px] rounded-none hover:text-fin-text!";

const EXPAND_GLYPH_STYLE: JSX.CSSProperties = { "font-size": "12px", "line-height": 1 };

const HEAT_METRICS: HeatMetric[] = ["oi", "volume", "premium"];

const HEATMAP_EXPAND_CLASS =
  "absolute top-0 right-0 w-[22px] h-[18px] min-w-[22px] px-0 py-0 leading-[18px] text-[11px] z-[3]";

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

export function ReportWorkspace() {
  const store = useNiftyReport();

  const isDesk = () => store.ui.isDesk();
  const sideTab = () => store.ui.sideTab();
  const chartSize = () => store.ui.chartSize();
  const heatMetric = () => store.ui.heatMetric();

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
      ? { background: hexToRgba(palette.TERM_FLIP, 0.08) }
      : undefined;
  };

  const getOiRowTestId = (row: NiftyStrike): string | undefined => {
    const atm = store.data.atmStrike();
    return atm !== null && row.strike === atm ? "nifty-strike-atm" : "nifty-strike-row";
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
              />
            </Suspense>
          );
        },
      },
    ];
  });

  return (
    <>
      <Box
        data-testid="nifty-main-row"
        className={`grid grid-cols-1 ${isDesk() ? "min-[1200px]:grid-cols-[minmax(0,1fr)_minmax(0,420px)]" : "min-[1200px]:grid-cols-[minmax(0,1fr)_minmax(0,624px)]"} grid-rows-[minmax(0,1fr)] gap-0 items-stretch w-full max-w-full min-w-0 flex-auto min-h-[300px] overflow-hidden`}
        style={{
          "max-height":
            isDesk() && chartSize() !== "fill" ? `${chartRowHeight()}px` : undefined,
        }}
      >
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

        <Box data-testid="nifty-side-col" className="flex flex-col min-w-0 min-h-0">
          <Show when={isDesk()}>
            <Box
              data-testid="nifty-side-tabs"
              className="flex items-center gap-0.5 h-5 min-h-5 px-0.5 border-b border-[var(--desk-border)]"
              style={{ "background-color": palette.TERM_HEADER }}
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

          <Show when={!isDesk() || sideTab() === "chain"}>
            <Box className="flex-auto min-h-0 min-w-0 flex [&>*]:flex-1 [&>*]:min-w-0 [&>*]:min-h-0">
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

          <Show when={isDesk() && sideTab() === "heatmap"}>
            <Box
              data-testid="nifty-chart-side-heatmap"
              className="relative flex-auto min-h-0 min-w-0 flex flex-col"
            >
              <Box
                data-testid="nifty-heatmap-metric-toggle"
                className="flex gap-0.5 items-center h-[18px] shrink-0 px-0.5 mb-[1px]"
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
                <Text className="ml-auto mr-5 text-[7.5px] text-fin-text-muted">OI change</Text>
              </Box>
              <Box data-testid="nifty-heatmap-wrap" className="flex-1 min-h-0 min-w-0 flex">
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
            </Box>
          </Show>
        </Box>
      </Box>

      <Show when={isDesk()}>
        <DeskDock
          tabs={deskTabs()}
          active={store.ui.deskDockTab()}
          onActiveChange={(key) => store.ui.setDeskDockTab(key)}
        />
      </Show>

      <Show when={!isDesk()}>
        <Show when={store.data.report()}>
          {(current) => (
            <>
              <Box
                data-testid="nifty-analytics-row"
                className="grid grid-cols-1 min-[1200px]:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] items-stretch gap-0 w-full max-w-full min-w-0 shrink-0"
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
                className="grid grid-cols-1 min-[1200px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-0 items-stretch w-full max-w-full min-w-0 shrink-0"
              >
                <Box className="min-w-0 min-h-0 relative">
                  <Suspense fallback={<PanelSkeleton h={160} />}>
                    <NiftyIvSkew strikes={current().strikes} spot={current().spot} />
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