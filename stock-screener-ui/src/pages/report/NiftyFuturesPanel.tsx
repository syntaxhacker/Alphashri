import { Show, createEffect, createMemo } from "solid-js";
import { Box, Text } from "@/ui";
import * as palette from "@/ui/palette";
import { CompactPanel, CompactStat, CompactStatGrid } from "@/components/common/compact";
import type { NiftyFutures, NiftyFuturesRegime } from "@/types/niftyReport";
import { createECharts } from "./echartsSolid";
import { formatReportCompact, formatReportFixed } from "./reportFormat";

const REGIME_LABEL: Record<NiftyFuturesRegime, string> = {
  long_buildup: "LONG BUILDUP",
  short_buildup: "SHORT BUILDUP",
  long_unwinding: "LONG UNWINDING",
  short_covering: "SHORT COVERING",
  neutral: "NEUTRAL",
};

const REGIME_TONE: Record<NiftyFuturesRegime, string> = {
  long_buildup: palette.POSITIVE,
  short_buildup: palette.NEGATIVE,
  long_unwinding: palette.NEGATIVE,
  short_covering: palette.POSITIVE,
  neutral: palette.TEXT_MUTED,
};

const REGIME_NOTE: Record<NiftyFuturesRegime, string> = {
  long_buildup: "price up + OI up — fresh longs",
  short_buildup: "price down + OI up — fresh shorts",
  long_unwinding: "price down + OI down — longs exiting",
  short_covering: "price up + OI down — shorts exiting",
  neutral: "price and OI do not agree on a side",
};

export function regimeLabel(regime: NiftyFuturesRegime): string {
  return REGIME_LABEL[regime] ?? REGIME_LABEL.neutral;
}

export function regimeTone(regime: NiftyFuturesRegime): string {
  return REGIME_TONE[regime] ?? palette.TEXT_MUTED;
}

function clock(t: string): string {
  return t.length >= 16 ? t.slice(11, 16) : t;
}

function signed(value: number | null, digits = 0): string {
  return formatReportFixed(value, {
    digits,
    sign: "nonzero",
    minus: "−",
  });
}

/** Regime chip: the one label the panel exists to answer. */
function RegimeChip(props: { regime: NiftyFuturesRegime }) {
  const tone = () => regimeTone(props.regime);
  return (
    <span
      data-testid="nifty-futures-regime"
      title={`Futures regime — ${REGIME_NOTE[props.regime] ?? REGIME_NOTE.neutral}`}
      class="inline-flex items-center rounded-[3px] px-[5px] py-[1px] text-[9px] font-extrabold tracking-[0.06em] whitespace-nowrap"
      style={{
        color: tone(),
        "background-color": palette.alpha(tone(), 0.14),
        border: `1px solid ${palette.alpha(tone(), 0.5)}`,
      }}
    >
      {regimeLabel(props.regime)}
    </span>
  );
}

/**
 * Front-month futures price vs OI. The cash index cannot distinguish a move
 * on new positions from one on unwinding; the two lines on one time axis can.
 */
