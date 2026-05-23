import { Badge, Box, Group, SimpleGrid, Stack, Text } from "@mantine/core";
import type { ReactNode } from "react";
import type { Stock } from "../../types";
import type { ColumnDef, FormattedCell } from "./columns";

interface ScreenerHeatmapProps {
  stocks: Stock[];
  columns: ColumnDef[];
  touchedSymbols: Set<string>;
  badgeLabel?: string;
  onSymbolClick: (symbol: string) => void;
  onSymbolHover: (symbol: string | null) => void;
}

function isFormattedCell(value: ReactNode): value is FormattedCell {
  return Boolean(value && typeof value === "object" && "value" in (value as object));
}

function getDisplayValue(column: ColumnDef, stock: Stock): ReactNode {
  const raw = stock[column.key];
  if (column.format) {
    const formatted = column.format(raw, stock);
    if (isFormattedCell(formatted)) {
      return formatted.value;
    }
    return formatted;
  }
  if (raw === null || raw === undefined) return "-";
  return raw;
}

function getNumericColumns(columns: ColumnDef[]) {
  const preferredOrder = ["score", "day_change", "recent_return_5d", "perf_w", "rsi", "volume_m"];
  const numeric = columns.filter((column) => column.type === "number" && column.key !== "tv_price");

  return numeric
    .sort((a, b) => {
      const aIndex = preferredOrder.indexOf(a.key);
      const bIndex = preferredOrder.indexOf(b.key);
      return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
    })
    .slice(0, 4);
}

function getNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getMetricTone(
  columnKey: string,
  value: number | null,
  min: number,
  max: number,
): { background: string; color: string } {
  if (value === null) {
    return {
      background: "light-dark(rgba(148, 163, 184, 0.08), rgba(148, 163, 184, 0.12))",
      color: "var(--mantine-color-dimmed)",
    };
  }

  const range = max - min || 1;
  const normalized = Math.max(0, Math.min(1, (value - min) / range));
  const hasDirectionalMeaning =
    columnKey.includes("change") ||
    columnKey.includes("return") ||
    columnKey.includes("perf") ||
    columnKey.includes("diff") ||
    columnKey.includes("gap");

  if (hasDirectionalMeaning) {
    if (value > 0) {
      const alpha = 0.12 + normalized * 0.28;
      return {
        background: `rgba(34, 197, 94, ${alpha})`,
        color: "var(--mantine-color-green-2)",
      };
    }
    if (value < 0) {
      const alpha = 0.12 + (1 - normalized) * 0.28;
      return {
        background: `rgba(239, 68, 68, ${alpha})`,
        color: "var(--mantine-color-red-2)",
      };
    }
  }

  return {
    background: `rgba(56, 189, 248, ${0.1 + normalized * 0.24})`,
    color: "var(--mantine-color-blue-1)",
  };
}

export function ScreenerHeatmap({
  stocks,
  columns,
  touchedSymbols,
  badgeLabel,
  onSymbolClick,
  onSymbolHover,
}: ScreenerHeatmapProps) {
  const metricColumns = getNumericColumns(columns);
  const metricRanges = Object.fromEntries(
    metricColumns.map((column) => {
      const values = stocks
        .map((stock) => getNumber(stock[column.key]))
        .filter((v): v is number => v !== null);
      return [
        column.key,
        {
          min: values.length ? Math.min(...values) : 0,
          max: values.length ? Math.max(...values) : 1,
        },
      ];
    }),
  ) as Record<string, { min: number; max: number }>;

  return (
    <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing="sm" data-testid="screener-heatmap">
      {stocks.map((stock) => (
        <Box
          key={stock.symbol}
          p="sm"
          style={{
            background: "light-dark(rgba(248, 250, 252, 0.92), rgba(15, 23, 42, 0.42))",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
          }}
          data-testid={`heatmap-${stock.symbol}`}
          onClick={() => onSymbolClick(stock.symbol)}
          onMouseEnter={() => onSymbolHover(stock.symbol)}
          onMouseLeave={() => onSymbolHover(null)}
        >
          <Stack gap="sm">
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <Stack gap={2}>
                <Text fw={800} size="sm">
                  {stock.symbol}
                </Text>
                <Text size="xs" c="dimmed">
                  {stock.sector || "Unknown sector"}
                </Text>
              </Stack>
              <Group gap={6}>
                {typeof stock.score === "number" ? (
                  <Badge variant="light" color="blue" size="sm">
                    Score {Math.round(stock.score)}
                  </Badge>
                ) : null}
                {touchedSymbols.has(stock.symbol) ? (
                  <Badge variant="light" color="green" size="sm">
                    {badgeLabel || "Touched"}
                  </Badge>
                ) : null}
              </Group>
            </Group>

            <SimpleGrid cols={2} spacing="xs">
              {metricColumns.map((column) => {
                const value = getNumber(stock[column.key]);
                const tone = getMetricTone(
                  column.key,
                  value,
                  metricRanges[column.key]?.min ?? 0,
                  metricRanges[column.key]?.max ?? 1,
                );

                return (
                  <Box
                    key={column.key}
                    p="xs"
                    style={{
                      background: tone.background,
                      color: tone.color,
                    }}
                  >
                    <Text size="xs" tt="uppercase" fw={700} opacity={0.9}>
                      {column.label}
                    </Text>
                    <Text size="sm" fw={700} mt={2}>
                      {getDisplayValue(column, stock)}
                    </Text>
                  </Box>
                );
              })}
            </SimpleGrid>
          </Stack>
        </Box>
      ))}
    </SimpleGrid>
  );
}
