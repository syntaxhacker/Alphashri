import { createEffect, createMemo, Show, type CSSProperties } from "solid-js";
import { Text } from "@/ui";
import { TanStackTable, type TableColumnDef } from "@/components/common/TanStackTable";
import { CompactStat, CompactStatGrid } from "@/components/common/compact";
import { createECharts } from "../echartsSolid";
import * as palette from "@/ui/palette";
import { formatNumberIN, formatPercentage } from "@/utils/ui-helpers";
import type { SimStrategyResult, SimTrade } from "@/types/reportSim";
import { fmtInr, fmtPoints, fmtSignedInr, fmtTime, toneFor } from "./simFormat";
import type { StrategyView } from "./simView";
import { isOpenTrade } from "./simView";

interface SimRunsProps {
  strategy: SimStrategyResult | null;
  view: StrategyView | null;
  asOf: string | null;
}

function toneColor(value: number): string {
  const tone = toneFor(value);
  return tone === "positive" ? palette.POSITIVE : tone === "negative" ? palette.NEGATIVE : palette.TEXT_MUTED;
}

function structureText(trade: SimTrade): string {
  if (trade.legs.length === 0) return "—";
  return trade.legs
    .map((leg) => `${leg.action} ${leg.opt} ${formatNumberIN(leg.strike)}`)
    .join(" / ");
}

function Num({ value, color }: { value: string; color?: string }) {
  return (
    <Text span size="xs" style={{ fontFamily: palette.MONO, color }}>
      {value}
    </Text>
  );
}

