import { createMemo } from "solid-js";
import { Box, Text } from "@/ui";
import * as palette from "@/ui/palette";
import { useChartInk } from "@/components/options-dock/analytics/chartInk";
import { axis, baseOption, CHART_GRID, legend, paddedDomain, tooltip } from "./chartBase";
import {
  expiryLabel,
  expiryOptions,
  liquidityAggregate,
  liquidityStats,
  spreadCells,
  volOiSeries,
} from "./dataRead";
import {
  ChartCaption,
  ChartFrame,
  ExpiryChips,
  formatCompact,
  formatNumber,
  MetricBand,
  pillarGridClass,
  PILLAR_CAPTION_CLASS,
} from "./shared";
import { REASON, type PanelProps } from "./types";

function Badge(props: { label: string; value: string; color: string; testId: string }) {
  return (
    <Box
      className="inline-flex min-w-0 items-center gap-1.5 rounded-fin px-1.5 py-0.5"
      style={{ "background-color": palette.alpha(props.color, 0.12) }}
      data-testid={props.testId}
    >
      <Text size="xs" className="uppercase" style={{ "font-size": "9px", color: palette.TEXT_MUTED }}>
        {props.label}
      </Text>
      <Text size="xs" fw={700} className="font-mono tabular-nums" style={{ "font-size": "10px", color: props.color }}>
        {props.value}
      </Text>
    </Box>
  );
}

