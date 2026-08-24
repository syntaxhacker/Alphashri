import { useMemo } from "react";
import { Checkbox, ActionIcon, CopyButton, Tooltip, Anchor, Badge, Group, Text } from "@/ui";
import { IconCopy, IconCheck } from "@tabler/icons-react";
import type { ColumnDef as TanStackColumnDef } from "@tanstack/react-table";
import { TanStackTable } from "../common/TanStackTable";
import type { ColumnDef, FormattedCell } from "./columns";
import type { Stock } from "../../types";
import { selectedSymbols, toggleSymbolSelection, clearSelectedSymbols, setSelectedSymbols } from "../../state";
import { getValueColor, getScoreColor, formatNumber } from "../../utils/ui-helpers";
import { usePreviewChart } from "../common/PreviewChartProvider";

interface ScreenerTableProps {
  stocks: Stock[];
  columns: ColumnDef[];
  touchedSymbols: Set<string>;
  badgeLabel?: string;
  scoreFormula?: string;
  onSymbolClick: (symbol: string) => void;
  onSymbolHover: (symbol: string | null) => void;
}

export function ScreenerTable({
  stocks,
  columns,
  touchedSymbols,
  badgeLabel,
  scoreFormula,
  onSymbolClick,
  onSymbolHover,
}: ScreenerTableProps) {
  const allSymbols = stocks.map((s) => s.symbol).join(", ");
  const visibleSymbols = stocks.map((s) => s.symbol);
  const allVisibleSelected = visibleSymbols.every((s) => selectedSymbols.includes(s));
  const { showPreviewChart, hidePreviewChart } = usePreviewChart();

  const handleSelectAll = () => {
    if (allVisibleSelected) {
      clearSelectedSymbols();
    } else {
      setSelectedSymbols(visibleSymbols);
    }
  };

  const tanStackColumns = useMemo<TanStackColumnDef<Stock>[]>(() => {
    const cols: TanStackColumnDef<Stock>[] = [
      {
        id: "selection",
        header: () => (
          <Checkbox
            size="xs"
            checked={stocks.length > 0 && allVisibleSelected}
            indeterminate={selectedSymbols.length > 0 && !allVisibleSelected}
            onChange={handleSelectAll}
            data-testid="select-all-checkbox"
          />
        ),
        enableSorting: false,
        cell: ({ row }) => (
          <Checkbox
            size="xs"
            checked={selectedSymbols.includes(row.original.symbol)}
            onChange={() => toggleSymbolSelection(row.original.symbol)}
            data-testid={`sel-checkbox-${row.original.symbol}`}
          />
        ),
      },
    ];

    for (const col of columns) {
      cols.push({
        id: col.key,
        header: () => {
          const isSymbolColumn = col.key === "symbol";
          return (
            <Group gap={4} wrap="nowrap">
              <Text fw={700}>{col.label}</Text>
              {isSymbolColumn && stocks.length > 0 && (
                <CopyButton value={allSymbols}>
                  {({ copied, copy }) => (
                    <Tooltip label={copied ? "Copied" : "Copy all symbols"}>
                      <ActionIcon
                        variant="subtle"
                        color={copied ? "teal" : "gray"}
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); copy(); }}
                        data-testid="copy-all-symbols-btn"
                      >
                        {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
                      </ActionIcon>
                    </Tooltip>
                  )}
                </CopyButton>
              )}
            </Group>
          );
        },
        accessorKey: col.key as keyof Stock,
        enableSorting: col.sortable ?? true,
        cell: ({ row }) => {
          const stock = row.original;
          const value = stock[col.key as keyof Stock];

          if (col.format) {
            const formatted = col.format(value, stock);
            if (
              formatted !== null &&
              formatted !== undefined &&
              typeof formatted === "object" &&
              "value" in (formatted as FormattedCell)
            ) {
              const cell = formatted as FormattedCell;
              return <Text c={cell.className} fw={500}>{cell.value}</Text>;
            }
            if (formatted !== null && formatted !== undefined) {
              return <>{formatted}</>;
            }
          }

          if (col.key === "symbol") {
            return (
              <Group gap={4} wrap="nowrap" className="symbol-cell" data-testid={`symbol-cell-${stock.symbol}`}>
                <Tooltip label="Click for details">
                  <Anchor
                    component="button"
                    type="button"
                    onClick={() => { hidePreviewChart(); onSymbolClick(stock.symbol); }}
                    onMouseEnter={(e) => { onSymbolHover(stock.symbol); showPreviewChart(e, stock.symbol); }}
                    onMouseLeave={() => { onSymbolHover(null); hidePreviewChart(); }}
                    className="symbol-link"
                    data-testid={`symbol-link-${stock.symbol}`}
                  >
                    {stock.symbol}
                  </Anchor>
                </Tooltip>
                <CopyButton value={stock.symbol}>
                  {({ copied, copy }) => (
                    <ActionIcon
                      variant="subtle"
                      color={copied ? "teal" : "gray"}
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); copy(); }}
                      className="copy-symbol-btn"
                      data-testid={`copy-symbol-btn-${stock.symbol}`}
                    >
                      {copied ? <IconCheck size={10} /> : <IconCopy size={10} />}
                    </ActionIcon>
                  )}
                </CopyButton>
                {touchedSymbols.has(stock.symbol) && badgeLabel ? (
                  <Badge size="sm" variant="light" color="blue" className="touched-badge" data-testid={`touched-badge-${stock.symbol}`}>
                    {badgeLabel}
                  </Badge>
                ) : null}
              </Group>
            );
          }

          if (col.key === "score" || col.type === "badge") {
            const scoreValue = typeof value === "number" ? value : 0;
            return (
              <Tooltip label={scoreFormula ? `${scoreFormula} = ${scoreValue}` : `Score: ${scoreValue}`} multiline w={300} withinPortal>
                <Badge color={getScoreColor(scoreValue)} variant="light" className="score-badge" data-testid={`score-badge-${stock.symbol}`}>
                  {scoreValue}
                </Badge>
              </Tooltip>
            );
          }

          if (col.type === "number") {
            if (value === undefined || value === null || (typeof value === "number" && isNaN(value))) {
              return <Text c="dimmed" data-testid={`number-cell-${stock.symbol}-${col.key}`}>-</Text>;
            }
            const color = typeof value === "number" ? getValueColor(value) : undefined;
            return (
              <Text c={color} fw={500} className="number-cell" data-testid={`number-cell-${stock.symbol}-${col.key}`}>
                {typeof value === "number" ? formatNumber(value) : String(value ?? "-")}
              </Text>
            );
          }

          return <>{value ?? "-"}</>;
        },
      });
    }

    return cols;
  }, [columns, stocks, allSymbols, allVisibleSelected, touchedSymbols, badgeLabel, scoreFormula, onSymbolClick, onSymbolHover, showPreviewChart, hidePreviewChart]);

  return (
    <TanStackTable<Stock>
      data={stocks}
      columns={tanStackColumns}
      dataTestId="screener-table"
      enableSorting
      stickyHeader
      style={{ width: "100%", minWidth: 0 }}
      getRowClassName={(row) => `stock-row ${touchedSymbols.has(row.symbol) ? "touched" : "approaching"}`}
      getRowTestId={(row) => `stock-row-${row.symbol}`}
      onRowClick={(row) => { hidePreviewChart(); onSymbolClick(row.symbol); }}
      rowWindowSize={stocks.length > 120 ? 80 : 0}
    />
  );
}
