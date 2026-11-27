import { createMemo } from "solid-js";
import { Box } from "@/ui";
import * as palette from "@/ui/palette";
import { useChartInk } from "@/components/options-dock/analytics/chartInk";
import { axis, baseOption, CHART_GRID, guideSeries, legend, tooltip, WALL_COLOR } from "./chartBase";
import {
  currentIvSeries,
  densitySeries,
  expiryLabel,
  expiryFor,
  expiryOptions,
  rvSeries,
  smileSeries,
  wallMarks,
} from "./dataRead";
import { ChartCaption, ChartFrame, ExpiryChips, formatNumber, MetricBand, pillarGridClass, PILLAR_CAPTION_CLASS } from "./shared";
import { REASON, type PanelProps } from "./types";

/**
 * Volatility pillar: IV smile/skew, ATM term structure, risk-neutral density
 * and an IV-vs-RV cone. The shipped DTO always carries IV; the realised-vol
 * history is additive, so the cone degrades to "current IV only" with a reason.
 */
export function VolatilityPillar(props: PanelProps) {
  const ink = useChartInk();
  const options = createMemo(() => expiryOptions(props.data));
  const expiry = createMemo(() => expiryFor(props.data, props.selectedExpiry));
  const caption = createMemo(() => expiryLabel(expiry()?.date, expiry()?.dte));

  const smile = createMemo(() => smileSeries(props.data, props.selectedExpiry));
  const term = createMemo(() => currentIvSeries(props.data));
  const density = createMemo(() => densitySeries(props.data, props.selectedExpiry));
  const rv = createMemo(() => rvSeries(props.data));

  const marks = createMemo(() => {
    const out = wallMarks(props.data.levels).map((wall) => ({
      xAxis: wall.strike,
      name: wall.label,
      color: WALL_COLOR[wall.label] ?? palette.INFO,
    }));
    if (typeof props.data.spot === "number" && Number.isFinite(props.data.spot)) {
      out.push({ xAxis: props.data.spot, name: "SPOT", color: palette.PRIMARY });
    }
    return out;
  });

  const smileOption = createMemo(() => {
    const color = ink();
    const series = smile();
    return {
      ...baseOption(color),
      grid: CHART_GRID,
      tooltip: tooltip(),
      legend: legend(color, ["CE IV", "PE IV"]),
      // Zoom to the quoted strike range: anchoring at zero squeezed the whole
      // smile into the right third of the plot.
      xAxis: axis(color, "Strike", { scale: true }),
      yAxis: axis(color, "IV %"),
      series: [
        {
          name: "CE IV",
          type: "line",
          showSymbol: true,
          symbolSize: 4,
          data: series.ce,
          lineStyle: { color: palette.OI_CALL, width: 1.5 },
          itemStyle: { color: palette.OI_CALL },
        },
        {
          name: "PE IV",
          type: "line",
          showSymbol: true,
          symbolSize: 4,
          data: series.pe,
          lineStyle: { color: palette.OI_PUT, width: 1.5 },
          itemStyle: { color: palette.OI_PUT },
        },
        guideSeries(color, marks()),
      ],
    };
  });

  const termOption = createMemo(() => {
    const color = ink();
    const points = term();
    const selectedDte = expiry()?.dte;
    const selectedMark =
      typeof selectedDte === "number" && Number.isFinite(selectedDte)
        ? guideSeries(color, [{ xAxis: selectedDte, name: "SEL", color: palette.PRIMARY }])
        : null;
    return {
      ...baseOption(color),
      grid: CHART_GRID,
      tooltip: tooltip(),
      xAxis: axis(color, "DTE"),
      // ATM IV is a tight band (30-35%); anchoring the axis at zero hid the
      // term structure in the top quarter of the plot.
      yAxis: axis(color, "ATM IV %", { scale: true }),
      series: [
        {
          name: "ATM IV",
          type: "line",
          smooth: true,
          showSymbol: true,
          symbolSize: 5,
          data: points,
          lineStyle: { color: palette.INFO, width: 2 },
          itemStyle: { color: palette.INFO },
          areaStyle: { color: palette.alpha(palette.INFO, 0.12) },
        },
        ...(selectedMark ? [selectedMark] : []),
      ],
    };
  });

  const densityOption = createMemo(() => {
    const color = ink();
    return {
      ...baseOption(color),
      grid: CHART_GRID,
      tooltip: tooltip(),
      xAxis: axis(color, "Spot at expiry", { scale: true }),
      yAxis: axis(color, "Probability"),
      series: [
        {
          name: "RND",
          type: "line",
          smooth: true,
          showSymbol: false,
          data: density(),
          lineStyle: { color: palette.PRIMARY, width: 2 },
          itemStyle: { color: palette.PRIMARY },
          areaStyle: { color: palette.alpha(palette.PRIMARY, 0.16) },
        },
      ],
    };
  });

  const coneOption = createMemo(() => {
    const color = ink();
    const rows = rv();
    return {
      ...baseOption(color),
      grid: CHART_GRID,
      tooltip: tooltip(),
      legend: legend(color, ["ATM IV", "RV", "RV p05", "RV p95"]),
      xAxis: axis(color, "DTE"),
      yAxis: axis(color, "Vol %"),
      series: [
        {
          name: "ATM IV",
          type: "line",
          showSymbol: true,
          symbolSize: 5,
          data: term(),
          lineStyle: { color: palette.INFO, width: 2 },
          itemStyle: { color: palette.INFO },
        },
        ...(rows.length
          ? [
              {
                name: "RV p05",
                type: "line",
                showSymbol: false,
                data: rows.map((row) => [row.dte, Number(((row.value ?? 0) * 0.85).toFixed(2))]),
                lineStyle: { color: palette.alpha(palette.POSITIVE, 0.7), width: 1, type: "dashed" },
                itemStyle: { color: palette.POSITIVE },
              },
              {
                name: "RV p95",
                type: "line",
                showSymbol: false,
                data: rows.map((row) => [row.dte, Number(((row.value ?? 0) * 1.15).toFixed(2))]),
                lineStyle: { color: palette.alpha(palette.NEGATIVE, 0.7), width: 1, type: "dashed" },
                itemStyle: { color: palette.NEGATIVE },
                areaStyle: { color: palette.alpha(palette.INFO, 0.08) },
              },
              {
                name: "RV",
                type: "line",
                showSymbol: true,
                symbolSize: 4,
                data: rows.map((row) => [row.dte, row.value]),
                lineStyle: { color: palette.PRIMARY, width: 1.5 },
                itemStyle: { color: palette.PRIMARY },
              },
            ]
          : []),
      ],
    };
  });

  const noSmile = createMemo(() => smile().ce.length === 0 && smile().pe.length === 0);
  const noRv = createMemo(() => rv().length === 0);
  const rvReason = createMemo(() => (noRv() ? REASON.noRv : null));

  return (
    <Box className="flex min-h-0 flex-1 flex-col max-sm:flex-none" data-testid="pillar-volatility">
      <Box className="flex h-[20px] shrink-0 items-center px-1.5" data-testid="volatility-caption">
        <span class={PILLAR_CAPTION_CLASS}>
          Volatility · IV smile, density &amp; IV vs RV · {caption()}
        </span>
      </Box>
      <ExpiryChips
        options={options()}
        selectedExpiry={props.selectedExpiry}
        onExpiry={props.onExpiry}
        testId="volatility-expiry"
      />
      <Box className={pillarGridClass(2)} data-testid="volatility-chart-grid">
        <ChartFrame
          testId="iv-smile-chart"
          label={`Implied volatility smile by strike for ${caption()}`}
          description="Call and put implied volatility plotted against strike, with spot and level markers."
          option={smileOption()}
          optionKey={`smile|${caption()}|${smile().ce.length}:${smile().pe.length}|${marks().map((m) => m.xAxis).join(",")}`}
          empty={noSmile()}
          emptyText={REASON.noQuotes}
        />
        <ChartFrame
          testId="term-structure-chart"
          label="At-the-money implied volatility term structure by days to expiry"
          description="ATM implied volatility across expiries; the selected expiry is marked."
          option={termOption()}
          optionKey={`term|${term().map((p) => p.join(":")).join(",")}|${expiry()?.dte ?? "x"}`}
          empty={term().length < 2}
          emptyText={REASON.noQuotes}
        />
        <ChartFrame
          testId="rnd-density-chart"
          label={`Risk-neutral probability density for ${caption()}`}
          description="Risk-neutral probability density over spot at expiry; the area integrates to one."
          option={densityOption()}
          optionKey={`rnd|${density().length}|${density().at(-1)?.join(":") ?? "x"}`}
          empty={density().length < 2}
          emptyText={REASON.noQuotes}
        />
        <ChartFrame
          testId="iv-rv-cone-chart"
          label="Implied volatility versus realised volatility cone"
          description="Current ATM implied volatility with realised-volatility percentile bands when available."
          option={coneOption()}
          optionKey={`cone|${term().length}|${rv().map((r) => `${r.dte}:${r.value}`).join(",")}`}
          empty={term().length === 0 && rv().length === 0}
          emptyText={REASON.noRv}
        />
      </Box>
      <ChartCaption
        text="IV is the market's pricing measure — not a forecast of realised moves"
        testId="volatility-caption-note"
        reason={rvReason()}
      />
      <MetricBand
        testId="volatility-metrics"
        metrics={[
          { label: "ATM IV", value: formatNumber(expiry()?.atmIv), testId: "vol-metric-atm" },
          {
            label: "25Δ RR",
            value: formatNumber(expiry()?.rr25, 2),
            testId: "vol-metric-rr",
            tone: typeof expiry()?.rr25 === "number" ? ((expiry()!.rr25 as number) >= 0 ? "positive" : "negative") : undefined,
          },
          { label: "FIT R²", value: formatNumber(expiry()?.fitR2, 2), testId: "vol-metric-r2" },
          {
            label: "RV BANDS",
            value: noRv() ? "n/a" : `${rv().length}`,
            testId: "vol-metric-rv",
            tone: noRv() ? "warning" : "info",
          },
        ]}
      />
    </Box>
  );
}
