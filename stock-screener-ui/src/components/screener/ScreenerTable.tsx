import { createMemo, createEffect, createSignal, onCleanup, Show, type JSX } from "solid-js";
import { Checkbox, ActionIcon, CopyButton, Tooltip, Badge, Group, Text, Box, Stack } from "@/ui";
import { IconCopy, IconCheck } from "./icons";
import { TanStackTable, type TableColumnDef } from "../common/TanStackTable";
import { SymbolLink } from "../common/SymbolLink";
import { useSymbolDock } from "../common/symbolDockContext";
import type { ColumnDef, FormattedCell } from "./columns";
import type { Stock } from "../../types";
import { selectedSymbols, toggleSymbolSelection, clearSelectedSymbols, setSelectedSymbols, subscribeToSelection } from "../../state";
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

// src/hooks/useStoreSubscription.ts's useStoreSnapshot misses its createMemo
// import, so the snapshot is inlined here with the same semantics.
function useSelectionSnapshot() {
  const [tick, setTick] = createSignal(0);
  createEffect(() => {
    const unsubscribe = subscribeToSelection(() => setTick((n) => n + 1));
    onCleanup(unsubscribe);
  });
  return createMemo(() => {
    tick();
    return selectedSymbols;
  });
}

export function ScreenerTable(props: ScreenerTableProps) {
  const selection = useSelectionSnapshot();
  const visibleSymbols = createMemo(() => props.stocks.map((stock) => stock.symbol));
  const allSymbols = createMemo(() => visibleSymbols().join(", "));
  const selectedSymbolSet = createMemo(() => new Set(selection()));
  const allVisibleSelected = createMemo(
    () => visibleSymbols().length > 0 && visibleSymbols().every((symbol) => selectedSymbolSet().has(symbol)),
  );
  const dock = useSymbolDock();

  const handleSelectAll = () => {
    if (allVisibleSelected()) {
      clearSelectedSymbols();
    } else {
      setSelectedSymbols(visibleSymbols());
    }
  };

  const testId = () => props.testId ?? "screener-table";
  const containerTestId = () => (testId() === "screener-table" ? undefined : testId());

  const tanStackColumns = createMemo<TableColumnDef<Stock>[]>(() => {
    const cols: TableColumnDef<Stock>[] = [
      {
        id: "selection",
        header: () => (
          <Box onClick={(e: MouseEvent) => e.stopPropagation()} className="flex justify-center">
            <Checkbox
              size="xs"
              checked={allVisibleSelected()}
              indeterminate={selectedSymbolSet().size > 0 && !allVisibleSelected()}
              onChange={(e: any) => { e?.stopPropagation?.(); handleSelectAll(); }}
              onClick={(e: any) => e.stopPropagation()}
              data-testid="select-all-checkbox"
            />
          </Box>
        ),
        enableSorting: false,
        meta: { align: "center" },
        cell: ({ row }) => (
          <Box onClick={(e: MouseEvent) => e.stopPropagation()} className="flex justify-center">
            <Checkbox
              size="xs"
              checked={selectedSymbolSet().has(row.original.symbol)}
              onChange={(e: any) => { e?.stopPropagation?.(); toggleSymbolSelection(row.original.symbol); }}
              onClick={(e: any) => e.stopPropagation()}
              data-testid={`sel-checkbox-${row.original.symbol}`}
            />
          </Box>
        ),
        // checkbox fix: stop row navigation on click (was navigating to /chart/:symbol)
      },
    ];

    for (const col of props.columns) {
      cols.push({
        id: col.key,
        header: () => {
          const isSymbolColumn = col.key === "symbol";
          return (
            <Group gap={1} wrap="nowrap" align="center">
              <Text fw={700} size="xs">
                {col.label}
              </Text>
              <Show when={isSymbolColumn && visibleSymbols().length > 0}>
                <CopyButton value={allSymbols()}>
                  {({ copied, copy }) => (
                    <Tooltip label={copied ? "Copied" : "Copy all symbols"}>
                      <ActionIcon
                        variant="subtle"
                        color={copied ? "info" : "secondary"}
                        size="xs"
                        style={{ width: "16px", height: "16px", "min-height": "16px", padding: 0 }}
                        onClick={(e: MouseEvent) => { e.stopPropagation(); copy(); }}
                        data-testid="copy-all-symbols-btn"
                      >
                        {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
                      </ActionIcon>
                    </Tooltip>
                  )}
                </CopyButton>
              </Show>
            </Group>
          );
        },
        accessorKey: col.key as keyof Stock,
        enableSorting: col.sortable ?? true,
        meta: {
          align:
            col.align ??
            (col.key === "symbol" || col.type === "string"
              ? "left"
              : col.type === "badge" || col.key === "score"
                ? "center"
                : "right"),
        },
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
              return <>{formatted as JSX.Element}</>;
            }
          }

          if (col.key === "symbol") {
            return (
              <Box
                className="flex items-center gap-2 min-w-0"
                data-testid={`symbol-cell-${stock.symbol}`}
              >
                <SymbolLink
                  symbol={stock.symbol}
                  testId={`symbol-link-${stock.symbol}`}
                  chartTestId={`symbol-chart-${stock.symbol}`}
                  onPreview={(value: string) => {
                    props.onSymbolHover?.(value);
                    dock.preview(value);
                  }}
                  onPreviewEnd={() => {
                    props.onSymbolHover?.(null);
                    dock.endPreview();
                  }}
                  onOpen={dock.open}
                  className="flex-1"
                />
                <CopyButton value={stock.symbol}>
                  {({ copied, copy }) => (
                    <ActionIcon
                      variant="subtle"
                      color={copied ? "info" : "secondary"}
                      size="xs"
                      style={{ width: "16px", height: "16px", "min-height": "16px", padding: 0 }}
                      onClick={(e: MouseEvent) => { e.stopPropagation(); copy(); }}
                      data-testid={`copy-symbol-btn-${stock.symbol}`}
                    >
                      {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
                    </ActionIcon>
                  )}
                </CopyButton>
                <Show when={props.touchedSymbols.has(stock.symbol) && props.badgeLabel}>
                  <Badge size="xs" variant="light" color="primary" data-testid={`touched-badge-${stock.symbol}`}>
                    {props.badgeLabel}
                  </Badge>
                </Show>
                <Show when={stock.approach_type === "fresh" || stock.approach_type === "retest"}>
                  <Badge
                    size="xs"
                    variant="light"
                    color={stock.approach_type === "fresh" ? "success" : "warning"}
                    data-testid={`approach-badge-${stock.symbol}`}
                  >
                    {stock.approach_type === "fresh" ? "FRESH" : "RETEST"}
                  </Badge>
                </Show>
              </Box>
            );
          }

          if (col.key === "score" || col.type === "badge") {
            const scoreValue = typeof value === "number" ? value : 0;
            return (
              <Tooltip label={props.scoreFormula ? `${props.scoreFormula} = ${scoreValue}` : `Score: ${scoreValue}`} multiline withinPortal>
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
  });

    return (
      <Box className="w-full overflow-hidden rounded-sm" data-testid={containerTestId()}>
        <Stack spacing={0} className="w-full">
          <Box className="w-full flex justify-center">
              <TanStackTable<Stock>
                data={props.stocks}
                columns={tanStackColumns()}
                dataTestId="screener-table"
                enableSorting
                stickyHeader
                className="w-full min-w-0"
                getRowTestId={(row) => `stock-row-${row.symbol}`}
                onRowClick={(row) => props.onSymbolClick(row.symbol)}
                rowWindowSize={props.stocks.length > 120 ? 80 : undefined}
              />
            </Box>
          </Stack>
      </Box>
  );
}
