import { useEffect, useMemo } from "react";
import { Badge, Box, Text } from "@/ui";
import { useECharts } from "@/hooks/useECharts";
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

export function SimPayoff({
  strategy,
  view,
  planLegs = [],
  entryTime = "09:35",
  spot,
  height = 280,
}: SimPayoffProps) {
  const { chartRef, setChartOption } = useECharts({ isDark: true });
  // The backend caps max profit/loss at the plotted range. The shared payoff
  // helper knows a naked short tail (null = unbounded), so the stat never
  // pretends a short strangle has a finite worst case.
  const summary = useMemo(
    () => payoffSummary(toPayoffLegs(strategy?.legs ?? [])),
    [strategy],
  );
  const hasPayoff =
    strategy != null &&
    strategy.payoff.spots.length > 0 &&
    strategy.payoff.expiry.length > 0;
  // Declared before the effect so the dependency array can reference them.
  // `strategy` is null-safe here: the mark is only consumed inside the
  // effect, which returns early when there is no strategy.
  const mark = view?.total ?? (strategy?.total ?? 0);
  const markTime = view?.equity.at(-1)?.t ?? null;
  // The backend resolves strikes and premiums at the entry fill. Before that
  // bar, those are future data: show the plan, never the entry structure.
  const entered = view ? view.trades.length > 0 : true;

  useEffect(() => {
    if (!strategy || !hasPayoff || !entered) return;
    const legs = toPayoffLegs(strategy.legs);
    const strikes = strategy.legs.map((leg) => leg.strike);
    const { lo, hi } = plotWindow(strikes, strategy.breakevens, spot);
    const spots = Array.from(
      { length: POINTS },
      (_, index) => lo + ((hi - lo) * index) / (POINTS - 1),
    );
    const curve = payoffCurve(legs, spots);
    const positive = curve.map((point) => [point.spot, Math.max(0, point.pnl)]);
    const negative = curve.map((point) => [point.spot, Math.min(0, point.pnl)]);
    const line = curve.map((point) => [point.spot, point.pnl]);

    const breakevenLines = strategy.breakevens
      .filter((value) => value >= lo && value <= hi)
      .map((value) => ({
        xAxis: value,
        lineStyle: { color: palette.CHART_AVG_ENTRY, type: "dashed", width: 1 },
        label: {
          formatter: axisSpot(value),
          position: "insideEndTop",
          fontSize: 12,
          color: palette.CHART_AVG_ENTRY,
        },
      }));

    // The curve is an expiry value, so the spot marker sits ON the curve.
    // The desk's live realized/unrealized P&L lives in the stats row and RUNS.
    const expiryAtSpot = payoffCurve(legs, [spot])[0]?.pnl ?? 0;
    const markPointData: Record<string, unknown>[] = [
      {
        name: "expiry at spot",
        coord: [spot, expiryAtSpot],
        symbol: "circle",
        symbolSize: 10,
        itemStyle: { color: palette.TERM_SPOT, borderColor: palette.TERM_BG, borderWidth: 2 },
        label: {
          formatter: `expiry ${fmtSignedInr(expiryAtSpot)}`,
          position: "right",
          distance: 6,
          fontSize: 12,
          color: palette.TEXT,
          backgroundColor: palette.TERM_BG,
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

    void setChartOption({
      animation: false,
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        textStyle: { fontSize: 12 },
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
      grid: { left: 10, right: 18, top: 22, bottom: 26, containLabel: true },
      xAxis: {
        type: "value",
        min: lo,
        max: hi,
        splitNumber: 5,
        axisLabel: {
          color: palette.CHART_MUTED,
          fontSize: 12,
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
          fontSize: 12,
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
          lineStyle: { color: palette.PRIMARY, width: 2 },
          itemStyle: { color: palette.PRIMARY },
          data: line,
          markLine: {
            symbol: "none",
            silent: true,
            data: [
              {
                yAxis: 0,
                lineStyle: { color: palette.CHART_MUTED, type: "dashed", width: 1 },
              },
              {
                xAxis: spot,
                lineStyle: { color: palette.TERM_SPOT, type: "dotted", width: 1 },
                label: {
                  formatter: "SPOT",
                  position: "insideEndBottom",
                  fontSize: 12,
                  color: palette.TERM_SPOT,
                },
              },
              {
                yAxis: mark,
                lineStyle: { color: toneColor(mark), type: "dotted", width: 1 },
                label: {
                  formatter:
                    "MARK " +
                    fmtSignedInr(mark) +
                    (markTime ? " @ " + fmtTime(markTime) : ""),
                  position: "insideStartTop",
                  fontSize: 12,
                  color: toneColor(mark),
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
              color: toneColor(mark),
              borderColor: palette.TERM_BG,
              borderWidth: 2,
            },
            data: [[spot, mark]],
            label: {
              formatter:
                "MARK " +
                fmtSignedInr(mark) +
                (markTime ? " @ " + fmtTime(markTime) : ""),
              position: "bottom",
              fontSize: 12,
              backgroundColor: palette.TERM_BG,
              padding: [2, 4],
            },
          },
        ],
    });
  }, [strategy, spot, hasPayoff, entered, mark, markTime]);

  if (!strategy || !hasPayoff) {
    return (
      <Box
        data-testid="sim-payoff-empty"
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: height,
        }}
      >
        <Text size="sm" c="dimmed">
          Run the desk to see the expiry payoff
        </Text>
      </Box>
    );
  }

  const unbounded = summary.maxProfit == null || summary.maxLoss == null;
  const realized = view?.realized ?? strategy.realized;
  const unrealized = view?.unrealized ?? strategy.unrealized;
  const total = view?.total ?? strategy.total;
  const planText = planLegs.length > 0 ? planLegs.map(legLabel).join(" · ") : "No legs";

  return (
    <Box
      data-testid="sim-payoff"
      sx={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        gap: 1,
      }}
    >
      <Box
        ref={chartRef}
        data-testid="sim-payoff-chart"
        sx={{ width: "100%", height, flex: "0 0 auto", minWidth: 0 }}
      />
      {!entered ? (
        <Box
          data-testid="sim-payoff-not-entered"
          sx={{
            position: "absolute",
            inset: 0,
            zIndex: 2,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 0.75,
            px: 2,
            textAlign: "center",
            bgcolor: palette.TERM_BG,
          }}
        >
          <Badge color="warning" variant="outline" size="xs">
            NOT ENTERED
          </Badge>
          <Text size="sm">Plan: {planText}</Text>
          <Text size="xs" c="dimmed">
            {strategy.skipped
              ? `Skipped: ${strategy.skipped}`
              : `Payoff, net debit and breakevens unlock after the fill (entry ${entryTime} + the next recorded minute).`}
          </Text>
        </Box>
      ) : null}
      {entered ? (
        <Text size="xs" c="dimmed">
          Expiry payoff at these strikes, before costs. Shaded green above zero,
          red below.
          {unbounded ? " A naked tail is unbounded beyond the plotted window." : ""}
        </Text>
      ) : null}
      <CompactStatGrid cols={entered ? 4 : 3} spacing={4}>
        {entered ? (
          <>
            <CompactStat
              dense
              data-testid="sim-payoff-debit"
              label="Net debit"
              value={fmtInr(strategy.netDebit)}
            />
            <CompactStat
              dense
              data-testid="sim-payoff-max-profit"
              label="Max profit"
              tone={palette.POSITIVE}
              value={
                summary.maxProfit == null ? "unbounded" : fmtInr(summary.maxProfit)
              }
            />
            <CompactStat
              dense
              data-testid="sim-payoff-max-loss"
              label="Max loss"
              tone={palette.NEGATIVE}
              value={summary.maxLoss == null ? "unbounded" : fmtInr(summary.maxLoss)}
            />
            <CompactStat
              dense
              data-testid="sim-payoff-breakevens"
              label="Breakevens"
              value={breakevenText(strategy.breakevens)}
            />
          </>
        ) : null}
        <CompactStat
          dense
          data-testid="sim-payoff-realized"
          label="Realized"
          tone={toneColor(realized)}
          value={fmtSignedInr(realized)}
        />
        <CompactStat
          dense
          data-testid="sim-payoff-unrealized"
          label="Unrealized"
          tone={toneColor(unrealized)}
          value={fmtSignedInr(unrealized)}
        />
        <CompactStat
          dense
          data-testid="sim-payoff-total"
          label="Total"
          tone={toneColor(total)}
          value={fmtSignedInr(total)}
        />
      </CompactStatGrid>
    </Box>
  );
}

export default SimPayoff;
