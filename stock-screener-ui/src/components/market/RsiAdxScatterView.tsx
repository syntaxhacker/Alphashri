import { Show, createEffect, createMemo, onCleanup, onMount } from "solid-js";
import { Box, Text, ToolbarRow, typeSize } from "@/ui";
import {
  VIZ_BG,
  VIZ_GRID,
  VIZ_MUTED,
  VIZ_PANEL,
  VIZ_SCALE_PNL,
  VIZ_TEXT,
} from "@/ui/palette";
import { contrastRatio, parseColor } from "@/utils/contrast";
import { loadEcharts } from "@/utils/loadEcharts";
import type { MarketRow } from "@/types/marketScreener";
import type { VisRenderProps } from "./MarketMapView";
import { VisEmpty, VisFrame, VisToolbar } from "./vis/VisFrame";
import { pnlRampCss } from "./vis/visScale";

/**
 * Market → Vis "RSI × ADX": a D3-gallery *Scatterplot* rendered with ECharts.
 * RSI is the horizontal axis, ADX the vertical; area encodes √market cap and
 * hue encodes the day change on the VIZ_SCALE_PNL diverging ramp. Reference
 * lines at RSI 50/70 and ADX 20/25 split the field into weak/trending/overbought
 * quadrants. The 300-largest names are plotted so a full universe stays legible.
 */

export const MAX_RSI_ADX_POINTS = 300;
export const RSI_ADX_FIXED_SIZE = 10;
const MIN_POINT_SIZE = 7;
const MAX_POINT_SIZE = 26;

/** Threshold chips sit over the scatter, so their ink is checked on the chip fill. */
export const RSI_ADX_MARK_LABEL_COLOR =
  contrastRatio(VIZ_MUTED, VIZ_PANEL) >= 4.5 ? VIZ_MUTED : VIZ_TEXT;

const finite = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value));

const capOf = (row: MarketRow): number => {
  const cap = row?.marketCapCr;
  return typeof cap === "number" && Number.isFinite(cap) && cap > 0 ? cap : 0;
};

const hasIndicators = (row: MarketRow): boolean =>
  typeof row?.rsi === "number" &&
  Number.isFinite(row.rsi) &&
  typeof row?.adx === "number" &&
  Number.isFinite(row.adx);

