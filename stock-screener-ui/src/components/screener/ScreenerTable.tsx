import { useCallback } from "react";
import { Table, ActionIcon, CopyButton, Tooltip, Checkbox } from "@mantine/core";
import { IconCopy, IconCheck } from "@tabler/icons-react";
import { DataTable, SortableHeader } from "../common";
import { StockRow } from "./StockRow";
import { selectedSymbols, setSelectedSymbols, clearSelectedSymbols } from "../../state";
import type { ColumnDef } from "./columns";
import type { Stock } from "../../types";

interface ScreenerTableProps {
  stocks: Stock[];
  columns: ColumnDef[];
  touchedSymbols: Set<string>;
  badgeLabel?: string;
  scoreFormula?: string;
  sortColumn: string | null;
  sortDirection: "asc" | "desc";
  onSortChange: (column: string) => void;
  onSymbolClick: (symbol: string) => void;
  onSymbolHover: (symbol: string | null) => void;
}

export function ScreenerTable({
  stocks,
  columns,
  touchedSymbols,
  badgeLabel,
  scoreFormula,
  sortColumn,
  sortDirection,
  onSortChange,
  onSymbolClick,
  onSymbolHover,
}: ScreenerTableProps) {
  const allSymbols = stocks.map((s) => s.symbol).join(", ");
  const visibleSymbols = stocks.map((s) => s.symbol);
  const allVisibleSelected = visibleSymbols.every((s) => selectedSymbols.includes(s));

  const handleSelectAll = () => {
    if (allVisibleSelected) {
      clearSelectedSymbols();
    } else {
      setSelectedSymbols(visibleSymbols);
    }
  };

  const renderHeader = useCallback((column: ColumnDef) => {
    const isSymbolColumn = column.key === "symbol";

    return (
      <SortableHeader
        key={column.key}
        label={column.label}
        columnKey={column.key}
        sortColumn={sortColumn}
        sortDirection={sortDirection}
        onSort={onSortChange}
        testId={`sort-header-${column.key}`}
        className="sortable screener-table-header-cell"
      >
        {isSymbolColumn && stocks.length > 0 && (
          <CopyButton value={allSymbols}>
            {({ copied, copy }) => (
              <Tooltip label={copied ? "Copied" : "Copy all symbols"}>
                <ActionIcon
                  variant="subtle"
                  color={copied ? "teal" : "gray"}
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    copy();
                  }}
                  data-testid="copy-all-symbols-btn"
                  className="copy-all-symbols-btn"
                >
                  {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
                </ActionIcon>
              </Tooltip>
            )}
          </CopyButton>
        )}
      </SortableHeader>
    );
  }, [sortColumn, sortDirection, onSortChange, allSymbols, stocks]);

  return (
    <DataTable
      withTableBorder
      stickyHeader
      id="screener-table"
      className="screener-table"
      dataTestId="screener-table"
      style={{ width: "100%", minWidth: 0 }}
    >
      <Table.Thead className="screener-table-header" data-testid="screener-table-header">
        <Table.Tr>
          <Table.Th style={{ width: 40 }} data-testid="select-all-header">
            <Checkbox
              size="xs"
              checked={stocks.length > 0 && allVisibleSelected}
              indeterminate={selectedSymbols.length > 0 && !allVisibleSelected}
              onChange={handleSelectAll}
              data-testid="select-all-checkbox"
            />
          </Table.Th>
          {columns.map(renderHeader)}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody className="screener-table-body" data-testid="screener-table-body">
        {stocks.map((stock) => (
          <StockRow
            key={stock.symbol}
            stock={stock}
            columns={columns}
            isTouched={touchedSymbols.has(stock.symbol)}
            badgeLabel={badgeLabel}
            scoreFormula={scoreFormula}
            onSymbolClick={onSymbolClick}
            onSymbolHover={onSymbolHover}
          />
        ))}
      </Table.Tbody>
    </DataTable>
  );
}