/** Liquidity pillar: bid-ask spread surface, volume/OI and quote-quality badges. */
export function LiquidityPillar(props: PanelProps) {
  const ink = useChartInk();
  const options = createMemo(() => expiryOptions(props.data));
  const cells = createMemo(() => spreadCells(props.data));
  const volOi = createMemo(() => volOiSeries(props.data));
  const aggregate = createMemo(() => liquidityAggregate(props.data, props.selectedExpiry));
  const stats = createMemo(() => {
    const computed = liquidityStats(cells());
    if (computed.total > 0) return computed;
    // Per-expiry aggregate from the dashboard DTO; no fabricated cell-level
    // spread, just the quote-quality summary the client actually carries.
    const agg = aggregate();
    return {
      median: agg?.avgSpreadPct ?? null,
      unquoted: agg?.thin ? 1 : 0,
      total: agg?.liquidStrikes ?? 0,
    };
  });

  const strikes = createMemo(() =>
    [...new Set(cells().map((cell) => cell.strike))].sort((a, b) => a - b),
  );
  const expiries = createMemo(() => {
    const listed = options().map((option) => option.date);
    const present = [...new Set(cells().map((cell) => cell.expiry))];
    return listed.length ? listed.filter((date) => present.includes(date)) : present;
  });

  const spreadOption = createMemo(() => {
    const color = ink();
    const rows = cells().filter((cell) => cell.spread != null);
    const data = rows.map((cell) => [
      strikes().indexOf(cell.strike),
      expiries().indexOf(cell.expiry),
      cell.spread as number,
    ]);
    const values = data.map((cell) => cell[2]);
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 1;
    return {
      ...baseOption(color),
      grid: CHART_GRID,
      tooltip: {
        ...tooltip(),
        position: "top",
        formatter: (params: { data: number[] }) => {
          const [x, y, spread] = params.data;
          return `${strikes()[x] ?? ""} · ${expiryLabel(expiries()[y], null)}<br/>Spread ${Number(spread).toFixed(2)}`;
        },
      },
      // No axis name: the caption and the frame's aria label already say
      // "strike × expiry", and a 10px name at `nameGap` lands on the bottom
      // band where the continuous scale prints "Tight"/"Wide" (measured
      // collision at 390, x≈194-247 / y≈175-180).
      xAxis: axis(color, "", { type: "category", data: strikes().map(String) }),
      yAxis: axis(color, "Expiry", {
        type: "category",
        data: expiries().map((d) => expiryLabel(d, null)),
      }),
      // The scale lives in the reserved top band, clear of both the tick
      // labels and the frame's y-unit text; horizontal bars run left→right
      // (itemHeight is the length after the 90° group rotation).
      visualMap: {
        type: "continuous",
        min: Number(min.toFixed(2)),
        max: Number(Math.max(max, min + 0.01).toFixed(2)),
        calculable: false,
        orient: "horizontal",
        right: 8,
        top: 4,
        itemWidth: 8,
        itemHeight: 60,
        text: ["Wide", "Tight"],
        textStyle: { color, fontSize: 10 },
        inRange: { color: [palette.RAMP_GREEN, palette.RAMP_NEUTRAL, palette.RAMP_RED] },
      },
      series: [
        {
          name: "Spread",
          type: "heatmap",
          data,
          itemStyle: { borderColor: palette.BG, borderWidth: 0.5 },
          emphasis: { itemStyle: { borderColor: palette.TEXT, borderWidth: 1 } },
        },
      ],
    };
  });

  const volOiOption = createMemo(() => {
    const color = ink();
    return {
      ...baseOption(color),
      grid: CHART_GRID,
      tooltip: tooltip(),
      legend: legend(color, ["Vol / OI"]),
      xAxis: axis(color, "Strike", paddedDomain(volOi().map((row) => row.strike))),
      yAxis: axis(color, "Vol / OI"),
      series: [
        {
          name: "Vol / OI",
          type: "bar",
          barMaxWidth: 12,
          data: volOi().map((row) => [row.strike, row.value]),
          itemStyle: { color: palette.INFO },
        },
      ],
    };
  });

  return (
    <Box className="flex min-h-0 flex-1 flex-col max-sm:flex-none" data-testid="pillar-liquidity">
      <Box className="flex h-[20px] shrink-0 items-center px-1.5" data-testid="liquidity-caption">
        <span class={PILLAR_CAPTION_CLASS}>
          Liquidity · Bid-ask spread, volume / OI &amp; quote quality
        </span>
      </Box>
      <ExpiryChips
        options={options()}
        selectedExpiry={props.selectedExpiry}
        onExpiry={props.onExpiry}
        testId="liquidity-expiry"
      />
      <Box className="flex shrink-0 flex-wrap items-center gap-1.5 px-1.5 py-1" data-testid="liquidity-badges">
        <Badge
          label="Median spread"
          value={formatNumber(stats().median, 2)}
          color={palette.INFO}
          testId="liquidity-median-badge"
        />
        <Badge
          label="Illiquid"
          value={`${stats().unquoted}/${stats().total}`}
          color={stats().unquoted > 0 ? palette.WARNING : palette.POSITIVE}
          testId="liquidity-illiquid-badge"
        />
      </Box>
      <Box className={pillarGridClass(1)} data-testid="liquidity-chart-grid">
        <ChartFrame
          testId="spread-heatmap-chart"
          label="Bid-ask spread heatmap by strike and expiry"
          description="Two-sided quote spread across strikes and expiries; blank cells have no quote."
          option={spreadOption()}
          optionKey={`spread|${cells().map((c) => `${c.expiry}:${c.strike}:${c.spread}`).join(",")}`}
          empty={cells().length === 0}
          emptyText={REASON.noSpread}
        />
        <ChartFrame
          testId="vol-oi-chart"
          label="Volume to open-interest ratio by strike"
          description="Volume divided by open interest per strike, a churn / liquidity read."
          option={volOiOption()}
          optionKey={`voloi|${volOi().map((r) => `${r.strike}:${r.value}`).join(",")}`}
          empty={volOi().length === 0}
          emptyText={REASON.noVolOi}
        />
      </Box>
      <ChartCaption text="Blank cell = no two-sided quote (not a zero spread)" testId="liquidity-note" />
      <MetricBand
        testId="liquidity-metrics"
        metrics={[
          { label: "MEDIAN SPREAD", value: formatNumber(stats().median, 2), testId: "liq-metric-median" },
          {
            label: "ILLIQUID",
            value: `${stats().unquoted}/${stats().total}`,
            testId: "liq-metric-illiquid",
            tone: stats().unquoted > 0 ? "warning" : "positive",
          },
          { label: "QUOTED", value: formatCompact(stats().total - stats().unquoted), testId: "liq-metric-quoted" },
          { label: "VOL/OI PEAK", value: formatNumber(volOi().reduce((m, r) => Math.max(m, r.value ?? 0), 0), 2), testId: "liq-metric-peak" },
        ]}
      />
    </Box>
  );
}
