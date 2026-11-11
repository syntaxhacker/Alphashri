import { memo, useCallback, useMemo } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import { Checkbox, ActionIcon, CopyButton, Tooltip, Badge, Group, Text } from "@/ui";
import { IconCopy, IconCheck } from "@tabler/icons-react";
import type { ColumnDef as TanStackColumnDef } from "@tanstack/react-table";
import { TanStackTable } from "../common/TanStackTable";
import { SymbolLink } from "../common/SymbolLink";
import { useSymbolDock } from "../common/symbolDockContext";
import type { ColumnDef, FormattedCell } from "./columns";
import type { Stock } from "../../types";
import { selectedSymbols, toggleSymbolSelection, clearSelectedSymbols, setSelectedSymbols, subscribeToSelection } from "../../state";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import { getValueColor, getScoreColor, formatNumber } from "../../utils/ui-helpers";

interface ScreenerTableProps {
  stocks: Stock[];
  columns: ColumnDef[];
  touchedSymbols: Set<string>;
  badgeLabel?: string;
  scoreFormula?: string;
  onSymbolClick: (symbol: string) => void;
  onSymbolHover: (symbol: string | null) => void;
  testId?: string;
}

export const ScreenerTable = memo(function ScreenerTable({
  stocks,
  columns,
  touchedSymbols,
  badgeLabel,
  scoreFormula,
  onSymbolClick,
  onSymbolHover,
  testId = "screener-table",
}: ScreenerTableProps) {
  useStoreSubscription(subscribeToSelection);
  const visibleSymbols = useMemo(() => stocks.map((stock) => stock.symbol), [stocks]);
  const allSymbols = useMemo(() => visibleSymbols.join(", "), [visibleSymbols]);
  const selectedSymbolSet = useMemo(() => new Set(selectedSymbols), [selectedSymbols]);
  const allVisibleSelected = useMemo(
    () => visibleSymbols.length > 0 && visibleSymbols.every((symbol) => selectedSymbolSet.has(symbol)),
    [visibleSymbols, selectedSymbolSet],
  );
  const { preview, endPreview, open } = useSymbolDock();

  const handleSelectAll = useCallback(() => {
    if (allVisibleSelected) {
      clearSelectedSymbols();
    } else {
      setSelectedSymbols(visibleSymbols);
    }
  }, [allVisibleSelected, visibleSymbols]);

  const handleSymbolRowClick = useCallback(
    (row: Stock) => {
      onSymbolClick(row.symbol);
    },
    [onSymbolClick],
  );
  const containerTestId = testId === "screener-table" ? undefined : testId;

  const tanStackColumns = useMemo<TanStackColumnDef<Stock>[]>(() => {
    const cols: TanStackColumnDef<Stock>[] = [
      {
        id: "selection",
        header: () => (
          <Box onClick={(e) => e.stopPropagation()} sx={{ display: "flex", justifyContent: "center" }}>
            <Checkbox
              size="xs"
              checked={allVisibleSelected}
              indeterminate={selectedSymbolSet.size > 0 && !allVisibleSelected}
              onChange={(e: any) => { e?.stopPropagation?.(); handleSelectAll(); }}
              onClick={(e: any) => e.stopPropagation()}
              data-testid="select-all-checkbox"
            />
          </Box>
        ),
        enableSorting: false,
        meta: { align: "center" } as never,
        cell: ({ row }) => (
          <Box onClick={(e) => e.stopPropagation()} sx={{ display: "flex", justifyContent: "center" }}>
            <Checkbox
              size="xs"
              checked={selectedSymbolSet.has(row.original.symbol)}
              onChange={(e: any) => { e?.stopPropagation?.(); toggleSymbolSelection(row.original.symbol); }}
              onClick={(e: any) => e.stopPropagation()}
              data-testid={`sel-checkbox-${row.original.symbol}`}
            />
          </Box>
        ),
        // checkbox fix: stop row navigation on click (was navigating to /chart/:symbol)
      },
    ];

    for (const col of columns) {
      cols.push({
        id: col.key,
        header: () => {
          const isSymbolColumn = col.key === "symbol";
          return (
            <Group gap={1} wrap="nowrap" align="center">
              <Text fw={700} size="xs">
                {col.label}
              </Text>
              {isSymbolColumn && visibleSymbols.length > 0 && (
                <CopyButton value={allSymbols}>
                  {({ copied, copy }) => (
                    <Tooltip label={copied ? "Copied" : "Copy all symbols"}>
                      <ActionIcon
                        variant="subtle"
                        color={copied ? "info" : "secondary"}
                        size="xs"
                        style={{ width: 16, height: 16, minHeight: 16, padding: 0 }}
                        onClick={(e) => { e.stopPropagation(); copy(); }}
                        data-testid="copy-all-symbols-btn"
                      >
                        {copied ? <IconCheck size={10} /> : <IconCopy size={10} />}
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
        meta: {
          align:
            col.key === "symbol"
              ? "left"
              : col.type === "badge" || col.key === "score"
                ? "center"
                : "right",
        } as never,
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
              <Box
                sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}
                data-testid={`symbol-cell-${stock.symbol}`}
              >
                <SymbolLink
                  symbol={stock.symbol}
                  testId={`symbol-link-${stock.symbol}`}
                  chartTestId={`symbol-chart-${stock.symbol}`}
                  onPreview={(value) => {
                    onSymbolHover?.(value);
                    preview(value);
                  }}
                  onPreviewEnd={() => {
                    onSymbolHover?.(null);
                    endPreview();
                  }}
                  onOpen={open}
                  sx={{ flex: 1 }}
                />
                <CopyButton value={stock.symbol}>
                  {({ copied, copy }) => (
                    <ActionIcon
                      variant="subtle"
                      color={copied ? "info" : "secondary"}
                      size="xs"
                      style={{ width: 16, height: 16, minHeight: 16, padding: 0 }}
                      onClick={(e) => { e.stopPropagation(); copy(); }}
                      data-testid={`copy-symbol-btn-${stock.symbol}`}
                    >
                      {copied ? <IconCheck size={10} /> : <IconCopy size={10} />}
                    </ActionIcon>
                  )}
                </CopyButton>
                {touchedSymbols.has(stock.symbol) && badgeLabel ? (
                  <Badge size="xs" variant="light" color="primary" data-testid={`touched-badge-${stock.symbol}`}>
                    {badgeLabel}
                  </Badge>
                ) : null}
                {stock.approach_type === "fresh" || stock.approach_type === "retest" ? (
                  <Badge
                    size="xs"
                    variant="light"
                    color={stock.approach_type === "fresh" ? "success" : "warning"}
                    data-testid={`approach-badge-${stock.symbol}`}
                  >
                    {stock.approach_type === "fresh" ? "FRESH" : "RETEST"}
                  </Badge>
                ) : null}
              </Box>
            );
          }

          if (col.key === "score" || col.type === "badge") {
            const scoreValue = typeof value === "number" ? value : 0;
            return (
              <Tooltip label={scoreFormula ? `${scoreFormula} = ${scoreValue}` : `Score: ${scoreValue}`} multiline w={300} withinPortal>
                <Badge color={getScoreColor(scoreValue)} variant="filled" data-testid={`score-badge-${stock.symbol}`}>
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
              <Text c={color} fw={500} data-testid={`number-cell-${stock.symbol}-${col.key}`}>
                {typeof value === "number" ? formatNumber(value) : String(value ?? "-")}
              </Text>
            );
          }

          return <>{value ?? "-"}</>;
        },
      });
    }

    return cols;
  }, [columns, visibleSymbols, allSymbols, allVisibleSelected, selectedSymbolSet, touchedSymbols, badgeLabel, scoreFormula, onSymbolClick, onSymbolHover, preview, endPreview, open, handleSelectAll]);

    return (
      <Box sx={{ width: "100%", overflow: "hidden", borderRadius: 1 }} data-testid={containerTestId}>
        <Stack spacing={0} sx={{ width: "100%" }}>
          <Box sx={{ width: "100%", display: "flex", justifyContent: "center" }}>
              <TanStackTable<Stock>
                data={stocks}
                columns={tanStackColumns}
                dataTestId="screener-table"
                enableSorting
                stickyHeader
                sx={{ width: "100%", minWidth: 0 } as any}
                getRowTestId={(row) => `stock-row-${row.symbol}`}
                onRowClick={handleSymbolRowClick}
                rowWindowSize={stocks.length > 120 ? 80 : 0}
              />
            </Box>
          </Stack>
      </Box>
  );
});
