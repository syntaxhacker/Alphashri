import { For, Show, createEffect, createMemo } from "solid-js";
import { Box, Text } from "@/ui";
import * as palette from "@/ui/palette";
import { CompactPanel, CompactStat, CompactStatGrid } from "@/components/common/compact";
import type { NiftyItmPeFlow, NiftyItmPeFlowPoint, NiftyItmPeStrike } from "@/types/niftyReport";
import { createECharts } from "./echartsSolid";
import {
  formatReportCompact,
  formatReportNum,
  formatReportPct,
  formatReportPoints,
} from "./reportFormat";
import { REPORT_FONT } from "./reportTokens";

const TOP_STRIKES = 5;

function clock(t: string): string {
  return t.length >= 16 ? t.slice(11, 16) : t;
}

export function itmShareOf(point: NiftyItmPeFlowPoint): number {
  if (Number.isFinite(point.share_pct)) return point.share_pct;
  return point.total_pe_vol > 0 ? (point.itm_pe_vol / point.total_pe_vol) * 100 : 0;
}

export function sessionShare(series: NiftyItmPeFlowPoint[]): number {
  let itm = 0;
  let total = 0;
  for (const point of series) {
    itm += point.itm_pe_vol;
    total += point.total_pe_vol;
  }
  return total > 0 ? (itm / total) * 100 : 0;
}

/**
 * Content key for the minute series and the top-strike list. Both are rebuilt
 * from a normalized report on every live frame, so identity changes on ticks
 * whose ITM flow did not move. `as_of` is intentionally excluded: this panel
 * never paints it, so a newer stamp over unchanged series paints the same
 * values and must not rebuild the chart.
 */
export function itmFlowSignature(flow: NiftyItmPeFlow | null): string {
  if (!flow) return "null";
  const series = flow.series ?? [];
  const top = flow.top ?? [];
  const seriesKey: string[] = [];
  for (const p of series) {
    seriesKey.push(`${p.t}|${p.itm_pe_vol}|${p.total_pe_vol}|${p.share_pct}|${p.spot}`);
  }
  const topKey: string[] = [];
  for (const row of top) {
    topKey.push(`${row.strike}|${row.volume}|${row.oi}`);
  }
  return `${seriesKey.join(";")}#${topKey.join(";")}`;
}

