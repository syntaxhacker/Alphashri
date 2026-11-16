import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import { Box, Text, useColorScheme } from "@/ui";
import * as palette from "@/ui/palette";
import { loadEcharts } from "@/utils/loadEcharts";
import { formatNumber } from "@/utils/ui-helpers";
import {
  expectedMove,
  payoffCurve,
  probabilityOfProfit,
  type OptionLeg,
} from "@/utils/optionsMath";
import type { DockLeg } from "@/state/optionsDock";

/**
 * The shared payoff canvas: ECharts surface, guides and the four-cell footer.
 *
 * Owned here rather than in either host so the options dock and the F&O row
 * detail read the same curve, colours and numbers. `buildPayoff` stays pure and
 * exported so hosts/tests can assert the model without mounting a chart.
 *
 * Recompute gate: legs change, IV or DTE changes, or spot moves ≥ 0.05 %. A
 * 10 s frame patch that nudges spot by ₹2 on 24 000 must not re-run 241 points
 * × N legs — but an ATM-IV tick or an expiry switch must refresh POP/E[P&L]/±1σ.
 */
const SPOT_MOVE_EPSILON = 0.0005;
/** Horizontal pixel budget for the y axis labels. */
const GRID_LEFT = 46;
/** Only used when a host has no expiry to quote; that host hides the ±1σ cell. */
const FALLBACK_DTE_YEARS = 7 / 365;

export interface PayoffSnapshot {
  points: { spot: number; pnl: number }[];
  breakevens: number[];
  maxProfit: number | null;
  maxLoss: number | null;
  netPremium: number;
  pop: number;
  expectedPnl: number;
  sigma: number;
}

function toPure(legs: DockLeg[]): OptionLeg[] {
  return legs.map((leg) => ({
    side: leg.side,
    type: leg.type,
    strike: leg.strike,
    premium: leg.premium,
    lots: leg.lots,
    lotSize: leg.lotSize,
  }));
}

function legSignature(legs: DockLeg[]): string {
  return legs.map((leg) => `${leg.key}|${leg.side}|${leg.lots}|${leg.lotSize}|${leg.premium}`).join(";");
}

/** Pure: the panel, the row detail and their tests all call this. */
export function buildPayoff(
  legs: DockLeg[],
  spot: number,
  iv: number,
  dteYears: number,
): PayoffSnapshot | null {
  if (legs.length === 0 || !(spot > 0)) return null;
  const pure = toPure(legs);
  const curve = payoffCurve(pure, spot);
  const probability = probabilityOfProfit(pure, spot, iv, dteYears);
  return {
    points: curve.points,
    breakevens: curve.breakevens,
    maxProfit: curve.maxProfit,
    maxLoss: curve.maxLoss,
    netPremium: curve.netPremium,
    pop: probability.pop,
    expectedPnl: probability.expectedPnl,
    sigma: probability.sigma,
  };
}

export function formatPop(value: number): string {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "—";
}

