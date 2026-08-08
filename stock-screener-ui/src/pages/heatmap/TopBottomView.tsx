import { useMemo } from "react";
import { Flex, Text, Group, Badge } from "@/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { TanStackTable } from "../../components/common/TanStackTable";

interface TopBottomViewProps {
  stocks: any[];
  metric: string;
  getMetricValue: (stock: any, metric: string) => number;
  getMetricColor: (value: number, min: number, max: number) => string;
  getMetricTextColor: (value: number, min: number, max: number) => string;
  METRICS: { value: string; label: string; fmt: (v: number) => string }[];
}

export function TopBottomView({ stocks, metric, getMetricValue, getMetricColor, getMetricTextColor, METRICS }: TopBottomViewProps) {
  const metricConfig = METRICS.find((m) => m.value === metric) || METRICS[0];
  const fmt = metricConfig?.fmt ?? ((v: number) => v.toFixed(2));

  const metricValues = stocks.map((s) => getMetricValue(s, metric));
  const minAll = metricValues.length ? Math.min(...metricValues) : 0;
  const maxAll = metricValues.length ? Math.max(...metricValues) : 1;

  const top10 = stocks.slice(0, 10);
  const bottom10 = [...stocks].slice(-10).reverse();

  function formatPe(pe: number | null | undefined): string {
    if (pe == null || pe === 0) return "-";
    return pe.toFixed(1);
  }

  const columns = useMemo<ColumnDef<any>[]>(
    () => [
      { id: "rank", header: "#", accessorKey: "rank" },
      {
        id: "symbol",
        header: "Symbol",
        accessorKey: "symbol",
        cell: (info) => <span style={{ fontWeight: 500, fontSize: 11 }}>{info.getValue<string>()}</span>,
      },
      {
        id: "name",
        header: "Name",
        accessorKey: "name",
        cell: (info) => {
          const val = info.getValue<string>();
          return (
            <span style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160, display: "inline-block" }}>
              {val}
            </span>
          );
        },
      },
      {
        id: "metric",
        header: metricConfig?.label ?? metric,
        accessorFn: (row: any) => getMetricValue(row, metric),
        cell: (info) => {
          const val = info.getValue<number>();
          const bg = getMetricColor(val, minAll, maxAll);
          const tc = getMetricTextColor(val, minAll, maxAll);
          return (
            <span style={{ backgroundColor: bg, color: tc, fontWeight: 700, padding: "1px 4px", borderRadius: 2, textAlign: "right", display: "block", fontSize: 11 }}>
              {fmt(val)}
            </span>
          );
        },
      },
      {
        id: "pe",
        header: "P/E",
        accessorKey: "pe_ratio",
        cell: (info) => (
          <span style={{ fontSize: 11, textAlign: "right", display: "block" }}>
            {formatPe(info.getValue<number | null>())}
          </span>
        ),
      },
      {
        id: "sector",
        header: "Sector",
        accessorKey: "sector",
        cell: (info) => {
          const val = info.getValue<string>();
          return (
            <span style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 120, display: "inline-block" }}>
              {val}
            </span>
          );
        },
      },
    ],
    [metric, metricConfig, fmt, minAll, maxAll],
  );

  function renderTable(title: string, badgeColor: string, data: any[], startRank: number) {
    const tableData = data.map((s, i) => ({ ...s, rank: startRank + i }));

    return (
      <Flex direction="column" style={{ flex: 1 }}>
        <Group gap="xs" mb="xs">
          <Text size="sm" fw={600}>{title}</Text>
          <Badge color={badgeColor} size="sm" variant="light">{data.length}</Badge>
        </Group>
        <TanStackTable
          data={tableData}
          columns={columns}
          enableSorting={false}
          stickyHeader={false}
        />
      </Flex>
    );
  }

  return (
    <Flex gap="md" p="sm" style={{ flex: 1 }}>
      {renderTable("Top 10", "green", top10, 1)}
      {renderTable("Bottom 10", "red", bottom10, stocks.length - bottom10.length + 1)}
    </Flex>
  );
}
