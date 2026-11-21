import { createMemo } from "solid-js";
import { Box } from "@/ui";
import * as palette from "@/ui/palette";
import { useChartInk } from "@/components/options-dock/analytics/chartInk";
import { axis, baseOption, CHART_GRID, guideSeries, legend, paddedDomain, tooltip, WALL_COLOR } from "./chartBase";
import {
  expiryFor,
  expiryLabel,
  expiryOptions,
  oiByStrike,
  payoutCurve,
  pcrByStrike,
  wallMarks,
} from "./dataRead";
import { ChartFrame, ExpiryChips, formatCompact, formatNumber, MetricBand, pillarGridClass, PILLAR_CAPTION_CLASS } from "./shared";
import { REASON, type PanelProps } from "./types";

/** Positioning pillar: where open interest sits, how it moved, and the magnets. */
export function PositioningPillar(props: PanelProps) {
  const ink = useChartInk();
  const options = createMemo(() => expiryOptions(props.data));
  const expiry = createMemo(() => expiryFor(props.data, props.selectedExpiry));
  const caption = createMemo(() => expiryLabel(expiry()?.date, expiry()?.dte));

  const oi = createMemo(() => oiByStrike(props.data, props.selectedExpiry));
  const payout = createMemo(() => payoutCurve(oi()));
  const pcr = createMemo(() => pcrByStrike(oi()));
  const deltaOi = createMemo(() => props.data.positioning?.deltaOi ?? []);
  const volume = createMemo(() => props.data.positioning?.volume ?? []);

  const marks = createMemo(() => [
    ...wallMarks(props.data.levels).map((wall) => ({
      xAxis: wall.strike,
      name: wall.label,
      color: WALL_COLOR[wall.label] ?? palette.INFO,
    })),
    ...(typeof props.data.spot === "number" && Number.isFinite(props.data.spot)
      ? [{ xAxis: props.data.spot, name: "SPOT", color: palette.PRIMARY }]
      : []),
  ]);

  const oiOption = createMemo(() => {
    const color = ink();
    const rows = oi();
    return {
      ...baseOption(color),
      grid: CHART_GRID,
      tooltip: tooltip(),
      legend: legend(color, ["CE OI", "PE OI"]),
      xAxis: axis(color, "Strike", paddedDomain(rows.map((row) => row.strike))),
      // Compact ticks keep the label band narrow enough for the grid gutter;
      // the bars keep their raw OI values, so the tooltip is unchanged.
      yAxis: axis(color, "OI (mirrored)", { formatter: formatCompact }),
      series: [
        {
          name: "CE OI",
          type: "bar",
          barMaxWidth: 12,
          data: rows.map((row) => [row.strike, row.ce ?? 0]),
          itemStyle: { color: palette.OI_CALL },
        },
        {
          name: "PE OI",
          type: "bar",
          barMaxWidth: 12,
          data: rows.map((row) => [row.strike, -(row.pe ?? 0)]),
          itemStyle: { color: palette.OI_PUT },
        },
        guideSeries(color, marks()),
      ],
    };
  });

  const flowOption = createMemo(() => {
    const color = ink();
    const doi = deltaOi();
    const vol = volume();
    const volByStrike = new Map(vol.map((row) => [row.strike, (row.ce ?? 0) + (row.pe ?? 0)]));
    return {
      ...baseOption(color),
      grid: CHART_GRID,
      tooltip: tooltip(),
      legend: legend(color, ["Δ CE OI", "Δ PE OI", "Volume"]),
      xAxis: axis(
        color,
        "Strike",
        paddedDomain([...doi.map((row) => row.strike), ...vol.map((row) => row.strike)]),
      ),
      yAxis: axis(color, "Δ OI (mirrored)", { formatter: formatCompact }),
      series: [
        {
          name: "Δ CE OI",
          type: "bar",
          barMaxWidth: 12,
          data: doi.map((row) => [row.strike, row.ce ?? 0]),
          itemStyle: { color: palette.POSITIVE },
        },
        {
          name: "Δ PE OI",
          type: "bar",
          barMaxWidth: 12,
          data: doi.map((row) => [row.strike, -(row.pe ?? 0)]),
          itemStyle: { color: palette.NEGATIVE },
        },
        {
          name: "Volume",
          type: "line",
          showSymbol: false,
          data: doi.map((row) => [row.strike, volByStrike.get(row.strike) ?? null]),
          lineStyle: { color: palette.PRIMARY, width: 1.5 },
          itemStyle: { color: palette.PRIMARY },
          connectNulls: true,
        },
        guideSeries(color, marks()),
      ],
    };
  });

  const payoutOption = createMemo(() => {
    const color = ink();
    const curve = payout();
    const pain = props.data.levels?.maxPain;
    const min = curve.length
      ? curve.reduce((best, row) => ((row.value ?? 0) < (best.value ?? 0) ? row : best))
      : null;
    return {
      ...baseOption(color),
      grid: CHART_GRID,
      tooltip: tooltip(),
      xAxis: axis(color, "Strike", paddedDomain(curve.map((row) => row.strike))),
      // The payout sums OI × strike distance and reaches 1e9 on a full ladder;
      // a full-width tick (13 glyphs) pushed the label band past the frame's
      // left edge at 390. Compact ticks cap the band at "120.0Cr"; the tooltip
      // reads the raw series values, so the full payout is still shown.
      yAxis: axis(color, "Payout", { formatter: formatCompact }),
      series: [
        {
          name: "Payout",
          type: "line",
          smooth: true,
          showSymbol: false,
          data: curve.map((row) => [row.strike, row.value]),
          lineStyle: { color: palette.WARNING, width: 2 },
          itemStyle: { color: palette.WARNING },
          areaStyle: { color: palette.alpha(palette.WARNING, 0.12) },
          markLine:
            min || typeof pain === "number"
              ? {
                  silent: true,
                  symbol: "none",
                  data: (min ? [{ xAxis: min.strike, name: "MIN" }] : []).concat(
                    typeof pain === "number" ? [{ xAxis: pain, name: "MAX PAIN" }] : [],
                  ).map((mark) => ({
                    ...mark,
                    lineStyle: { color: palette.LEVEL_MAX_PAIN, width: 1, type: "dashed" as const },
                    label: { show: true, formatter: mark.name, color, fontSize: 10 },
                  })),
                }
              : undefined,
        },
      ],
    };
  });

  const pcrOption = createMemo(() => {
    const color = ink();
    return {
      ...baseOption(color),
      grid: CHART_GRID,
      tooltip: tooltip(),
      xAxis: axis(color, "Strike", paddedDomain(pcr().map((row) => row.strike))),
      yAxis: axis(color, "Cumulative PCR"),
      series: [
        {
          name: "PCR",
          type: "line",
          smooth: true,
          showSymbol: true,
          symbolSize: 4,
          data: pcr().map((row) => [row.strike, row.value]),
          lineStyle: { color: palette.INFO, width: 2 },
          itemStyle: { color: palette.INFO },
          markLine: {
            silent: true,
            symbol: "none",
            data: [{ yAxis: 1, name: "1.0" }],
            lineStyle: { color: palette.BORDER, width: 1, type: "dashed" as const },
            label: { show: true, formatter: "1.0", color, fontSize: 10 },
          },
        },
        guideSeries(color, marks()),
      ],
    };
  });

  const lastPcr = createMemo(() => pcr().at(-1)?.value ?? null);

  return (
    <Box className="flex min-h-0 flex-1 flex-col max-sm:flex-none" data-testid="pillar-positioning">
      <Box className="flex h-[20px] shrink-0 items-center px-1.5" data-testid="positioning-caption">
        <span class={PILLAR_CAPTION_CLASS}>
          Positioning · OI, OI flow, max pain &amp; PCR · {caption()}
        </span>
      </Box>
      <ExpiryChips
        options={options()}
        selectedExpiry={props.selectedExpiry}
        onExpiry={props.onExpiry}
        testId="positioning-expiry"
      />
      <Box className={pillarGridClass(2)} data-testid="positioning-chart-grid">
        <ChartFrame
          testId="oi-strike-chart"
          label={`Call and put open interest by strike for ${caption()}`}
          description="Mirrored call and put open-interest bars by strike, with spot and wall markers."
          option={oiOption()}
          optionKey={`oi|${caption()}|${oi().map((r) => `${r.strike}:${r.ce}:${r.pe}`).join(",")}`}
          empty={oi().length === 0}
          emptyText={REASON.noQuotes}
        />
        <ChartFrame
          testId="doi-volume-chart"
          label={`Change in open interest and volume by strike for ${caption()}`}
          description="Change in call and put open interest as mirrored bars with traded volume overlaid."
          option={flowOption()}
          optionKey={`flow|${deltaOi().length}|${volume().length}`}
          empty={deltaOi().length === 0 && volume().length === 0}
          emptyText={REASON.noPositioning}
        />
        <ChartFrame
          testId="max-pain-chart"
          label={`Open-interest payout curve and max pain for ${caption()}`}
          description="Total option payout at expiry for each strike; its minimum is the max-pain strike."
          option={payoutOption()}
          optionKey={`payout|${payout().map((r) => `${r.strike}:${r.value}`).join(",")}`}
          empty={payout().length === 0}
          emptyText={REASON.noQuotes}
        />
        <ChartFrame
          testId="pcr-strike-chart"
          label={`Cumulative put-call ratio by strike for ${caption()}`}
          description="Cumulative put open interest divided by call open interest across the strike ladder."
          option={pcrOption()}
          optionKey={`pcr|${pcr().map((r) => `${r.strike}:${r.value}`).join(",")}`}
          empty={pcr().length === 0}
          emptyText={REASON.noQuotes}
        />
      </Box>
      <MetricBand
        testId="positioning-metrics"
        metrics={[
          { label: "CALL WALL", value: formatNumber(props.data.levels?.callWall, 0), testId: "pos-metric-cw", tone: "negative" },
          { label: "PUT WALL", value: formatNumber(props.data.levels?.putWall, 0), testId: "pos-metric-pw", tone: "positive" },
          { label: "MAX PAIN", value: formatNumber(props.data.levels?.maxPain, 0), testId: "pos-metric-mp", tone: "warning" },
          { label: "PCR", value: formatNumber(lastPcr(), 2), testId: "pos-metric-pcr" },
        ]}
      />
      <Box className="sr-only" data-testid="positioning-total-oi">
        {formatCompact(oi().reduce((sum, row) => sum + (row.ce ?? 0) + (row.pe ?? 0), 0))}
      </Box>
    </Box>
  );
}