function lerpHex(from: string, to: string, t: number): string {
  const a = parseColor(from);
  const b = parseColor(to);
  const mix = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `#${[mix(a.r, b.r), mix(a.g, b.g), mix(a.b, b.b)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Signed change → the P&L ramp, zero pinned to its neutral midpoint. */
export function rsiAdxColor(change: number, extent: number): string {
  const span = Number.isFinite(extent) && extent > 0 ? extent : 1;
  const t = clamp((finite(change) / span + 1) / 2, 0, 1);
  const scaled = t * (VIZ_SCALE_PNL.length - 1);
  const low = Math.floor(scaled);
  const high = Math.min(low + 1, VIZ_SCALE_PNL.length - 1);
  return lerpHex(VIZ_SCALE_PNL[low]!, VIZ_SCALE_PNL[high]!, scaled - low);
}

/** Area ∝ √market cap; a null/unusable cap gets a fixed marker instead of NaN. */
export function rsiAdxSize(cap: number | null | undefined, maxCap: number): number {
  if (typeof cap !== "number" || !Number.isFinite(cap) || cap <= 0) return RSI_ADX_FIXED_SIZE;
  const peak = Number.isFinite(maxCap) && maxCap > 0 ? maxCap : cap;
  return MIN_POINT_SIZE + (MAX_POINT_SIZE - MIN_POINT_SIZE) * Math.sqrt(clamp(cap / peak, 0, 1));
}

/** Eligible rows (RSI + ADX present), largest caps first, capped for legibility. */
export function selectRsiAdxRows(rows: MarketRow[], limit = MAX_RSI_ADX_POINTS) {
  const eligible = (rows ?? []).filter(hasIndicators);
  const plotted = [...eligible]
    .sort((a, b) => capOf(b) - capOf(a) || a.symbol.localeCompare(b.symbol))
    .slice(0, limit);
  return { eligible, plotted };
}

interface RsiAdxPoint {
  name: string;
  symbol: string;
  company: string;
  value: [number, number];
  rsi: number;
  adx: number;
  change: number;
  cap: number | null;
  symbolSize: number;
  itemStyle: { color: string };
}

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (ch) => {
    const escaped: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return escaped[ch] ?? ch;
  });

const changeLabel = (value: number): string =>
  `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;

/** Pure option builder so the axis data, threshold lines and click identity are testable. */
export function buildRsiAdxOption(plotted: MarketRow[]) {
  const maxCap = Math.max(0, ...plotted.map(capOf));
  const extent = Math.max(0.5, ...plotted.map((row) => Math.abs(finite(row.change))));
  const data: RsiAdxPoint[] = plotted.map((row) => {
    const change = finite(row.change);
    const cap = capOf(row) > 0 ? row.marketCapCr : null;
    return {
      name: row.symbol,
      symbol: row.symbol,
      company: row.name || row.symbol,
      value: [clamp(row.rsi!, 0, 100), clamp(row.adx!, 0, 100)],
      rsi: clamp(row.rsi!, 0, 100),
      adx: clamp(row.adx!, 0, 100),
      change,
      cap,
      symbolSize: rsiAdxSize(cap, maxCap),
      itemStyle: { color: rsiAdxColor(change, extent) },
    };
  });
  const axisLabel = { color: VIZ_MUTED, fontSize: typeSize("micro") };
  const splitLine = { show: true, lineStyle: { color: VIZ_GRID, type: "dashed" as const } };
  const markLabel = {
    show: true,
    color: RSI_ADX_MARK_LABEL_COLOR,
    fontSize: typeSize("micro"),
    backgroundColor: VIZ_PANEL,
    padding: [2, 4],
    borderRadius: 4,
  };
  return {
    backgroundColor: VIZ_BG,
    animation: false,
    // containLabel reserves room for ticks; the offsets leave the axis names
    // (nameGap below) inside the canvas and keep the plot off the card edge.
    grid: { left: 16, right: 36, top: 24, bottom: 24, containLabel: true },
    tooltip: {
      trigger: "item",
      backgroundColor: VIZ_PANEL,
      borderColor: VIZ_GRID,
      textStyle: { color: VIZ_TEXT, fontSize: typeSize("micro") },
      formatter: (params: { data?: RsiAdxPoint }) => {
        const point = params?.data;
        if (!point) return "";
        return (
          `<b>${escapeHtml(point.symbol)}</b> · ${escapeHtml(point.company)}` +
          `<br/>RSI ${point.rsi.toFixed(1)} · ADX ${point.adx.toFixed(1)}` +
          `<br/>Change ${changeLabel(point.change)} · cap ${point.cap === null ? "n/a" : `${point.cap.toLocaleString()} Cr`}`
        );
      },
    },
    xAxis: {
      type: "value",
      min: 0,
      max: 100,
      name: "RSI",
      nameLocation: "middle",
      nameGap: 22,
      nameTextStyle: axisLabel,
      axisLabel,
      axisLine: { lineStyle: { color: VIZ_GRID } },
      splitLine,
    },
    yAxis: {
      type: "value",
      min: 0,
      max: 100,
      name: "ADX",
      nameLocation: "middle",
      nameGap: 18,
      nameTextStyle: axisLabel,
      axisLabel,
      axisLine: { lineStyle: { color: VIZ_GRID } },
      splitLine,
    },
    series: [
      {
        type: "scatter",
        data,
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: VIZ_GRID, type: "dashed" as const, width: 1 },
          label: markLabel,
          data: [
            {
              xAxis: 50,
              label: {
                formatter: "RSI 50 · weak",
                position: "insideEndTop" as const,
                // markLine rotates a vertical line's label unless forced flat.
                rotate: 0,
                align: "right" as const,
              },
            },
            {
              xAxis: 70,
              label: {
                formatter: "RSI 70 · overbought",
                position: "insideEndTop" as const,
                rotate: 0,
                align: "left" as const,
              },
            },
            { yAxis: 20, label: { formatter: "ADX 20", position: "insideEndTop" as const } },
            {
              yAxis: 25,
              label: { formatter: "ADX 25 · trend", position: "insideEndTop" as const },
            },
          ],
        },
      },
    ],
  };
}

