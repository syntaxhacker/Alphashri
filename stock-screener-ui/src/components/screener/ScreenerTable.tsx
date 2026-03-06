import { Table, Group, Text, ActionIcon, CopyButton, Tooltip, ScrollArea } from "@mantine/core";
import { IconArrowUp, IconArrowDown, IconCopy, IconCheck } from "@tabler/icons-react";
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
  screenerType?: string;
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
  screenerType,
}: ScreenerTableProps) {
  const allSymbols = stocks.map((s) => s.symbol).join(", ");

  const renderHeader = (column: ColumnDef) => {
    const isSymbolColumn = column.key === "symbol";

    return (
      <Table.Th
        key={column.key}
        style={{ cursor: "pointer" }}
        onClick={() => onSortChange(column.key)}
        data-testid={`sort-header-${column.key}`}
        className="sortable"
      >
        <Group gap={4} wrap="nowrap">
          <Text>{column.label}</Text>
          {sortColumn === column.key && (
            <span className={`sort-indicator ${sortDirection}`}>
              {sortDirection === "asc" ? <IconArrowUp size={14} /> : <IconArrowDown size={14} />}
            </span>
          )}
          {isSymbolColumn && stocks.length > 0 && (
            <CopyButton value={allSymbols}>
              {({ copied, copy }) => (
                <Tooltip label={copied ? "Copied" : "Copy all symbols"}>
                  <ActionIcon
                    variant="subtle"
                    color={copied ? "teal" : "gray"}
                    size="xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      copy();
                    }}
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
  };

  return (
    <ScrollArea h="100%" offsetScrollbars type="always">
      <Table striped highlightOnHover withTableBorder stickyHeader>
        <Table.Thead>
          <Table.Tr>{columns.map(renderHeader)}</Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {stocks.map((stock) => (
            <StockRow
              key={stock.symbol}
              stock={stock}
              columns={columns}
              isTouched={touchedSymbols.has(stock.symbol)}
              onSymbolClick={onSymbolClick}
              onSymbolHover={onSymbolHover}
              screenerType={screenerType}
            />
          ))}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  );
}
