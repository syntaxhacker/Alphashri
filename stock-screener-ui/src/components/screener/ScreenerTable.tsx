import { createMemo, createSignal, onCleanup, onMount, Show, type JSX } from "solid-js";
import { Checkbox, ActionIcon, CopyButton, Tooltip, Badge, Group, Text, Box, Stack } from "@/ui";
import { IconCopy, IconCheck } from "../common/Icons";
import { displaySymbol } from "@/config/tvSymbols";
import { TanStackTable, type TableColumnDef } from "../common/TanStackTable";
import { useTablePrefs } from "../common/useTablePrefs";
import { SymbolLink } from "../common/SymbolLink";
import { useSymbolDock } from "../common/symbolDockContext";
import type { ColumnDef, FormattedCell } from "./columns";
import type { Stock } from "../../types";
import { selectedSymbols, toggleSymbolSelection, clearSelectedSymbols, setSelectedSymbols, subscribeToSelection } from "../../state";
import { useStoreSnapshot } from "../../hooks/useStoreSubscription";
import { getValueColor, getScoreColor, formatNumber } from "../../utils/ui-helpers";
import { narrowLabel, narrowMetricColumns, screenerColumnWidths, useScreenerNarrow } from "./narrowLayout";

interface ScreenerTableProps {
  stocks: Stock[];
  columns: ColumnDef[];
  touchedSymbols: Set<string>;
  badgeLabel?: string;
  scoreFormula?: string;
  onSymbolClick: (symbol: string) => void;
  onSymbolHover: (symbol: string | null) => void;
  testId?: string;
  /** Saved-config key. Falls back to `screener.${testId ?? "table"}`. */
  tableId?: string;
}

const SCREENER_TABLE_SCROLL_STEP = 80;

/** Arrow keys must move the same element that carries focus and `role=region`. */
function onScreenerTableRegionKeyDown(event: KeyboardEvent) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  const region = event.currentTarget as HTMLElement;
  region.scrollLeft +=
    event.key === "ArrowRight" ? SCREENER_TABLE_SCROLL_STEP : -SCREENER_TABLE_SCROLL_STEP;
  event.preventDefault();
}

export function ScreenerTable(props: ScreenerTableProps) {
  const tableId = () => props.tableId ?? `screener.${props.testId ?? "table"}`;
  // useTablePrefs is instantiated per id. Keying the body remounts it when the
  // active profile changes in place, so the old store is released and the new
  // id hydrates its own saved sort instead of inheriting the previous one.
  return (
    <Show when={tableId()} keyed>
      {(id) => <ScreenerTableBody {...props} tableId={id} />}
    </Show>
  );
}