type ClickParams = { data?: RsiAdxPoint };

/** Owns the ECharts instance; the option builder stays pure for tests. */
function RsiAdxCanvas(props: {
  option: ReturnType<typeof buildRsiAdxOption>;
  onSymbolClick?: (symbol: string) => void;
}) {
  let chartEl: HTMLDivElement | undefined;
  let chart: any = null;
  let disposed = false;
  let resizeFrame = 0;
  let observer: ResizeObserver | null = null;

  const handleClick = (params: ClickParams) => {
    const symbol = params?.data?.symbol;
    if (typeof symbol === "string") props.onSymbolClick?.(symbol);
  };

  onMount(() => {
    void loadEcharts().then((lib) => {
      if (disposed || !lib || !chartEl) return;
      chart = lib.init(chartEl, undefined, { renderer: "canvas" });
      chart.setOption(props.option);
      if (props.onSymbolClick) chart.on("click", handleClick);
      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver((entries) => {
          const rect = entries[entries.length - 1]?.contentRect;
          if (!rect || rect.width <= 0 || rect.height <= 0 || resizeFrame) return;
          resizeFrame = requestAnimationFrame(() => {
            resizeFrame = 0;
            chart?.resize();
          });
        });
        observer.observe(chartEl);
      }
    });
  });

  createEffect(() => {
    const next = props.option;
    chart?.setOption(next, { notMerge: true });
  });

  onCleanup(() => {
    disposed = true;
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    observer?.disconnect();
    observer = null;
    chart?.dispose();
    chart = null;
  });

  return (
    <Box className="flex-1 min-w-0 min-h-0 flex p-2" style={{ "min-height": "320px" }}>
      <div
        ref={(el) => (chartEl = el)}
        data-testid="rsi-adx-canvas"
        style={{ height: "100%", width: "100%" }}
      />
    </Box>
  );
}

export function RsiAdxScatterView(props: VisRenderProps) {
  const selection = createMemo(() => selectRsiAdxRows(props.rows ?? []));
  const option = createMemo(() => buildRsiAdxOption(selection().plotted));
  const total = () => (props.rows ?? []).length;
  const countTitle = () =>
    `${selection().plotted.length} of ${total().toLocaleString()} eligible rows plotted (largest caps first)`;

  return (
    <VisFrame testId="rsi-adx-view">
      <VisToolbar testId="rsi-adx-toolbar">
        <Text span size="xs" fw={600} c={VIZ_TEXT}>
          RSI × ADX
        </Text>
        <Box className="flex-1 min-w-0" />
        <Text
          span
          size="xs"
          c={VIZ_MUTED}
          class="whitespace-nowrap"
          title={countTitle()}
          data-testid="rsi-adx-count"
        >
          {selection().plotted.length} / {total()}
        </Text>
      </VisToolbar>

      <Show
        when={selection().plotted.length > 0}
        fallback={<VisEmpty message="No RSI/ADX data in the current filter." testId="rsi-adx-empty" />}
      >
        <RsiAdxCanvas option={option()} onSymbolClick={props.onSymbolClick} />
      </Show>

      <ToolbarRow
        gap={8}
        className="min-h-8 flex-shrink-0 border-t px-2 py-1"
        style={{ "border-color": VIZ_GRID }}
        data-testid="rsi-adx-legend"
      >
        <Box
          className="h-2 w-24 flex-shrink-0 rounded-fin"
          style={{ background: pnlRampCss() }}
          data-testid="rsi-adx-scale"
        />
        <Text span size="xs" c={VIZ_MUTED} data-testid="rsi-adx-scale-note">
          loss ← change → gain
        </Text>
        <Text span size="xs" c={VIZ_MUTED} data-testid="rsi-adx-size-note">
          area ∝ √market cap
        </Text>
      </ToolbarRow>
    </VisFrame>
  );
}