function signedCompact(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "∞";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${formatNumber(Math.abs(value))}`;
}

/**
 * ECharts paints labels on a canvas, which cannot resolve `var(...)`. Read the
 * theme token's computed value so light mode keeps its higher-contrast ink
 * instead of the dark anchor baked into `palette.CHART_MUTED`.
 */
function mutedChartInk(): string {
  if (typeof document === "undefined") return palette.CHART_MUTED;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--color-fin-text-muted")
    .trim();
  return value || palette.CHART_MUTED;
}

function emptySnapshot(): PayoffSnapshot {
  return {
    points: [],
    breakevens: [],
    maxProfit: null,
    maxLoss: null,
    netPremium: 0,
    pop: Number.NaN,
    expectedPnl: Number.NaN,
    sigma: Number.NaN,
  };
}

function buildOption(
  snapshot: PayoffSnapshot,
  spot: number,
  iv: number,
  density: { spot: number; prob: number }[],
  mutedInk: string,
) {
  const spots = snapshot.points.map((point) => point.spot);
  const maxProb = density.reduce((max, cell) => Math.max(max, cell.prob), 0);
  const densitySeries = density.map((cell) => ({
    spot: cell.spot,
    prob: maxProb > 0 ? (cell.prob / maxProb) * Math.max(0.15, Math.abs(snapshot.maxProfit ?? 1)) : 0,
  }));
  const spotLabel = Math.round(spot).toString();
  // Two series over one grid: the line stops at zero and the other colour picks
  // it up, so profit and loss are separable without a second y axis. A null is
  // a gap, not a zero — `connectNulls: false` keeps the crossing readable.
  const profit = snapshot.points.map((point) => (point.pnl >= 0 ? Math.round(point.pnl) : null));
  const loss = snapshot.points.map((point) => (point.pnl < 0 ? Math.round(point.pnl) : null));

  const markLine = {
    silent: true,
    symbol: "none",
    label: { show: false },
    data: [
      { yAxis: 0, lineStyle: { color: palette.TEXT_MUTED, width: 1, type: "dashed" } },
      ...snapshot.breakevens.map((be) => ({
        xAxis: Math.round(be).toString(),
        lineStyle: { color: palette.WARNING, width: 1, type: "dotted" },
      })),
      { xAxis: spotLabel, lineStyle: { color: palette.INFO, width: 1, type: "solid" } },
    ],
  };

  return {
    animation: false,
    backgroundColor: "transparent",
    // 20px of bottom room: the tick labels sit under the plot and the footer
    // band starts on the next pixel, so they must not be painted on top of it.
    grid: { left: GRID_LEFT, right: 8, top: 13, bottom: 20 },
    tooltip: {
      trigger: "axis",
      backgroundColor: palette.TOOLTIP_BG,
      borderColor: palette.TOOLTIP_BORDER,
      textStyle: { color: palette.OPTION_PAYOFF_TOOLTIP_TEXT, fontSize: 10 },
    },
    xAxis: {
      type: "category",
      data: spots.map((value) => Math.round(value).toString()),
      axisLine: { lineStyle: { color: palette.AXIS_LINE } },
      axisTick: { show: false },
      axisLabel: {
        color: mutedInk,
        fontSize: 9,
        margin: 4,
        interval: Math.max(0, Math.floor(spots.length / 6)),
      },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: mutedInk, fontSize: 9 },
      splitLine: { lineStyle: { color: palette.AXIS_SPLIT } },
    },
    series: [
      {
        name: "P&L at expiry",
        type: "line",
        data: profit,
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 1.5, color: palette.POSITIVE },
        itemStyle: { color: palette.POSITIVE },
        areaStyle: { color: palette.alpha(palette.POSITIVE, 0.22), origin: 0 },
        z: 3,
      },
      {
        name: "P&L at expiry",
        type: "line",
        data: loss,
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 1.5, color: palette.NEGATIVE },
        itemStyle: { color: palette.NEGATIVE },
        areaStyle: { color: palette.alpha(palette.NEGATIVE, 0.22), origin: 0 },
        z: 3,
      },
      {
        // Guides ride their own empty series: attached to either half they would
        // vanish on a basket that is entirely profit or entirely loss.
        name: "guides",
        type: "line",
        data: [],
        showSymbol: false,
        silent: true,
        markLine,
        z: 3,
      },
      {
        name: "P(S)",
        type: "line",
        data: densitySeries.map((cell) => Math.round(cell.prob)),
        showSymbol: false,
        lineStyle: { width: 0, opacity: 0 },
        areaStyle: { color: palette.alpha(palette.INFO, 0.1) },
        silent: true,
        z: 1,
      },
    ],
    // `flat vol` is a disclosure, not a decoration: POP below is computed at the
    // supplied IV, so the canvas says which σ the number came from. Top-right,
    // in the empty corner — the bottom band belongs to the x-axis tick labels.
    graphic: [
      {
        type: "text",
        right: 8,
        top: 0,
        style: {
          text: `flat vol ${Number.isFinite(iv) && iv > 0 ? (iv * 100).toFixed(1) : "—"}%`,
          fill: mutedInk,
          fontSize: 9,
          fontFamily: palette.MONO,
        },
      },
    ],
  };
}

export function PayoffChartCore(props: {
  legs: DockLeg[];
  spot: number;
  /** ATM IV as a decimal fraction (0.138 = 13.8 %), not vol points. */
  iv?: number;
  /**
   * Years to expiry. Omit when the host has no expiry: the model uses a
   * 7/365 fallback and the ±1σ footer cell is hidden rather than fabricated.
   */
  dteYears?: number;
  /** Fixed canvas height (the row detail uses 180); otherwise fill the flex parent. */
  height?: number;
  footer?: boolean;
  "data-testid"?: string;
  /** Lets a host surface the computed POP in its own header without a second recompute. */
  onSnapshot?: (snapshot: PayoffSnapshot | null) => void;
}) {
  let chartEl: HTMLDivElement | undefined;
  let chart: any = null;
  let disposed = false;

  const { colorScheme } = useColorScheme();
  /** Reading the scheme here repaints the canvas labels when the theme flips. */
  const chartMuted = () => {
    void colorScheme();
    return mutedChartInk();
  };

  let lastSignature = "";
  let lastSpot = 0;
  const [snapshot, setSnapshot] = createSignal<PayoffSnapshot | null>(null);
  const [density, setDensity] = createSignal<{ spot: number; prob: number }[]>([]);

  const ivDecimal = () => {
    const iv = props.iv;
    return iv != null && Number.isFinite(iv) && iv > 0 ? iv : Number.NaN;
  };
  const dteYears = () => props.dteYears ?? FALLBACK_DTE_YEARS;

  const recompute = (force: boolean) => {
    const legs = props.legs;
    const spot = props.spot;
    const iv = ivDecimal();
    const dte = dteYears();
    // IV and DTE are not subject to the spot epsilon: an ATM-IV tick or an
    // expiry switch must refresh POP/E[P&L]/±1σ even when spot has not moved.
    const signature = `${legSignature(legs)}|${iv}|${dte}`;
    const moved = Math.abs(spot - lastSpot) / Math.max(spot, 1);
    if (!force && signature === lastSignature && moved < SPOT_MOVE_EPSILON) return;
    lastSignature = signature;
    lastSpot = spot;

    if (legs.length === 0 || !(spot > 0)) {
      setSnapshot(null);
      setDensity([]);
      props.onSnapshot?.(null);
      return;
    }
    const next = buildPayoff(legs, spot, iv, dte);
    setSnapshot(next);
    setDensity(next ? probabilityOfProfit(toPure(legs), spot, iv, dte).density : []);
    props.onSnapshot?.(next);
  };

  createEffect(() => {
    // Read every input explicitly so the effect re-runs on a real change and the
    // gate above decides whether the arithmetic actually happens.
    void props.legs;
    void props.spot;
    void props.iv;
    void props.dteYears;
    recompute(false);
  });

  onMount(() => {
    const resize = () => chart?.resize();
    window.addEventListener("resize", resize);
    onCleanup(() => window.removeEventListener("resize", resize));
    const el = chartEl;
    if (!el) return;
    void loadEcharts().then((lib) => {
      if (disposed || !lib || !chartEl) return;
      chart = lib.init(chartEl, undefined, { renderer: "canvas" });
      // Merge mode: `notMerge: true` wipes the axis annotations on every tick.
      chart.setOption(
        buildOption(snapshot() ?? emptySnapshot(), props.spot, ivDecimal(), density(), chartMuted()),
        { notMerge: false, lazyUpdate: true },
      );
    });
  });

  createEffect(() => {
    const current = snapshot();
    if (!chart || !current) return;
    chart.setOption(buildOption(current, props.spot, ivDecimal(), density(), chartMuted()), {
      notMerge: false,
      lazyUpdate: true,
    });
  });

  onCleanup(() => {
    disposed = true;
    chart?.dispose();
    chart = null;
  });

  const beText = createMemo(() => {
    const current = snapshot();
    if (!current || current.breakevens.length === 0) return "—";
    return current.breakevens.map((be) => Math.round(be).toLocaleString("en-IN")).join(" · ");
  });

  const expectedPnl = createMemo(() => {
    const current = snapshot();
    return current && Number.isFinite(current.expectedPnl) ? current.expectedPnl : null;
  });

  /** An unbounded side prints `∞` — colour it by which tail has no strike. */
  const maxPnlTone = createMemo(() => {
    const current = snapshot();
    if (!current) return undefined;
    const unbounded = (value: number | null) => value == null || !Number.isFinite(value);
    if (unbounded(current.maxLoss)) return palette.NEGATIVE;
    if (unbounded(current.maxProfit)) return palette.POSITIVE;
    return undefined;
  });

  const showSigma = () => props.dteYears != null && Number.isFinite(props.dteYears);

  return (
    <>
      <Box
        className={props.height != null ? "relative shrink-0" : "relative min-h-0 flex-1"}
        style={props.height != null ? { height: `${props.height}px` } : { "min-height": "96px" }}
      >
        <div
          ref={(node) => (chartEl = node)}
          data-testid={props["data-testid"] ?? "options-payoff-chart"}
          data-points={snapshot()?.points.length ?? 0}
          style={{ width: "100%", height: "100%" }}
        />
        <Show when={!snapshot()}>
          <Box
            className="absolute inset-0 flex items-center justify-center"
            data-testid="options-payoff-empty"
          >
            <Text size="xs" c="dimmed">
              Add a leg to see the payoff
            </Text>
          </Box>
        </Show>
      </Box>
      <Show when={props.footer ?? true}>
        <Box
          className="flex h-[24px] items-stretch border-t border-fin-border"
          data-testid="options-payoff-footer"
        >
          <PayoffMetric label="BE" testId="options-breakevens" value={beText()} />
          <PayoffMetric
            label="MAX P/L"
            testId="options-max-pnl"
            bordered
            value={`${signedCompact(snapshot()?.maxProfit ?? null)} / ${signedCompact(snapshot()?.maxLoss ?? null)}`}
            tone={maxPnlTone()}
          />
          <PayoffMetric
            label="MODEL E[P&L]"
            testId="options-expected-pnl"
            bordered
            value={expectedPnl() != null ? signedCompact(expectedPnl()) : "—"}
            tone={
              expectedPnl() == null
                ? undefined
                : expectedPnl()! > 0
                  ? palette.POSITIVE
                  : expectedPnl()! < 0
                    ? palette.NEGATIVE
                    : undefined
            }
          />
          <Show when={showSigma()}>
            <PayoffMetric
              label="±1σ"
              testId="options-expected-move"
              bordered
              value={
                snapshot()
                  ? Math.round(expectedMove(props.spot, ivDecimal(), dteYears())).toLocaleString("en-IN")
                  : "—"
              }
            />
          </Show>
        </Box>
      </Show>
    </>
  );
}

/**
 * One footer cell: a 9px label over a 10px number, divided by a hairline. Four
 * cells at 480px are too narrow for `LABEL value` on one line, so the value
 * sits under its label and each cell keeps its own column.
 */
function PayoffMetric(props: {
  label: string;
  value: string;
  testId: string;
  tone?: string;
  /** Cells after the first carry the left divider; the row's own border is the top. */
  bordered?: boolean;
}) {
  return (
    <Box
      className={`flex min-w-0 flex-1 flex-col justify-center px-1.5${
        props.bordered ? " border-l border-fin-border" : ""
      }`}
      data-testid={props.testId}
    >
      <Text
        size="xs"
        c="dimmed"
        className="truncate uppercase"
        style={{ "font-size": "9px", "letter-spacing": "0.06em", "line-height": "1.1" }}
      >
        {props.label}
      </Text>
      <Text
        size="xs"
        fw={700}
        className="truncate font-mono tabular-nums"
        style={{ "font-size": "10px", "line-height": "1.2", color: props.tone }}
        data-testid={`${props.testId}-value`}
      >
        {props.value}
      </Text>
    </Box>
  );
}
