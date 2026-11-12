import { createEffect, createMemo, Show } from "solid-js";
import { Badge, Text } from "@/ui";
import { createECharts } from "../echartsSolid";
import { CompactStat, CompactStatGrid } from "@/components/common/compact";
import * as palette from "@/ui/palette";
import type { SimLegSpec, SimStrategyResult } from "@/types/reportSim";
import { payoffCurve } from "@/components/options/PremiumTracker/payoff";
import { fmtInr, fmtSignedInr, fmtTime, toneFor } from "./simFormat";
import { payoffSummary, toPayoffLegs } from "./simPayoff";
import { legLabel } from "./simSpec";
import type { StrategyView } from "./simView";

interface SimPayoffProps {
  strategy: SimStrategyResult | null;
  /** Playhead slice; realized/total come from here, never the finished day. */
  view?: StrategyView | null;
  /** The user's plan (ATM refs), safe to show before the entry fill. */
  planLegs?: SimLegSpec[];
  entryTime?: string;
  spot: number;
  height?: number;
}

const POINTS = 161;

function toneColor(value: number): string {
  const tone = toneFor(value);
  return tone === "positive"
    ? palette.POSITIVE
    : tone === "negative"
      ? palette.NEGATIVE
      : palette.TEXT_MUTED;
}

function breakevenText(breakevens: number[]): string {
  if (breakevens.length === 0) return "—";
  return breakevens.map((value) => fmtInr(value)).join(" / ");
}

function axisInr(value: number): string {
  const abs = Math.abs(value);
  const body = abs >= 1000 ? `${(abs / 1000).toFixed(1)}k` : `${Math.round(abs)}`;
  return `${value < 0 ? "-" : ""}₹${body}`;
}

function axisSpot(value: number): string {
  return Math.abs(value) >= 1000
    ? `${(value / 1000).toFixed(1)}k`
    : `${Math.round(value)}`;
}

/**
 * Plot window is anchored to the strikes, not a fixed ±8% of spot. A 200-point
 * iron condor in a ±8% window is an invisible tent in the middle of the chart;
 * ±45% of the strike span keeps the wings and the breakevens readable.
 */
function plotWindow(
  strikes: number[],
  breakevens: number[],
  spot: number,
): { lo: number; hi: number } {
  const values = [...strikes, ...breakevens].filter(
    (value) => Number.isFinite(value) && value > 0,
  );
  const refs = values.length > 0 ? values : [spot];
  const loRef = Math.min(...refs, spot);
  const hiRef = Math.max(...refs, spot);
  const span = Math.max(hiRef - loRef, spot * 0.01, 50);
  const pad = span * 0.45;
  return { lo: Math.max(1, loRef - pad), hi: hiRef + pad };
}

