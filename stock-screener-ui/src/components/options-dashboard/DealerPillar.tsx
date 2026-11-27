import { createMemo } from "solid-js";
import { Box } from "@/ui";
import * as palette from "@/ui/palette";
import { useChartInk } from "@/components/options-dock/analytics/chartInk";
import { axis, baseOption, CHART_GRID, guideSeries, legend, paddedDomain, tooltip, WALL_COLOR } from "./chartBase";
import {
  dealerAggregate,
  dealerSeries,
  expiryLabel,
  expiryFor,
  expiryOptions,
  thetaSeries,
  wallMarks,
} from "./dataRead";
import { ChartFrame, ExpiryChips, formatCompact, formatNumber, MetricBand, pillarGridClass, PILLAR_CAPTION_CLASS } from "./shared";
import { REASON, type PanelProps, type StrikeValue } from "./types";

function signedBars(rows: StrikeValue[]) {
  return rows.map((row) => ({
    value: [row.strike, row.value ?? 0],
    itemStyle: { color: (row.value ?? 0) >= 0 ? palette.POSITIVE : palette.NEGATIVE },
  }));
}

/** First strike where net gamma crosses from negative to positive (or back). */
function gammaFlip(rows: StrikeValue[]): number | null {
  for (let i = 1; i < rows.length; i += 1) {
    const prev = rows[i - 1].value ?? 0;
    const next = rows[i].value ?? 0;
    if (prev < 0 && next >= 0) return rows[i].strike;
  }
  return null;
}

