import { useEffect, useMemo } from "react";
import Box from "@mui/material/Box";
import type { ColumnDef } from "@tanstack/react-table";
import { Text } from "@/ui";
import { TanStackTable } from "@/components/common/TanStackTable";
import { CompactStat, CompactStatGrid } from "@/components/common/compact";
import { useECharts } from "@/hooks/useECharts";
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
    <Text span size="xs" sx={{ fontFamily: palette.MONO, color }}>
      {value}
    </Text>
  );
}

export function SimRuns({ strategy, view, asOf }: SimRunsProps) {
  const { chartRef, setChartOption } = useECharts({ isDark: true });
  const equity = view?.equity ?? [];

  useEffect(() => {
    if (equity.length === 0) return;
    void setChartOption({
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
        data: equity.map((point) => fmtTime(point.t)),
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
          data: equity.map((point) => point.pnl),
          markLine: {
            symbol: "none",
            data: [{ yAxis: 0, lineStyle: { color: palette.CHART_MUTED, type: "dashed" } }],
          },
        },
      ],
    });
  }, [equity]);

  const columns = useMemo<ColumnDef<SimTrade>[]>(() => {
    const columnsDef: ColumnDef<SimTrade>[] = [
      {
        header: "Entry",
        accessorKey: "entryTime",
        size: 64,
        meta: { align: "left" },
        cell: (info) => <Num value={fmtTime(String(info.getValue() ?? ""))} />,
      },
      {
        header: "Exit",
        accessorKey: "exitTime",
        size: 64,
        meta: { align: "left" },
        cell: (info) => {
          const trade = info.row.original;
          const open = isOpenTrade(trade, asOf) || !trade.exitTime;
          return (
            <Text
              span
              size="xs"
              fw={open ? 700 : 400}
              sx={{ fontFamily: palette.MONO, color: open ? palette.TERM_FLIP : palette.TEXT }}
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
        cell: (info) => (
          <Text span size="xs" sx={{ minWidth: 0 }} title={structureText(info.row.original)}>
            {structureText(info.row.original)}
          </Text>
        ),
      },
      {
        header: "Lots",
        accessorKey: "lots",
        size: 46,
        meta: { align: "right" },
        cell: (info) => <Num value={formatNumberIN(Number(info.getValue()) || 0)} />,
      },
      {
        header: "Entry ₹",
        accessorKey: "entryPremium",
        size: 76,
        meta: { align: "right" },
        cell: (info) => <Num value={fmtInr(Number(info.getValue()))} />,
      },
      {
        header: "Exit ₹",
        accessorKey: "exitPremium",
        size: 76,
        meta: { align: "right" },
        cell: (info) => <Num value={fmtInr(Number(info.getValue()))} />,
      },
      {
        header: "Gross",
        accessorKey: "grossPnl",
        size: 84,
        meta: { align: "right" },
        cell: (info) => {
          const value = Number(info.getValue()) || 0;
          return <Num value={fmtSignedInr(value)} color={toneColor(value)} />;
        },
      },
      {
        header: "Costs",
        accessorKey: "costs",
        size: 70,
        meta: { align: "right" },
        cell: (info) => <Num value={fmtInr(Number(info.getValue()))} />,
      },
      {
        header: "Net",
        accessorKey: "netPnl",
        size: 86,
        meta: { align: "right" },
        cell: (info) => {
          const value = Number(info.getValue()) || 0;
          return <Num value={fmtSignedInr(value)} color={toneColor(value)} />;
        },
      },
      {
        header: "Pts",
        accessorKey: "points",
        size: 72,
        meta: { align: "right" },
        cell: (info) => <Num value={fmtPoints(Number(info.getValue()))} />,
      },
      {
        header: "Reason",
        accessorKey: "exitReason",
        size: 96,
        meta: { align: "center" },
        cell: (info) => {
          const reason = String(info.getValue() ?? "");
          return (
            <Text span size="xs" c="dimmed" sx={{ whiteSpace: "normal" }}>
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
        cell: (info) => {
          const value = Number(info.getValue());
          return <Num value={Number.isFinite(value) ? `${Math.round(value)}m` : "—"} />;
        },
      },
    ];
    return columnsDef;
  }, [asOf]);

  const trades = view?.trades ?? [];
  const stats = view?.stats ?? strategy?.stats;

  return (
    <Box
      data-testid="sim-runs"
      sx={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}
    >
      <CompactStatGrid cols={5} spacing={4}>
        <CompactStat dense label="Trades" value={Number.isFinite(stats?.trades) ? String(stats?.trades) : "—"} />
        <CompactStat
          dense
          label="Win rate"
          value={
            Number.isFinite(stats?.winRate)
              ? formatPercentage(stats!.winRate, 2, false)
              : "—"
          }
        />
        <CompactStat
          dense
          label="PF"
          value={
            stats && Number.isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : "—"
          }
        />
        <CompactStat
          dense
          label="Avg hold"
          value={
            stats && Number.isFinite(stats.avgHoldMin)
              ? `${Math.round(stats.avgHoldMin)}m`
              : "—"
          }
        />
        <CompactStat dense label="Max DD" value={fmtInr(stats?.maxDrawdown)} tone="negative" />
      </CompactStatGrid>

      <Box
        sx={{
          border: `1px solid ${palette.BORDER}`,
          borderRadius: 1,
          minWidth: 0,
          overflow: "hidden",
        }}
      >
        {equity.length === 0 ? (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: 120 }}>
            <Text size="xs" c="dimmed">
              No equity curve yet — run the desk
            </Text>
          </Box>
        ) : (
          <Box ref={chartRef} data-testid="sim-equity-chart" sx={{ height: 180, width: "100%" }} />
        )}
      </Box>

      <Box
        sx={{
          minWidth: 0,
          "& .paper-tanstack-container": {
            bgcolor: `${palette.TERM_BG} !important`,
            border: "none !important",
          },
          "& .paper-tanstack-scroll, & .paper-tanstack-table": {
            bgcolor: `${palette.TERM_BG} !important`,
          },
          "& .sim-row-win .paper-tanstack-cell": {
            bgcolor: `${palette.TINT_POSITIVE} !important`,
          },
          "& .sim-row-loss .paper-tanstack-cell": {
            bgcolor: `${palette.TINT_NEGATIVE} !important`,
          },
        }}
      >
        <TanStackTable<SimTrade>
          data={trades}
          columns={columns}
          dataTestId="sim-trades-table"
          emptyMessage="No trades — run the desk"
          enableSorting={false}
          stickyHeader
          dense
          minTableWidth={980}
          getRowClassName={(trade) => (trade.netPnl >= 0 ? "sim-row-win" : "sim-row-loss")}
        />
      </Box>
    </Box>
  );
}

export default SimRuns;