export function SimPayoff(props: SimPayoffProps) {
  const strategy = () => props.strategy;
  const view = () => props.view;
  const planLegs = () => props.planLegs ?? [];
  const spot = () => props.spot;
  const height = () => props.height ?? 280;
  const entryTime = () => props.entryTime ?? "09:35";
  const chart = createECharts();
  // The backend caps max profit/loss at the plotted range. The shared payoff
  // helper knows a naked short tail (null = unbounded), so the stat never
  // pretends a short strangle has a finite worst case.
  const summary = createMemo(
    () => payoffSummary(toPayoffLegs(strategy()?.legs ?? [])),
  );
  const hasPayoff = () =>
    strategy() != null &&
    strategy()!.payoff.spots.length > 0 &&
    strategy()!.payoff.expiry.length > 0;
  // Declared before the effect so the effect can track them.
  const mark = () => view()?.total ?? (strategy()?.total ?? 0);
  const markTime = () => view()?.equity.at(-1)?.t ?? null;
  // The backend resolves strikes and premiums at the entry fill. Before that
  // bar, those are future data: show the plan, never the entry structure.
  const entered = () => (view() ? view()!.trades.length > 0 : true);

  createEffect(() => {
    const activeStrategy = strategy();
    if (!activeStrategy || !hasPayoff() || !entered()) return;
    const legs = toPayoffLegs(activeStrategy.legs);
    const strikes = activeStrategy.legs.map((leg) => leg.strike);
    const { lo, hi } = plotWindow(strikes, activeStrategy.breakevens, spot());
    const spots = Array.from(
      { length: POINTS },
      (_, index) => lo + ((hi - lo) * index) / (POINTS - 1),
    );
    const curve = payoffCurve(legs, spots);
    const positive = curve.map((point) => [point.spot, Math.max(0, point.pnl)]);
    const negative = curve.map((point) => [point.spot, Math.min(0, point.pnl)]);
    const line = curve.map((point) => [point.spot, point.pnl]);

    const breakevenLines = activeStrategy.breakevens
      .filter((value) => value >= lo && value <= hi)
      .map((value) => ({
        xAxis: value,
        lineStyle: { color: palette.CHART_AVG_ENTRY, type: "dashed", "width": "1px" },
        label: {
          formatter: axisSpot(value),
          position: "insideEndTop",
          "font-size": "12px",
          color: palette.CHART_AVG_ENTRY,
        },
      }));

    // The curve is an expiry value, so the spot marker sits ON the curve.
    // The desk's live realized/unrealized P&L lives in the stats row and RUNS.
    const expiryAtSpot = payoffCurve(legs, [spot()])[0]?.pnl ?? 0;
    const markPointData: Record<string, unknown>[] = [
      {
        name: "expiry at spot",
        coord: [spot(), expiryAtSpot],
        symbol: "circle",
        symbolSize: 10,
        itemStyle: { color: palette.TERM_SPOT, "border-color": palette.TERM_BG, "border-width": "2px" },
        label: {
          formatter: `expiry ${fmtSignedInr(expiryAtSpot)}`,
          position: "right",
          distance: 6,
          "font-size": "12px",
          color: palette.TEXT,
          "background-color": palette.TERM_BG,
          padding: [2, 4],
        },
      },
    ];

    const baseSeries = {
      type: "line" as const,
      showSymbol: false,
      silent: true,
      z: 1,
      lineStyle: { opacity: 0 },
      areaStyle: { opacity: 0.2 },
    };

    void chart.setChartOption({
      animation: false,
      "background-color": "transparent",
      tooltip: {
        trigger: "axis",
        textStyle: { "font-size": "12px" },
        axisPointer: { type: "line", lineStyle: { color: palette.CHART_MUTED } },
        formatter: (params: unknown) => {
          const rows = Array.isArray(params) ? params : [params];
          const point = rows.find(
            (row) => (row as { seriesName?: string }).seriesName === "payoff",
          ) as { value?: [number, number] } | undefined;
          const value = point?.value;
          if (!value) return "";
          return `Spot ${Number(value[0]).toFixed(1)}<br/>P&amp;L ${fmtSignedInr(Number(value[1]))}`;
        },
      },
      grid: { "left": "10px", "right": "18px", "top": "22px", "bottom": "26px", containLabel: true },
      xAxis: {
        type: "value",
        min: lo,
        max: hi,
        splitNumber: 5,
        axisLabel: {
          color: palette.CHART_MUTED,
          "font-size": "12px",
          formatter: axisSpot,
          hideOverlap: true,
        },
        axisLine: { lineStyle: { color: palette.AXIS_LINE } },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        scale: true,
        splitNumber: 4,
        axisLabel: {
          color: palette.CHART_MUTED,
          "font-size": "12px",
          formatter: axisInr,
          hideOverlap: true,
        },
        axisLine: { lineStyle: { color: palette.AXIS_LINE } },
        splitLine: { lineStyle: { color: palette.AXIS_SPLIT } },
      },
      series: [
        {
          ...baseSeries,
          name: "profit",
          itemStyle: { color: palette.POSITIVE },
          areaStyle: { color: palette.POSITIVE, opacity: 0.2 },
          data: positive,
        },
        {
          ...baseSeries,
          name: "loss",
          itemStyle: { color: palette.NEGATIVE },
          areaStyle: { color: palette.NEGATIVE, opacity: 0.2 },
          data: negative,
        },
        {
          type: "line",
          name: "payoff",
          showSymbol: false,
          z: 3,
          lineStyle: { color: palette.PRIMARY, "width": "2px" },
          itemStyle: { color: palette.PRIMARY },
          data: line,
          markLine: {
            symbol: "none",
            silent: true,
            data: [
              {
                yAxis: 0,
                lineStyle: { color: palette.CHART_MUTED, type: "dashed", "width": "1px" },
              },
              {
                xAxis: spot(),
                lineStyle: { color: palette.TERM_SPOT, type: "dotted", "width": "1px" },
                label: {
                  formatter: "SPOT",
                  position: "insideEndBottom",
                  "font-size": "12px",
                  color: palette.TERM_SPOT,
                },
              },
              {
                yAxis: mark(),
                lineStyle: { color: toneColor(mark), type: "dotted", "width": "1px" },
                label: {
                  formatter:
                    "MARK " +
                    fmtSignedInr(mark()) +
                    (markTime() ? " @ " + fmtTime(markTime()!) : ""),
                  position: "insideStartTop",
                  "font-size": "12px",
                  color: toneColor(mark()),
                },
              },
              ...breakevenLines,
            ],
          },
          markPoint: { data: markPointData },
        },
        {
          type: "scatter",
          name: "mark",
            symbolSize: 9,
            z: 6,
            itemStyle: {
              color: toneColor(mark()),
              "border-color": palette.TERM_BG,
              "border-width": "2px",
            },
            data: [[spot(), mark()]],
            label: {
              formatter:
                "MARK " +
                fmtSignedInr(mark()) +
                (markTime() ? " @ " + fmtTime(markTime()!) : ""),
              position: "bottom",
              "font-size": "12px",
              "background-color": palette.TERM_BG,
              padding: [2, 4],
            },
          },
        ],
    });
  });

  const unbounded = () => summary().maxProfit == null || summary().maxLoss == null;
  const realized = () => view()?.realized ?? strategy()!.realized;
  const unrealized = () => view()?.unrealized ?? strategy()!.unrealized;
  const total = () => view()?.total ?? strategy()!.total;
  const planText = () => (planLegs().length > 0 ? planLegs().map(legLabel).join(" · ") : "No legs");

  return (
    <Show
      when={strategy() && hasPayoff()}
      fallback={
        <div
          data-testid="sim-payoff-empty"
          class="flex items-center justify-center"
          style={{ "min-height": `${height()}px` }}
        >
          <Text size="sm" c="dimmed">
            Run the desk to see the expiry payoff
          </Text>
        </div>
      }
    >
    <div
      data-testid="sim-payoff"
      class="relative flex flex-col flex-1 min-h-0 min-w-0 gap-2"
    >
      <div
        ref={chart.ref}
        data-testid="sim-payoff-chart"
        class="w-full flex-[0_0_auto] min-w-0"
        style={{ height: `${height()}px` }}
      />
      <Show when={!entered()}>
        <div
          data-testid="sim-payoff-not-entered"
          class="absolute inset-0 z-[2] flex flex-col items-center justify-center gap-1.5 px-4 text-center"
          style={{ "background-color": palette.TERM_BG }}
        >
          <Badge color="warning" variant="outline" size="xs">
            NOT ENTERED
          </Badge>
          <Text size="sm">Plan: {planText()}</Text>
          <Text size="xs" c="dimmed">
            {strategy()!.skipped
              ? `Skipped: ${strategy()!.skipped}`
              : `Payoff, net debit and breakevens unlock after the fill (entry ${entryTime()} + the next recorded minute).`}
          </Text>
        </div>
      </Show>
      <Show when={entered()}>
        <Text size="xs" c="dimmed">
          Expiry payoff at these strikes, before costs. Shaded green above zero,
          red below.
          {unbounded() ? " A naked tail is unbounded beyond the plotted window." : ""}
        </Text>
      </Show>
      <CompactStatGrid cols={entered() ? 4 : 3} spacing={4}>
        <Show when={entered()}>
          <>
            <CompactStat
              dense
              data-testid="sim-payoff-debit"
              label="Net debit"
              value={fmtInr(strategy()!.netDebit)}
            />
            <CompactStat
              dense
              data-testid="sim-payoff-max-profit"
              label="Max profit"
              tone={palette.POSITIVE}
              value={
                summary().maxProfit == null ? "unbounded" : fmtInr(summary().maxProfit!)
              }
            />
            <CompactStat
              dense
              data-testid="sim-payoff-max-loss"
              label="Max loss"
              tone={palette.NEGATIVE}
              value={summary().maxLoss == null ? "unbounded" : fmtInr(summary().maxLoss!)}
            />
            <CompactStat
              dense
              data-testid="sim-payoff-breakevens"
              label="Breakevens"
              value={breakevenText(strategy()!.breakevens)}
            />
          </>
        </Show>
        <CompactStat
          dense
          data-testid="sim-payoff-realized"
          label="Realized"
          tone={toneColor(realized())}
          value={fmtSignedInr(realized())}
        />
        <CompactStat
          dense
          data-testid="sim-payoff-unrealized"
          label="Unrealized"
          tone={toneColor(unrealized())}
          value={fmtSignedInr(unrealized())}
        />
        <CompactStat
          dense
          data-testid="sim-payoff-total"
          label="Total"
          tone={toneColor(total())}
          value={fmtSignedInr(total())}
        />
      </CompactStatGrid>
    </div>
    </Show>
  );
}

export default SimPayoff;