function ScreenerTableBody(props: ScreenerTableProps & { tableId: string }) {
  const { prefs, setSorting } = useTablePrefs(props.tableId);
  const selection = useStoreSnapshot(subscribeToSelection, () => selectedSymbols);
  const visibleSymbols = createMemo(() => props.stocks.map((stock) => stock.symbol));
  const allSymbols = createMemo(() => visibleSymbols().join(", "));
  const selectedSymbolSet = createMemo(() => new Set(selection()));
  const allVisibleSelected = createMemo(
    () => visibleSymbols().length > 0 && visibleSymbols().every((symbol) => selectedSymbolSet().has(symbol)),
  );
  const dock = useSymbolDock();
  const narrow = useScreenerNarrow();

  let scrollWrapperEl: HTMLDivElement | undefined;
  const [availableWidth, setAvailableWidth] = createSignal(0);
  onMount(() => {
    const measure = () => setAvailableWidth(scrollWrapperEl?.clientWidth ?? 0);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    if (scrollWrapperEl) observer.observe(scrollWrapperEl);
    onCleanup(() => observer.disconnect());
  });

  // Narrow keeps identity + primary metrics only; wide keeps every column but
  // sizes them to the panel so the trailing SECTOR column cannot spill right.
  const activeColumns = createMemo(() =>
    narrow() ? narrowMetricColumns(props.columns) : props.columns,
  );
  const columnWidths = createMemo(() =>
    screenerColumnWidths(activeColumns(), availableWidth() || (narrow() ? 358 : 1200), narrow()),
  );
  const tableMinWidth = createMemo(
    () => [...columnWidths().values()].reduce((sum, width) => sum + width, 0),
  );

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
              onChange={() => handleSelectAll()}
              onClick={(e) => e.stopPropagation()}
              aria-label="Select all visible symbols"
              data-testid="select-all-checkbox"
            />
          </Box>
        ),
        enableSorting: false,
        size: columnWidths().get("selection"),
        meta: { align: "center" },
        cell: ({ row }) => (
          <Box onClick={(e: MouseEvent) => e.stopPropagation()} className="flex justify-center">
            <Checkbox
              size="xs"
              checked={selectedSymbolSet().has(row.original.symbol)}
              onChange={() => toggleSymbolSelection(row.original.symbol)}
              onClick={(e) => e.stopPropagation()}
              aria-label={`Select ${row.original.symbol}`}
              data-testid={`sel-checkbox-${row.original.symbol}`}
            />
          </Box>
        ),
        // checkbox fix: stop row navigation on click (was navigating to /chart/:symbol)
      },
    ];

    for (const col of activeColumns()) {
      cols.push({
        id: col.key,
        header: () => {
          const isSymbolColumn = col.key === "symbol";
          return (
            <Group gap={1} wrap="nowrap" align="center">
              <Text fw={700} size="xs">
                {narrow() ? narrowLabel(col) : col.label}
              </Text>
              <Show when={isSymbolColumn && visibleSymbols().length > 0}>
                <CopyButton value={allSymbols()}>
                  {({ copied, copy }) => (
                    <Tooltip label={copied ? "Copied" : "Copy all symbols"}>
                      <ActionIcon
                        variant="subtle"
                        color={copied ? "info" : "secondary"}
                        size="xs"
                        aria-label={copied ? "Copied all symbols" : "Copy all symbols"}
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
        size: columnWidths().get(col.key),
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
                  // Symbol text opens the in-app chart via the dock; TradingView
                  // moves to the ↗ affordance. At the default column width a
                  // second chart icon leaves the text button zero-width and
                  // steals its click target, so no chart icon is rendered here.
                  inAppText
                  tvIcon
                  showChart={false}
                  onTextClick={(sym) => props.onSymbolClick(sym)}
                  onPreview={(value: string) => {
                    props.onSymbolHover?.(value);
                    dock.preview(value);
                  }}
                  onPreviewEnd={() => {
                    props.onSymbolHover?.(null);
                    dock.endPreview();
                  }}
                  className="flex-1"
                />
                <CopyButton value={displaySymbol(stock.symbol)}>
                  {({ copied, copy }) => (
                    <ActionIcon
                      variant="subtle"
                      color={copied ? "info" : "secondary"}
                      size="xs"
                      aria-label={copied ? `Copied ${displaySymbol(stock.symbol)}` : `Copy ${displaySymbol(stock.symbol)}`}
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
              <Tooltip label={props.scoreFormula ? `${props.scoreFormula} = ${scoreValue}` : `Score: ${scoreValue}`} multiline>
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
    <Box
      data-testid={containerTestId()}
      data-screener-narrow={narrow() ? "true" : undefined}
      className="flex h-full min-h-0 w-full flex-1 flex-col rounded-sm"
    >
      <Show when={narrow()}>
        {/* Narrow rows keep their identity pinned even if a profile's width
            estimate is off and the table still scrolls a few pixels. */}
        <style>{`
          [data-screener-narrow="true"] .paper-tanstack-cell,
          [data-screener-narrow="true"] .paper-tanstack-header-cell {
            padding: 2px 4px !important;
            font-size: 11px !important;
            letter-spacing: 0.02em !important;
          }
          [data-screener-narrow="true"] th:nth-child(2),
          [data-screener-narrow="true"] td:nth-child(2) {
            position: sticky !important;
            left: 0;
            z-index: 2;
            background-color: var(--color-fin-surface-alt);
          }
        `}</style>
      </Show>
      <Stack spacing={0} className="flex min-h-0 w-full flex-1 flex-col">
        {/* Kept in the DOM for existing selectors; the narrow layout no longer
            scrolls sideways, so a detached cue would only waste a row. */}
        <Box
          className="hidden"
          data-testid="screener-table-scroll-cue"
        >
          <Text size="sm" className="text-fin-text-muted">
            Scroll sideways →
          </Text>
        </Box>
        <Box
          ref={(el: HTMLDivElement) => { scrollWrapperEl = el; }}
          className="flex min-h-0 w-full flex-1 flex-col overflow-x-auto overflow-y-hidden overscroll-x-contain focus-visible:outline focus-visible:outline-1 focus-visible:outline-fin-primary"
          data-testid="screener-table-scroll-wrapper"
          data-scroll="horizontal"
          role="region"
          aria-label="Screener results table, scroll sideways for all columns"
          tabIndex={0}
          onKeyDown={onScreenerTableRegionKeyDown}
        >
          <Box
            className="flex min-h-0 w-full flex-1 flex-col"
            style={{ "min-width": `${Math.max(narrow() ? 0 : 720, tableMinWidth())}px` }}
          >
            <TanStackTable<Stock>
              data={props.stocks}
              columns={tanStackColumns()}
              dataTestId="screener-table"
              enableSorting
              sorting={prefs().sorting}
              onSortingChange={setSorting}
              stickyHeader
              fillContainer
              className="w-full min-w-0"
              minTableWidth={tableMinWidth()}
              getRowTestId={(row) => `stock-row-${row.symbol}`}
              onRowClick={(row) => props.onSymbolClick(row.symbol)}
              rowWindowSize={props.stocks.length > 120 ? 80 : undefined}
            />
          </Box>
        </Box>
      </Stack>
    </Box>
  );
}
