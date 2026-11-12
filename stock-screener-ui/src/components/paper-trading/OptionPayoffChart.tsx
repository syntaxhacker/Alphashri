import { formatNumberIN } from "@/utils/ui-helpers";
import { useEffect, useMemo, useState } from "react";
import { ActionIcon, Badge, Card, Collapse, Text } from "@/ui";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import { useECharts } from "../../hooks/useECharts";
import {
  CHART_AVG_ENTRY,
  CHART_MUTED,
  NEGATIVE,
  POSITIVE,
  SURFACE,
  SURFACE_ALT,
} from "@/ui/palette";
import {
  computeTradePayoffSeries,
  optionBreakeven,
  parseOptionSymbol,
  type PayoffPoint,
} from "./optionTradeUtils";
import type { PaperTrade } from "../../types/paperTrading";

const CHART_HEIGHT = 210;

function fmtInr(value: number): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}\u20B9${formatNumberIN(Math.abs(value))}`;
}

function fmtK(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e5) return `${value < 0 ? "-" : ""}${(abs / 1e5).toFixed(1)}L`;
  if (abs >= 1e3) return `${value < 0 ? "-" : ""}${(abs / 1e3).toFixed(0)}k`;
  return String(Math.round(value));
}

export function OptionPayoffChart({
  series,
  strike,
  breakeven,
  underlying,
}: {
  series: PayoffPoint[];
  strike: number;
  breakeven: number | null;
  underlying: string;
}) {
  const { chartRef, setChartOption } = useECharts({ isDark: true });

  useEffect(() => {
    if (series.length === 0) return;
    const markLineData: Record<string, unknown>[] = [
      { yAxis: 0, lineStyle: { color: CHART_MUTED, width: 1, type: "solid" }, label: { show: false } },
      {
        xAxis: strike,
        lineStyle: { color: CHART_AVG_ENTRY, width: 1, type: "dashed" },
        label: { formatter: `K ${strike}`, color: CHART_AVG_ENTRY, "font-size": 10, position: "insideEndTop" },
      },
    ];
    if (breakeven != null) {
      markLineData.push({
        xAxis: breakeven,
        lineStyle: { color: CHART_MUTED, width: 1, type: "dotted" },
        label: { formatter: `BE ${Math.round(breakeven)}`, color: CHART_MUTED, "font-size": 10, position: "insideEndTop" },
      });
    }
    void setChartOption({
      animation: false,
      "background-color": SURFACE,
      tooltip: {
        trigger: "axis",
        "background-color": SURFACE_ALT,
        "border-color": CHART_MUTED,
        textStyle: { color: "#E6EDF3", "font-size": 11 },
        formatter: (params: unknown) => {
          const p = Array.isArray(params) ? params[0] : params;
          const v = (p as { value?: [number, number] } | undefined)?.value;
          if (!v) return "";
          return `${underlying} ${Number(v[0]).toFixed(0)}<br/><b>P&L ${fmtInr(Number(v[1]))}</b>`;
        },
      },
      grid: { left: 58, right: 18, top: 14, bottom: 26 },
      xAxis: {
        type: "value",
        scale: true,
        axisLine: { lineStyle: { color: SURFACE_ALT } },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: {
          color: CHART_MUTED,
          "font-size": 10,
          hideOverlap: true,
          formatter: (v: number) => String(Math.round(v)),
        },
      },
      yAxis: {
        type: "value",
        scale: true,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: SURFACE_ALT, type: "dashed", opacity: 0.55 } },
        axisLabel: { color: CHART_MUTED, "font-size": 10, formatter: (v: number) => fmtK(v) },
      },
      series: [
        {
          type: "line",
          showSymbol: false,
          smooth: false,
          data: series.map((p) => [p.underlying, p.pnl]),
          lineStyle: { width: 2 },
          areaStyle: { opacity: 0.10 },
          visualMap: {
            show: false,
            dimension: 1,
            pieces: [
              { gt: 0, color: POSITIVE },
              { lte: 0, color: NEGATIVE },
            ],
          },
          markLine: { symbol: "none", silent: true, data: markLineData },
        },
      ],
    });
  }, [series, strike, breakeven, underlying, setChartOption]);

  if (series.length === 0) return null;
  return (
    <div
      ref={chartRef}
      className="option-payoff-chart w-full border border-fin-surface-alt rounded-sm overflow-hidden"
      data-testid="option-payoff-chart"
      style={{ height: CHART_HEIGHT }}
    />
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  return (
    <div className="flex flex-col min-w-0">
      <Text size="xs" c="dimmed" className="uppercase" style={{ "font-size": 9, "letter-spacing": 0.5 }}>
        {label}
      </Text>
      <Text
        size="xs"
        className="font-mono tabular-nums font-semibold"
        style={{
          color: tone === "pos" ? POSITIVE : tone === "neg" ? NEGATIVE : undefined,
        }}
      >
        {value}
      </Text>
    </div>
  );
}

/**
 * Collapsible payoff-at-expiry block for a single option trade.
 * Renders nothing (hidden) when the trade is not an option contract.
 */
export function OptionPayoffCard({ trade }: { trade: PaperTrade }) {
  const [open, setOpen] = useState(true);
  const contract = useMemo(() => parseOptionSymbol((trade.symbol || "").trim()), [trade]);
  const series = useMemo(() => computeTradePayoffSeries(trade), [trade]);

  if (!contract || !series || series.length === 0) return null;

  const isShort = (trade.side || "").toUpperCase() === "SELL";
  const breakeven = optionBreakeven(contract.optionType, contract.strike, trade.entry_price);
  const maxProfit = series.reduce((m, p) => Math.max(m, p.pnl), -Infinity);
  const maxLoss = series.reduce((m, p) => Math.min(m, p.pnl), Infinity);
  const net = Number.isFinite(trade.net_pnl) ? trade.net_pnl : null;

  return (
    <Card className="option-payoff-card flex-shrink-0 min-h-0" data-testid="option-payoff-card">
      <div className="p-1.5 flex flex-col gap-1">
        <div className="flex items-center gap-2 flex-wrap">
          <ActionIcon
            variant="subtle"
            color="secondary"
            size="sm"
            aria-label={open ? "Collapse payoff" : "Expand payoff"}
            onClick={() => setOpen((v) => !v)}
            data-testid="option-payoff-toggle"
          >
            {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          </ActionIcon>
          <Text size="xs" fw={700} className="uppercase" style={{ "letter-spacing": 0.7 }} c="dimmed">
            Payoff @ expiry
          </Text>
          <Badge size="xs" variant="filled" color={isShort ? "error" : "success"}>
            {isShort ? "SHORT" : "LONG"} {contract.optionType}
          </Badge>
          <div className="flex gap-4 ml-2 flex-wrap items-center">
            <Stat label="Underlying" value={contract.underlying} />
            <Stat label="Strike" value={formatNumberIN(contract.strike)} />
            <Stat label="Qty" value={String(trade.quantity)} />
            <Stat label="Entry" value={fmtInr(trade.entry_price)} />
            {breakeven != null && <Stat label="Breakeven" value={fmtInr(breakeven)} />}
            {net != null && <Stat label="Net" value={fmtInr(net)} tone={net >= 0 ? "pos" : "neg"} />}
          </div>
          <div className="ml-auto flex gap-4">
            <Stat label="Max win" value={fmtK(maxProfit)} tone="pos" />
            <Stat label="Max loss" value={fmtK(maxLoss)} tone="neg" />
          </div>
        </div>
        <Collapse in={open}>
          <OptionPayoffChart
            series={series}
            strike={contract.strike}
            breakeven={breakeven}
            underlying={contract.underlying}
          />
        </Collapse>
      </div>
    </Card>
  );
}
