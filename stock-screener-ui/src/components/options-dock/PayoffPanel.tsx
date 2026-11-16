import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import { Box, Text } from "@/ui";
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
 * Payoff at expiry plus the probability read.
 *
 * Recompute gate: legs change, or spot moves ≥ 0.05 %. A 10 s frame patch that
 * nudges spot by ₹2 on 24 000 must not re-run 241 points × N legs.
 */
const SPOT_MOVE_EPSILON = 0.0005;
/** Horizontal pixel budget for the y axis labels. */
const GRID_LEFT = 46;

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

/** Pure: the panel and its tests both call this. */
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

function money(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "∞";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}₹${formatNumber(Math.abs(value))}`;
}

function pct(value: number): string {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "—";
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

/** Bands where the basket is profitable: breakeven 1→2, 3→4, … with the window edges. */
function profitableBands(breakevens: number[], spots: number[]): { xAxis: string }[][] | undefined {
  if (breakevens.length === 0 || spots.length === 0) return undefined;
  const min = spots[0];
  const max = spots[spots.length - 1];
  const bounds = [min, ...breakevens.filter((be) => be > min && be < max), max];
  if (bounds.length < 2) return undefined;
  const pairs: { xAxis: string }[][] = [];
  for (let i = 0; i + 1 < bounds.length; i += 2) {
    pairs.push([
      { xAxis: Math.round(bounds[i]).toString() },
      { xAxis: Math.round(bounds[i + 1]).toString() },
    ]);
  }
  return pairs;
}

function buildOption(
  snapshot: PayoffSnapshot,
  spot: number,
  iv: number,
  density: { spot: number; prob: number }[],
) {
  const spots = snapshot.points.map((point) => point.spot);
  const maxProb = density.reduce((max, cell) => Math.max(max, cell.prob), 0);
  const densitySeries = density.map((cell) => ({
    spot: cell.spot,
    prob: maxProb > 0 ? (cell.prob / maxProb) * Math.max(0.15, Math.abs(snapshot.maxProfit ?? 1)) : 0,
  }));
  const spotLabel = Math.round(spot).toString();

  return {
    animation: false,
    backgroundColor: "transparent",
    grid: { left: GRID_LEFT, right: 8, top: 8, bottom: 18 },
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
        color: palette.CHART_MUTED,
        fontSize: 9,
        interval: Math.max(0, Math.floor(spots.length / 6)),
      },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: palette.CHART_MUTED, fontSize: 9 },
      splitLine: { lineStyle: { color: palette.AXIS_SPLIT } },
    },
    series: [
      {
        name: "P&L",
        type: "line",
        data: snapshot.points.map((point) => Math.round(point.pnl)),
        showSymbol: false,
        lineStyle: { width: 1.5, color: palette.PRIMARY },
        areaStyle: { color: palette.alpha(palette.PRIMARY, 0.1) },
        markLine: {
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
        },
        markArea: {
          silent: true,
          itemStyle: { color: palette.alpha(palette.POSITIVE, 0.08) },
          data: profitableBands(snapshot.breakevens, spots) ?? [],
        },
        z: 2,
      },
      {
        name: "P(S)",
        type: "line",
        data: densitySeries.map((cell) => Math.round(cell.prob)),
        showSymbol: false,
        lineStyle: { width: 0, opacity: 0 },
        areaStyle: { color: palette.alpha(palette.INFO, 0.18) },
        silent: true,
        z: 1,
      },
    ],
    // `flat vol` is a disclosure, not a decoration: the POP below is computed at
    // the ATM IV, so the panel says which σ the number came from.
    graphic: [
      {
        type: "text",
        right: 6,
        bottom: 2,
        style: {
          text: `flat vol ${Number.isFinite(iv) && iv > 0 ? (iv * 100).toFixed(1) : "—"}%`,
          fill: palette.CHART_MUTED,
          fontSize: 9,
          fontFamily: palette.MONO,
        },
      },
    ],
  };
}

export function PayoffPanel(props: {
  legs: DockLeg[];
  spot: number;
  /** ATM IV in vol points (13.8 = 13.8 %), `null` when the feed quotes none. */
  iv: number | null;
  dteYears: number;
}) {
  let chartEl: HTMLDivElement | undefined;
  let chart: any = null;
  let disposed = false;

  // The gate: remember the inputs the current curve was built from.
  let lastSignature = "";
  let lastSpot = 0;
  const [snapshot, setSnapshot] = createSignal<PayoffSnapshot | null>(null);
  const [density, setDensity] = createSignal<{ spot: number; prob: number }[]>([]);

  const ivDecimal = () => {
    const iv = props.iv;
    return iv != null && Number.isFinite(iv) && iv > 0 ? iv / 100 : Number.NaN;
  };

  const recompute = (force: boolean) => {
    const legs = props.legs;
    const spot = props.spot;
    const signature = legSignature(legs);
    const moved = Math.abs(spot - lastSpot) / Math.max(spot, 1);
    if (!force && signature === lastSignature && moved < SPOT_MOVE_EPSILON) return;
    lastSignature = signature;
    lastSpot = spot;

    if (legs.length === 0 || !(spot > 0)) {
      setSnapshot(null);
      setDensity([]);
      return;
    }
    const next = buildPayoff(legs, spot, ivDecimal(), props.dteYears);
    setSnapshot(next);
    setDensity(next ? probabilityOfProfit(toPure(legs), spot, ivDecimal(), props.dteYears).density : []);
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
      chart.setOption(buildOption(snapshot() ?? emptySnapshot(), props.spot, ivDecimal(), density()), {
        notMerge: false,
        lazyUpdate: true,
      });
    });
  });

  createEffect(() => {
    const current = snapshot();
    if (!chart || !current) return;
    chart.setOption(buildOption(current, props.spot, ivDecimal(), density()), {
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

  return (
    <Box className="flex min-h-0 flex-1 flex-col border-t border-fin-border" data-testid="options-payoff">
      <Box className="flex items-center justify-between gap-2 px-2 py-1">
        <Text
          size="xs"
          fw={700}
          className="font-mono tabular-nums uppercase tracking-[0.08em] text-fin-text-muted"
          style={{ "font-size": "9px" }}
        >
          PAYOFF
        </Text>
        <Box className="flex items-baseline gap-2">
          <Text size="xs" c="dimmed" className="uppercase" style={{ "font-size": "9px" }}>
            POP
          </Text>
          <Text
            size="xs"
            fw={700}
            className="font-mono tabular-nums"
            data-testid="options-pop"
          >
            {snapshot() ? pct(snapshot()!.pop) : "—"}
          </Text>
        </Box>
      </Box>

      <Box className="relative min-h-0 flex-1" style={{ "min-height": "96px" }}>
        <div
          ref={(node) => (chartEl = node)}
          data-testid="options-payoff-chart"
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

      <Box className="flex flex-wrap items-center gap-x-3 gap-y-0 px-2 pb-1">
        <Text
          size="xs"
          c="dimmed"
          className="font-mono tabular-nums"
          style={{ "font-size": "10px" }}
          data-testid="options-breakevens"
        >
          BE {beText()}
        </Text>
        <Text
          size="xs"
          c="dimmed"
          className="font-mono tabular-nums"
          style={{ "font-size": "10px" }}
          data-testid="options-max-pnl"
        >
          max {money(snapshot()?.maxProfit ?? null)} / {money(snapshot()?.maxLoss ?? null)}
        </Text>
        <Text
          size="xs"
          c="dimmed"
          className="font-mono tabular-nums"
          style={{ "font-size": "10px" }}
          data-testid="options-expected-pnl"
        >
          model E[P&L]{" "}
          {snapshot() && Number.isFinite(snapshot()!.expectedPnl) ? money(snapshot()!.expectedPnl) : "—"}
        </Text>
        <Text
          size="xs"
          c="dimmed"
          className="font-mono tabular-nums"
          style={{ "font-size": "10px" }}
          data-testid="options-expected-move"
        >
          ±1σ{" "}
          {snapshot()
            ? Math.round(expectedMove(props.spot, ivDecimal(), props.dteYears)).toLocaleString("en-IN")
            : "—"}
        </Text>
      </Box>
    </Box>
  );
}