export function SimRuns(props: SimRunsProps) {
  const strategy = () => props.strategy;
  const view = () => props.view;
  const asOf = () => props.asOf;
  const chart = createECharts();
  const equity = createMemo(() => view()?.equity ?? []);

  createEffect(() => {
    const points = equity();
    if (points.length === 0) return;
    void chart.setChartOption({
      animation: false,
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        formatter: (params: unknown) => {
          const point = Array.isArray(params) ? params[0] : params;
          const value = (point as { value?: number; axisValue?: string }) ?? {};
          if (value.value == null) return "";
          return `${value.axisValue ?? ""}<br/>P&amp;L ${fmtSignedInr(Number(value.value))}`;
        },
      },
      grid: { left: 8, right: 8, top: 10, bottom: 18, containLabel: true },
      xAxis: {
        type: "category",
        data: points.map((point) => fmtTime(point.t)),
        axisLabel: { color: palette.CHART_MUTED, fontSize: 9, hideOverlap: true },
        axisLine: { lineStyle: { color: palette.AXIS_LINE } },
      },
      yAxis: {
        type: "value",
        scale: true,
        axisLabel: { color: palette.CHART_MUTED, fontSize: 9 },
        axisLine: { lineStyle: { color: palette.AXIS_LINE } },
        splitLine: { lineStyle: { color: palette.AXIS_SPLIT } },
      },
      series: [
        {
          type: "line",
          showSymbol: false,
          lineStyle: { color: palette.PRIMARY, width: 2 },
          itemStyle: { color: palette.PRIMARY },
          areaStyle: { color: palette.ORB_AREA },
          data: points.map((point) => point.pnl),
          markLine: {
            symbol: "none",
            data: [{ yAxis: 0, lineStyle: { color: palette.CHART_MUTED, type: "dashed" } }],
          },
        },
      ],
    });
  });

  const columns = createMemo<TableColumnDef<SimTrade>[]>(() => {
    const columnsDef: TableColumnDef<SimTrade>[] = [
      {
        header: "Entry",
        accessorKey: "entryTime",
        size: 64,
        meta: { align: "left" },
        cell: ({ row }) => <Num value={fmtTime(String(row.original.entryTime ?? ""))} />,
      },
      {
        header: "Exit",
        accessorKey: "exitTime",
        size: 64,
        meta: { align: "left" },
        cell: ({ row }) => {
          const trade = row.original;
          const open = isOpenTrade(trade, asOf()) || !trade.exitTime;
          return (
            <Text
              span
              size="xs"
              fw={open ? 700 : 400}
              style={{ fontFamily: palette.MONO, color: open ? palette.TERM_FLIP : palette.TEXT }}
            >
              {open ? "OPEN" : fmtTime(trade.exitTime)}
            </Text>
          );
        },
      },
      {
        header: "Structure",
        id: "structure",
        size: 168,
        meta: { align: "left" },
        cell: ({ row }) => (
          <Text span size="xs" style={{ minWidth: 0 }} title={structureText(row.original)}>
            {structureText(row.original)}
          </Text>
        ),
      },
      {
        header: "Lots",
        accessorKey: "lots",
        size: 46,
        meta: { align: "right" },
        cell: ({ row }) => <Num value={formatNumberIN(Number(row.original.lots) || 0)} />,
      },
      {
        header: "Entry ₹",
        accessorKey: "entryPremium",
        size: 76,
        meta: { align: "right" },
        cell: ({ row }) => <Num value={fmtInr(Number(row.original.entryPremium))} />,
      },
      {
        header: "Exit ₹",
        accessorKey: "exitPremium",
        size: 76,
        meta: { align: "right" },
        cell: ({ row }) => <Num value={fmtInr(Number(row.original.entryPremium))} />,
      },
      {
        header: "Gross",
        accessorKey: "grossPnl",
        size: 84,
        meta: { align: "right" },
        cell: ({ row }) => {
          const value = Number(row.original.grossPnl) || 0;
          return <Num value={fmtSignedInr(value)} color={toneColor(value)} />;
        },
      },
      {
        header: "Costs",
        accessorKey: "costs",
        size: 70,
        meta: { align: "right" },
        cell: ({ row }) => <Num value={fmtInr(Number(row.original.entryPremium))} />,
      },
      {
        header: "Net",
        accessorKey: "netPnl",
        size: 86,
        meta: { align: "right" },
        cell: ({ row }) => {
          const value = Number(row.original.netPnl) || 0;
          return <Num value={fmtSignedInr(value)} color={toneColor(value)} />;
        },
      },
      {
        header: "Pts",
        accessorKey: "points",
        size: 72,
        meta: { align: "right" },
        cell: ({ row }) => <Num value={fmtPoints(Number(row.original.points))} />,
      },
      {
        header: "Reason",
        accessorKey: "exitReason",
        size: 96,
        meta: { align: "center" },
        cell: ({ row }) => {
          const reason = String(row.original.exitReason ?? "");
          return (
            <Text span size="xs" c="dimmed" style={{ whiteSpace: "normal" }}>
              {reason || "—"}
            </Text>
          );
        },
      },
      {
        header: "Hold",
        accessorKey: "holdMin",
        size: 54,
        meta: { align: "right" },
        cell: ({ row }) => {
          const value = Number(row.original.holdMin);
          return <Num value={Number.isFinite(value) ? `${Math.round(value)}m` : "—"} />;
        },
      },
    ];
    return columnsDef;
  });

  const trades = () => view()?.trades ?? [];
  const stats = () => view()?.stats ?? strategy()?.stats;

  return (
    <div data-testid="sim-runs" className="flex flex-col gap-1 min-w-0">
      <CompactStatGrid cols={5} spacing={4}>
        <CompactStat dense label="Trades" value={Number.isFinite(stats()?.trades) ? String(stats()?.trades) : "—"} />
        <CompactStat
          dense
          label="Win rate"
          value={
            Number.isFinite(stats()?.winRate)
              ? formatPercentage(stats()!.winRate, 2, false)
              : "—"
          }
        />
        <CompactStat
          dense
          label="PF"
          value={
            stats() && Number.isFinite(stats()!.profitFactor) ? stats()!.profitFactor.toFixed(2) : "—"
          }
        />
        <CompactStat
          dense
          label="Avg hold"
          value={
            stats() && Number.isFinite(stats()!.avgHoldMin)
              ? `${Math.round(stats()!.avgHoldMin)}m`
              : "—"
          }
        />
        <CompactStat dense label="Max DD" value={fmtInr(stats()?.maxDrawdown)} tone="negative" />
      </CompactStatGrid>

      <div
        className="border border-fin-border rounded-fin min-w-0 overflow-hidden"
      >
        <Show
          when={equity().length === 0}
          fallback={
            <div ref={chart.ref} data-testid="sim-equity-chart" class="h-[180px] w-full" />
          }
        >
          <div class="flex items-center justify-center h-[120px]">
            <Text size="xs" c="dimmed">
              No equity curve yet — run the desk
            </Text>
          </div>
        </Show>
      </div>

      {/* The TanStackTable shared component renders its own bordered paper
        container; theme it to the desk surface via descendant selectors. */}
      <div
        class="min-w-0 [&_.paper-tanstack-container]:[background:var(--desk-bg)]! [&_.paper-tanstack-container]:[border:none]! [&_.paper-tanstack-scroll]:[background:var(--desk-bg)]! [&_.paper-tanstack-table]:[background:var(--desk-bg)]! [&_.sim-row-win_.paper-tanstack-cell]:[background:var(--tint-pos)]! [&_.sim-row-loss_.paper-tanstack-cell]:[background:var(--tint-neg)]!"
        style={{ "--desk-bg": palette.TERM_BG, "--tint-pos": palette.TINT_POSITIVE, "--tint-neg": palette.TINT_NEGATIVE } as CSSProperties}
      >
        <TanStackTable<SimTrade>
          data={trades()}
          columns={columns()}
          dataTestId="sim-trades-table"
          emptyMessage="No trades — run the desk"
          enableSorting={false}
          stickyHeader
          dense
          minTableWidth={980}
          getRowClassName={(trade) => (trade.netPnl >= 0 ? "sim-row-win" : "sim-row-loss")}
        />
      </div>
    </div>
  );
}

export default SimRuns;
