import { Table, Group, Text, ActionIcon, CopyButton, Tooltip } from "@mantine/core";
import { IconArrowUp, IconArrowDown, IconCopy, IconCheck } from "@tabler/icons-react";
import { DataTable } from "../common/DataTable";
import { SortableHeader } from "../common/SortableHeader";
import { StockRow } from "./StockRow";
import type { ColumnDef } from "./columns";
import type { Stock } from "../../types";

interface ScreenerTableProps {
  stocks: Stock[];
  columns: ColumnDef[];
  touchedSymbols: Set<string>;
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
  sortColumn,
  sortDirection,
  onSortChange,
  onSymbolClick,
  onSymbolHover,
}: ScreenerTableProps) {
  const allSymbols = stocks.map((s) => s.symbol).join(", ");

  const renderHeader = (column: ColumnDef) => {
    const isSymbolColumn = column.key === "symbol";

    if (isSymbolColumn) {
      return (
        <Table.Th
          key={column.key}
          onClick={() => onSortChange(column.key)}
          data-testid={`sort-header-${column.key}`}
          className={`screener-table-header-cell sortable ${sortColumn === column.key ? "sorted" : ""}`}
          id={`header-${column.key}`}
        >
          <Group gap={4} wrap="nowrap">
            <Text>{column.label}</Text>
            {sortColumn === column.key && (
              <span
                className={`sort-indicator ${sortDirection}`}
                data-testid={`sort-indicator-${column.key}`}
              >
                {sortDirection === "asc" ? <IconArrowUp size={14} /> : <IconArrowDown size={14} />}
              </span>
            )}
            {stocks.length > 0 && (
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
          </Group>
        </Table.Th>
      );
    }

    return (
      <SortableHeader
        key={column.key}
        label={column.label}
        columnKey={column.key}
        sortColumn={sortColumn}
        sortDirection={sortDirection}
        onSort={onSortChange}
        testId={`sort-header-${column.key}`}
      />
    );
  };

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
        <Table.Tr>{columns.map(renderHeader)}</Table.Tr>
      </Table.Thead>
      <Table.Tbody className="screener-table-body" data-testid="screener-table-body">
        {stocks.map((stock) => (
          <StockRow
            key={stock.symbol}
            stock={stock}
            columns={columns}
            isTouched={touchedSymbols.has(stock.symbol)}
            onSymbolClick={onSymbolClick}
            onSymbolHover={onSymbolHover}
          />
        ))}
      </Table.Tbody>
    </DataTable>
  );
}