export function NiftyFuturesPanel(props: {
  futures: NiftyFutures | null;
  height?: number;
}) {
  const futures = () => props.futures;
  const height = () => props.height ?? 190;
  const chart = createECharts();

  const points = createMemo(() =>
    (futures()?.series ?? [])
      .filter((point) => Number.isFinite(point.close) && point.close > 0)
      .slice(-240),
  );

  const last = () => points()[points().length - 1] ?? null;

  createEffect(() => {
    const rows = points();
    if (rows.length === 0) return;
    const closes = rows.map((row) => row.close);
    const ois = rows.map((row) => row.oi);
    const oiLabels = ois.map((oi) => formatReportCompact(oi, { round: true }));
    void chart.setChartOption({
      animation: false,
      "background-color": "transparent",
      tooltip: {
        trigger: "axis",
        "background-color": palette.TOOLTIP_BG,
        borderColor: palette.TOOLTIP_BORDER,
        textStyle: { color: palette.TOOLTIP_TEXT, "font-size": "11px" },
        axisPointer: { type: "line", lineStyle: { color: palette.CHART_MUTED } },
        formatter: (params: unknown) => {
          const list = Array.isArray(params) ? params : [params];
          const index = (list[0] as { dataIndex?: number } | undefined)?.dataIndex ?? 0;
          const row = rows[index];
          if (!row) return "";
          return [
            clock(row.t),
            `Fut ${row.close.toFixed(2)}`,
            `OI ${oiLabels[index]}`,
          ].join("<br/>");
        },
      },
      grid: { left: 2, right: 2, top: 8, bottom: 2, containLabel: true },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: rows.map((row) => clock(row.t)),
        axisTick: { show: false },
        axisLine: { lineStyle: { color: palette.AXIS_LINE } },
        axisLabel: {
          color: palette.CHART_MUTED,
          "font-size": "10px",
          hideOverlap: true,
          interval: Math.max(0, Math.ceil(rows.length / 6) - 1),
        },
      },
      yAxis: [
        {
          type: "value",
          scale: true,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: {
            color: palette.TEXT_MUTED,
            "font-size": "10px",
            formatter: (value: number) => formatReportCompact(value, { round: true }),
          },
          splitLine: { lineStyle: { color: palette.AXIS_SPLIT } },
        },
        {
          type: "value",
          scale: true,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: {
            color: palette.TERM_CE,
            "font-size": "10px",
            formatter: (value: number) => formatReportCompact(value, { round: true }),
          },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: "close",
          type: "line",
          showSymbol: false,
          silent: true,
          lineStyle: { color: palette.PRIMARY, width: 1.4 },
          itemStyle: { color: palette.PRIMARY },
          data: closes,
        },
        {
          name: "oi",
          type: "line",
          showSymbol: false,
          silent: true,
          yAxisIndex: 1,
          lineStyle: { color: palette.TERM_CE, width: 1.2, type: "dashed" },
          itemStyle: { color: palette.TERM_CE },
          data: ois,
        },
      ],
    });
  });

  return (
    <CompactPanel
      title="Futures · positioning"
      testId="nifty-futures-panel"
      action={futures() ? <RegimeChip regime={futures()!.regime} /> : undefined}
      style={{ "min-width": 0 }}
    >
      <Show
        when={points().length > 0}
        fallback={
          <Box
            data-testid="nifty-futures-empty"
            class="flex flex-col items-center justify-center gap-[2px] py-6 px-2 text-center min-w-0"
          >
            <Text size="xs" fw={700}>
              {futures() ? "Futures feed connected — no bars yet" : "Futures positioning unavailable"}
            </Text>
            <Text size="xs" c="dimmed">
              Price and OI resume when the front-month recorder prints its first minute.
            </Text>
          </Box>
        }
      >
        <Box class="flex flex-col min-w-0" style={{ gap: "4px" }}>
          <CompactStatGrid cols={3}>
            <CompactStat
              dense
              data-testid="nifty-futures-change"
              label="15m Δ pts"
              value={signed(futures()?.change_pts ?? null, 2)}
              tone={
                (futures()?.change_pts ?? 0) > 0
                  ? palette.POSITIVE
                  : (futures()?.change_pts ?? 0) < 0
                    ? palette.NEGATIVE
                    : palette.TEXT_MUTED
              }
            />
            <CompactStat
              dense
              data-testid="nifty-futures-oi"
              label="15m Δ OI"
              value={formatReportCompact(futures()?.oi_change ?? null, {
                sign: "nonzero",
                round: true,
              })}
              tone={
                (futures()?.oi_change ?? 0) > 0 ? palette.TERM_CE : palette.TEXT_MUTED
              }
            />
            <CompactStat
              dense
              data-testid="nifty-futures-last"
              label="Last / OI"
              value={last() ? last()!.close.toFixed(2) : "—"}
              hint={
                last()
                  ? `OI ${formatReportCompact(last()!.oi, { round: true })} · ${clock(last()!.t)}`
                  : "—"
              }
            />
          </CompactStatGrid>

          <Box
            data-testid="nifty-futures-key"
            class="flex items-center gap-2 px-[2px] text-[10px] tracking-[0.04em]"
          >
            <span class="inline-flex items-center gap-[4px]" style={{ color: palette.TEXT_MUTED }}>
              <span
                aria-hidden
                style={{
                  width: "10px",
                  height: "2px",
                  "background-color": palette.PRIMARY,
                }}
              />
              FUT CLOSE
            </span>
            <span class="inline-flex items-center gap-[4px]" style={{ color: palette.TEXT_MUTED }}>
              <span
                aria-hidden
                style={{
                  width: "10px",
                  height: "2px",
                  "background-color": palette.TERM_CE,
                }}
              />
              OPEN INTEREST
            </span>
            <Show when={futures()?.expiry}>
              <span class="ml-auto" style={{ color: palette.TEXT_MUTED }}>
                {futures()!.expiry}
                {futures()?.as_of ? ` · ${clock(futures()!.as_of!)}` : ""}
              </span>
            </Show>
          </Box>

          <Box
            ref={chart.ref}
            data-testid="nifty-futures-chart"
            class="w-full min-w-0"
            style={{ height: `${height()}px` }}
          />
        </Box>
      </Show>
    </CompactPanel>
  );
}
