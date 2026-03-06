import { Table, Anchor, Badge, Tooltip, Group, Text } from '@mantine/core';
import { IconArrowUp, IconArrowDown } from '@tabler/icons-react';

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

interface StockRowProps {
  stock: Stock;
  columns: ColumnDef[];
  isTouched: boolean;
  onSymbolClick: (symbol: string) => void;
  onSymbolHover: (symbol: string | null) => void;
  screenerType?: string;
}

function getScoreColor(score: number): string {
  if (score >= 80) return 'green';
  if (score >= 60) return 'lime';
  if (score >= 40) return 'yellow';
  if (score >= 20) return 'orange';
  return 'red';
}

function formatNumber(value: any): React.ReactNode {
  if (value === null || value === undefined) return '-';
  const num = typeof value === 'number' ? value : parseFloat(value);
  if (isNaN(num)) return value;
  return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getValueColor(value: any): string | undefined {
  if (value === null || value === undefined) return undefined;
  const num = typeof value === 'number' ? value : parseFloat(value);
  if (isNaN(num)) return undefined;
  if (num > 0) return 'green';
  if (num < 0) return 'red';
  return undefined;
}

export function StockRow({
  stock,
  columns,
  isTouched,
  onSymbolClick,
  onSymbolHover,
  screenerType,
}: StockRowProps) {
  const renderCell = (column: ColumnDef) => {
    const value = stock[column.key];

    if (column.format) {
      return column.format(value, stock);
    }

    if (column.key === 'symbol') {
      return (
        <Group gap={4} wrap="nowrap">
          <Tooltip label="View details">
            <Anchor
              component="button"
              type="button"
              onClick={() => onSymbolClick(stock.symbol)}
              onMouseEnter={() => onSymbolHover(stock.symbol)}
              onMouseLeave={() => onSymbolHover(null)}
            >
              {stock.symbol}
            </Anchor>
          </Tooltip>
          {isTouched && (
            <Badge size="xs" variant="light" color="blue">
              Touched
            </Badge>
          )}
        </Group>
      );
    }

    if (column.key === 'score' || column.type === 'badge') {
      const scoreValue = typeof value === 'number' ? value : 0;
      return (
        <Badge color={getScoreColor(scoreValue)} variant="light">
          {scoreValue}
        </Badge>
      );
    }

    if (column.type === 'number') {
      const color = getValueColor(value);
      return (
        <Text c={color} fw={500}>
          {formatNumber(value)}
        </Text>
      );
    }

    return value ?? '-';
  };

  return (
    <Table.Tr>
      {columns.map((column) => (
        <Table.Td key={column.key}>
          {renderCell(column)}
        </Table.Td>
      ))}
    </Table.Tr>
  );
}
