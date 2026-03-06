import { Table, Anchor, Badge, Tooltip, Group, Text } from '@mantine/core';
import { IconArrowUp, IconArrowDown } from '@tabler/icons-react';
import { StockRow } from './StockRow';

interface Stock {
  symbol: string;
  score: number;
  [key: string]: any;
}

interface ColumnDef {
  key: string;
  label: string;
  type?: 'number' | 'string' | 'badge';
  format?: (value: any, stock: Stock) => React.ReactNode;
}

interface ScreenerTableProps {
  stocks: Stock[];
  columns: ColumnDef[];
  touchedSymbols: Set<string>;
  sortColumn: string | null;
  sortDirection: 'asc' | 'desc';
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
  return (
    <Table.ScrollContainer minWidth={800} data-testid="screener-table">
      <Table striped highlightOnHover withTableBorder stickyHeader>
        <Table.Thead>
          <Table.Tr>
            {columns.map((column) => (
              <Table.Th
                key={column.key}
                style={{ cursor: 'pointer' }}
                onClick={() => onSortChange(column.key)}
              >
                <Group gap={4} wrap="nowrap">
                  <Text>{column.label}</Text>
                  {sortColumn === column.key && (
                    sortDirection === 'asc' ? (
                      <IconArrowUp size={14} />
                    ) : (
                      <IconArrowDown size={14} />
                    )
                  )}
                </Group>
              </Table.Th>
            ))}
          </Table.Tr>
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
    </Table.ScrollContainer>
  );
}
