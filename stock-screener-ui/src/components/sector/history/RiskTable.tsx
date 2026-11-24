import { createMemo } from "solid-js";
import { Text } from "@/ui";
import { TanStackTable, type TableColumnDef } from "../../common/TanStackTable";
import { formatPercentage } from "../../../utils/ui-helpers";
import type { SectorHistoryRisk, SectorHistorySeries } from "../../../types/sectorHistory";
import { MiniSparkline } from "./visuals/MiniSparkline";

interface RiskRow extends SectorHistoryRisk {
  spark: (number | null)[];
}

const DASH = "—";

export function RiskTable(props: { risk: SectorHistoryRisk[]; series: SectorHistorySeries[] }) {
  const rows = createMemo<RiskRow[]>(() => {
    const risk = Array.isArray(props.risk) ? props.risk : [];
    const series = Array.isArray(props.series) ? props.series : [];
    const sparks = new Map(series.map((item) => [item.name, item.monthly_returns]));
    return risk.map((item) => ({ ...item, spark: sparks.get(item.name) ?? [] }));
  });

  const riskColumns: TableColumnDef<RiskRow>[] = [
    {
      id: "sector",
      header: "Sector",
      accessorKey: "name",
      size: 160,
      meta: { align: "left" },
      cell: ({ row }) => (
        <Text className="text-ui-micro font-semibold whitespace-nowrap">{row.original.name}</Text>
      ),
    },
    {
      id: "max_drawdown",
      header: "Max DD",
      accessorKey: "max_drawdown",
      size: 76,
      meta: { align: "right" },
      cell: ({ row }) => {
        const value = row.original.max_drawdown;
        return (
          <Text
            c={value == null ? "dimmed" : value < 0 ? "error" : "default"}
            className="text-ui-micro font-mono tabular-nums"
          >
            {value == null ? DASH : formatPercentage(value, 1)}
          </Text>
        );
      },
    },
    {
      id: "current_drawdown",
      header: "Current DD",
      accessorKey: "current_drawdown",
      size: 88,
      meta: { align: "right" },
      cell: ({ row }) => {
        const value = row.original.current_drawdown;
        return (
          <Text
            c={value == null ? "dimmed" : value < 0 ? "error" : "default"}
            className="text-ui-micro font-mono tabular-nums"
          >
            {value == null
              ? DASH
              : value === 0
                ? formatPercentage(value, 1, false)
                : formatPercentage(value, 1)}
          </Text>
        );
      },
    },
    {
      id: "recovery_days",
      header: "Recovery days",
      accessorKey: "recovery_days",
      size: 96,
      meta: { align: "right" },
      cell: ({ row }) => {
        const value = row.original.recovery_days;
        return (
          <Text
            c={value == null ? "dimmed" : "default"}
            className="text-ui-micro font-mono tabular-nums"
          >
            {value == null ? DASH : `${value}d`}
          </Text>
        );
      },
    },
    {
      id: "sharpe",
      header: "Sharpe",
      accessorKey: "sharpe",
      size: 68,
      meta: { align: "right" },
      cell: ({ row }) => {
        const value = row.original.sharpe;
        return (
          <Text
            c={value == null ? "dimmed" : value >= 0 ? "success" : "error"}
            className="text-ui-micro font-mono tabular-nums"
          >
            {value == null ? DASH : value.toFixed(2)}
          </Text>
        );
      },
    },
    {
      id: "volatility",
      header: "Vol",
      accessorKey: "volatility",
      size: 68,
      meta: { align: "right" },
      cell: ({ row }) => {
        const value = row.original.volatility;
        return (
          <Text
            c={value == null ? "dimmed" : "default"}
            className="text-ui-micro font-mono tabular-nums"
          >
            {value == null ? DASH : formatPercentage(value, 1, false)}
          </Text>
        );
      },
    },
    {
      id: "spark",
      header: "Cumulative",
      size: 88,
      enableSorting: false,
      meta: { align: "center" },
      cell: ({ row }) => <MiniSparkline values={row.original.spark} />,
    },
  ];

  return (
    <TanStackTable<RiskRow>
      data={rows()}
      columns={riskColumns}
      dataTestId="sector-history-risk-table"
      emptyMessage="No risk metrics"
      dense
      stickyHeader
      rowWindowSize={40}
      minTableWidth={620}
    />
  );
}