/** Dealer pillar: gamma, delta, vanna/charm and theta-by-expiry profiles. */
export function DealerPillar(props: PanelProps) {
  const ink = useChartInk();
  const options = createMemo(() => expiryOptions(props.data));
  const expiry = createMemo(() => expiryFor(props.data, props.selectedExpiry));
  const caption = createMemo(() => expiryLabel(expiry()?.date, expiry()?.dte));

  const gex = createMemo(() => dealerSeries(props.data, "gex"));
  const dex = createMemo(() => dealerSeries(props.data, "dex"));
  const vanna = createMemo(() => dealerSeries(props.data, "vanna"));
  const charm = createMemo(() => dealerSeries(props.data, "charm"));
  const theta = createMemo(() => thetaSeries(props.data));
  const dealer = createMemo(() => dealerAggregate(props.data, props.selectedExpiry));

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

  const zeroLine = {
    silent: true,
    symbol: "none",
    data: [{ yAxis: 0, name: "ZERO" }],
    lineStyle: { color: palette.BORDER, width: 1, type: "solid" as const },
    label: { show: false },
  };

  const gexOption = createMemo(() => {
    const color = ink();
    const flip = gammaFlip(gex());
    return {
      ...baseOption(color),
      grid: CHART_GRID,
      tooltip: tooltip(),
      xAxis: axis(color, "Strike", paddedDomain(gex().map((row) => row.strike))),
      yAxis: axis(color, "Net gamma"),
      series: [
        {
          name: "GEX",
          type: "bar",
          barMaxWidth: 12,
          data: signedBars(gex()),
          markLine: zeroLine,
        },
        ...(flip != null
          ? [guideSeries(color, [{ xAxis: flip, name: "FLIP", color: palette.WARNING }])]
          : []),
      ],
    };
  });

  const dexOption = createMemo(() => {
    const color = ink();
    return {
      ...baseOption(color),
      grid: CHART_GRID,
      tooltip: tooltip(),
      xAxis: axis(color, "Strike", paddedDomain(dex().map((row) => row.strike))),
      yAxis: axis(color, "Net delta"),
      series: [
        {
          name: "DEX",
          type: "bar",
          barMaxWidth: 12,
          data: signedBars(dex()),
          markLine: zeroLine,
        },
        guideSeries(color, marks()),
      ],
    };
  });

  const vannaCharmOption = createMemo(() => {
    const color = ink();
    return {
      ...baseOption(color),
      grid: CHART_GRID,
      tooltip: tooltip(),
      legend: legend(color, ["Vanna", "Charm"]),
      xAxis: axis(
        color,
        "Strike",
        paddedDomain([...vanna().map((row) => row.strike), ...charm().map((row) => row.strike)]),
      ),
      yAxis: axis(color, "Greek exposure"),
      series: [
        {
          name: "Vanna",
          type: "line",
          smooth: true,
          showSymbol: false,
          data: vanna().map((row) => [row.strike, row.value]),
          lineStyle: { color: palette.SCALE_VIOLET[4], width: 1.5 },
          itemStyle: { color: palette.SCALE_VIOLET[4] },
        },
        {
          name: "Charm",
          type: "line",
          smooth: true,
          showSymbol: false,
          data: charm().map((row) => [row.strike, row.value]),
          lineStyle: { color: palette.SCALE_TEAL[4], width: 1.5 },
          itemStyle: { color: palette.SCALE_TEAL[4] },
        },
        guideSeries(color, marks()),
      ],
    };
  });

  const thetaOption = createMemo(() => {
    const color = ink();
    return {
      ...baseOption(color),
      grid: CHART_GRID,
      tooltip: tooltip(),
      xAxis: axis(color, "DTE"),
      // Theta sits in a narrow negative band; a zero origin flattened it to a
      // hairline at the bottom of the plot.
      yAxis: axis(color, "Theta / day", { scale: true }),
      series: [
        {
          name: "Theta",
          type: "line",
          smooth: true,
          showSymbol: true,
          symbolSize: 5,
          data: theta().map((row) => [row.dte, row.value]),
          lineStyle: { color: palette.WARNING, width: 2 },
          itemStyle: { color: palette.WARNING },
        },
      ],
    };
  });

  return (
    <Box className="flex min-h-0 flex-1 flex-col max-sm:flex-none" data-testid="pillar-dealer">
      <Box className="flex h-[20px] shrink-0 items-center px-1.5" data-testid="dealer-caption">
        <span class={PILLAR_CAPTION_CLASS}>
          Dealer · Gamma, delta, vanna / charm &amp; theta · {caption()}
        </span>
      </Box>
      <ExpiryChips
        options={options()}
        selectedExpiry={props.selectedExpiry}
        onExpiry={props.onExpiry}
        testId="dealer-expiry"
      />
      <Box className={pillarGridClass(2)} data-testid="dealer-chart-grid">
        <ChartFrame
          testId="gex-profile-chart"
          label={`Dealer gamma exposure profile for ${caption()}`}
          description="Net gamma by strike, coloured by sign, with a zero-gamma line and flip marker."
          option={gexOption()}
          optionKey={`gex|${gex().map((r) => `${r.strike}:${r.value}`).join(",")}`}
          empty={gex().length === 0}
          emptyText={REASON.noGamma}
        />
        <ChartFrame
          testId="dex-profile-chart"
          label={`Dealer delta exposure profile for ${caption()}`}
          description="Net delta by strike with a zero line and spot / wall markers."
          option={dexOption()}
          optionKey={`dex|${dex().map((r) => `${r.strike}:${r.value}`).join(",")}`}
          empty={dex().length === 0}
          emptyText={REASON.noDex}
        />
        <ChartFrame
          testId="vanna-charm-chart"
          label={`Dealer vanna and charm profiles for ${caption()}`}
          description="Vanna and charm exposure curves across strikes."
          option={vannaCharmOption()}
          optionKey={`vc|${vanna().length}|${charm().length}`}
          empty={vanna().length === 0 && charm().length === 0}
          emptyText={REASON.noVannaCharm}
        />
        <ChartFrame
          testId="theta-decay-chart"
          label="Theta decay by expiry and tenor"
          description="Daily theta decay plotted against days to expiry."
          option={thetaOption()}
          optionKey={`theta|${theta().map((r) => `${r.dte}:${r.value}`).join(",")}`}
          empty={theta().length === 0}
          emptyText={REASON.noTheta}
        />
      </Box>
      <MetricBand
        testId="dealer-metrics"
        metrics={[
          {
            label: "NET GEX",
            value: gex().length
              ? formatCompact(gex().reduce((sum, row) => sum + (row.value ?? 0), 0))
              : formatCompact(dealer()?.netGex),
            testId: "dealer-metric-gex",
          },
          {
            label: "GAMMA FLIP",
            value: formatNumber(gammaFlip(gex()) ?? dealer()?.gammaFlip, 0),
            testId: "dealer-metric-flip",
            tone: gammaFlip(gex()) != null || dealer()?.gammaFlip != null ? "warning" : undefined,
          },
          {
            label: "NET DEX",
            value: formatCompact(dex().reduce((sum, row) => sum + (row.value ?? 0), 0)),
            testId: "dealer-metric-dex",
          },
          {
            label: "THETA / DAY",
            value: formatCompact(theta()[0]?.value),
            testId: "dealer-metric-theta",
          },
        ]}
      />
    </Box>
  );
}