export function NiftyItmPeFlowPanel(props: {
  flow: NiftyItmPeFlow | null;
  spot: number;
  height?: number;
}) {
  const flow = () => props.flow;
  const height = () => props.height ?? 190;
  const chart = createECharts();

  // The report arrives as a fresh object each live frame even when its ITM
  // minute series is unchanged. Key both derivations on content: a signature
  // refresh updates the payload cache, but the memos (and the chart-option
  // effect that reads them) only re-run when the displayed data actually moved.
  let flowForSig = flow();
  const flowSig = createMemo(() => {
    flowForSig = flow();
    return itmFlowSignature(flowForSig);
  });
  const points = createMemo<NiftyItmPeFlowPoint[]>(() => {
    flowSig();
    return (flowForSig?.series ?? [])
      .filter((point) => Number.isFinite(point.itm_pe_vol))
      .slice(-240);
  });
  const top = createMemo<NiftyItmPeStrike[]>(() => {
    flowSig();
    return [...(flowForSig?.top ?? [])]
      .filter((row) => row.strike > 0)
      .sort((a, b) => b.volume - a.volume)
      .slice(0, TOP_STRIKES);
  });
  const topMax = createMemo(() => top().reduce((max, row) => Math.max(max, row.volume), 0));
  const last = () => points()[points().length - 1] ?? null;
  const share = () => (last() ? itmShareOf(last()!) : sessionShare(points()));

  createEffect(() => {
    const rows = points();
    if (rows.length === 0) return;
    const shares = rows.map((row) => Math.min(100, Math.max(0, itmShareOf(row))));
    void chart.setChartOption({
      animation: false,
      "background-color": "transparent",
      tooltip: {
        trigger: "axis",
        "background-color": palette.TOOLTIP_BG,
        borderColor: palette.TOOLTIP_BORDER,
        textStyle: { color: palette.TOOLTIP_TEXT, "font-size": `${REPORT_FONT.micro}px` },
        axisPointer: { type: "shadow", shadowStyle: { color: palette.alpha(palette.TEXT, 0.06) } },
        formatter: (params: unknown) => {
          const list = Array.isArray(params) ? params : [params];
          const index = (list[0] as { dataIndex?: number } | undefined)?.dataIndex ?? 0;
          const row = rows[index];
          if (!row) return "";
          return [
            clock(row.t),
            `ITM PE ${formatReportCompact(row.itm_pe_vol, { round: true })}`,
            `Share ${formatReportPct(itmShareOf(row), { digits: 1, minus: "−" })}`,
            `Spot ${formatReportNum(row.spot, { round: true })}`,
          ].join("<br/>");
        },
      },
      grid: { left: 2, right: 2, top: 8, bottom: 2, containLabel: true },
      xAxis: {
        type: "category",
        data: rows.map((row) => clock(row.t)),
        axisTick: { show: false },
        axisLine: { lineStyle: { color: palette.AXIS_LINE } },
        axisLabel: {
          color: palette.CHART_MUTED,
          "font-size": `${REPORT_FONT.micro}px`,
          hideOverlap: true,
          interval: Math.max(0, Math.ceil(rows.length / 6) - 1),
        },
      },
      yAxis: [
        {
          type: "value",
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: {
            color: palette.TERM_PE,
            "font-size": `${REPORT_FONT.micro}px`,
            formatter: (value: number) => formatReportCompact(value, { round: true }),
          },
          splitLine: { lineStyle: { color: palette.AXIS_SPLIT } },
        },
        {
          type: "value",
          min: 0,
          max: 100,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: {
            color: palette.PRIMARY,
            "font-size": `${REPORT_FONT.micro}px`,
            formatter: (value: number) => `${Math.round(value)}%`,
          },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: "itm-pe-vol",
          type: "bar",
          silent: true,
          itemStyle: { color: palette.TERM_PE, opacity: 0.75 },
          data: rows.map((row) => row.itm_pe_vol),
        },
        {
          name: "share",
          type: "line",
          showSymbol: false,
          silent: true,
          yAxisIndex: 1,
          lineStyle: { color: palette.PRIMARY, width: 1.2 },
          itemStyle: { color: palette.PRIMARY },
          data: shares,
        },
      ],
    });
  });

  return (
    <CompactPanel
      title="ITM PE flow"
      testId="nifty-itm-pe-panel"
      action={
        points().length > 0 || top().length > 0 ? (
          <span
            data-testid="nifty-itm-pe-share"
            title="ITM put volume ÷ all put volume — where hedges and stop-outs printed"
            class="inline-flex items-center rounded-[3px] px-[5px] py-[1px] text-[12px] font-extrabold tracking-[0.06em] whitespace-nowrap tabular-nums"
            style={{
              color: palette.TERM_PE,
              "background-color": palette.alpha(palette.TERM_PE, 0.14),
              border: `1px solid ${palette.alpha(palette.TERM_PE, 0.5)}`,
            }}
          >
            {formatReportPct(share(), { digits: 1 })} ITM
          </span>
        ) : undefined
      }
      style={{ "min-width": 0 }}
    >
      <Show
        when={points().length > 0 || top().length > 0}
        fallback={
          <Box
            data-testid="nifty-itm-pe-empty"
            class="flex flex-col items-center justify-center gap-[2px] py-6 px-2 text-center min-w-0"
          >
            <Text size="xs" fw={700}>
              {flow() ? "ITM put flow — no bars yet" : "ITM put flow unavailable"}
            </Text>
            <Text size="xs" c="dimmed">
              Per-minute ITM put volume starts with the first recorded chain minute.
            </Text>
          </Box>
        }
      >
        <Box class="flex flex-col min-w-0" style={{ gap: "4px" }}>
          <CompactStatGrid cols={3}>
            <CompactStat
              dense
              data-testid="nifty-itm-pe-vol"
              label="ITM PE vol"
              value={formatReportCompact(last()?.itm_pe_vol ?? null, { round: true })}
              tone={palette.TERM_PE}
            />
            <CompactStat
              dense
              data-testid="nifty-itm-pe-total"
              label="Total PE vol"
              value={formatReportCompact(last()?.total_pe_vol ?? null, { round: true })}
            />
            <CompactStat
              dense
              data-testid="nifty-itm-pe-share-stat"
              label="Share"
              value={formatReportPct(share(), { digits: 1 })}
              hint={
                last()
                  ? `${clock(last()!.t)} · session ${formatReportPct(sessionShare(points()), { digits: 1 })}`
                  : "—"
              }
            />
          </CompactStatGrid>

          <Show when={points().length > 0}>
            <Box
              ref={chart.ref}
              data-testid="nifty-itm-pe-chart"
              class="w-full min-w-0"
              style={{ height: `${height()}px` }}
            />
          </Show>

          <Show when={top().length > 0}>
            <Box
              data-testid="nifty-itm-pe-top"
              class="flex flex-col min-w-0 border-t"
              style={{ "border-color": palette.BORDER }}
            >
              <div class="flex items-baseline justify-between pt-[3px] pb-[1px]">
                <Text
                  size="xs"
                  c="dimmed"
                  tt="uppercase"
                  fw={700}
                  style={{ "letter-spacing": "0.06em" }}
                >
                  Top ITM strikes
                </Text>
                <Text size="xs" c="dimmed">
                  vol · OI
                </Text>
              </div>
              <For each={top()}>
                {(row) => {
                  const ratio = () => (topMax() > 0 ? row.volume / topMax() : 0);
                  return (
                    <div
                      data-testid={`nifty-itm-pe-top-${row.strike}`}
                      title={`${formatReportNum(row.strike, { round: true })} PE · ${formatReportPoints(
                        row.strike - props.spot,
                      )} from spot`}
                      class="grid items-center tabular-nums min-w-0"
                      style={{
                        "grid-template-columns": "64px minmax(0,1fr) 62px 56px",
                        gap: "6px",
                        padding: "1px 0",
                      }}
                    >
                      <span
                        style={{ color: palette.TERM_PE, "font-weight": 700, "font-size": `${REPORT_FONT.micro}px` }}
                      >
                        {formatReportNum(row.strike, { round: true })}
                      </span>
                      <span
                        aria-hidden
                        class="min-w-0"
                        style={{
                          height: "4px",
                          "background-color": palette.alpha(palette.TERM_PE, 0.12),
                        }}
                      >
                        <span
                          style={{
                            display: "block",
                            height: "4px",
                            width: `${Math.max(2, ratio() * 100)}%`,
                            "background-color": palette.TERM_PE,
                            opacity: 0.35 + 0.65 * ratio(),
                          }}
                        />
                      </span>
                      <span
                        style={{ "text-align": "right", "font-size": `${REPORT_FONT.micro}px`, color: palette.TEXT }}
                      >
                        {formatReportCompact(row.volume, { round: true })}
                      </span>
                      <span
                        style={{
                          "text-align": "right",
                          "font-size": `${REPORT_FONT.micro}px`,
                          color: palette.TEXT_MUTED,
                        }}
                      >
                        {formatReportCompact(row.oi, { round: true })}
                      </span>
                    </div>
                  );
                }}
              </For>
            </Box>
          </Show>
        </Box>
      </Show>
    </CompactPanel>
  );
}
