import { Table, Anchor, Badge, Tooltip, Group, Text, ActionIcon, CopyButton } from "@mantine/core";
import { IconCopy, IconCheck } from "@tabler/icons-react";
import type { Stock } from "../../types";
import type { ColumnDef, FormattedCell } from "./columns";

declare global {
  interface Window {
    showPreviewChart?: (event: MouseEvent, symbol: string) => void;
    hidePreviewChart?: () => void;
    toggleExpandedChart?: (symbol: string) => void;
  }
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
  if (score >= 80) return "green";
  if (score >= 60) return "lime";
  if (score >= 40) return "yellow";
  if (score >= 20) return "orange";
  return "red";
}

function formatNumber(value: any): React.ReactNode {
  if (value === null || value === undefined) return "-";
  const num = typeof value === "number" ? value : parseFloat(value);
  if (isNaN(num)) return value;
  return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getValueColor(value: any): string | undefined {
  if (value === null || value === undefined) return undefined;
  const num = typeof value === "number" ? value : parseFloat(value);
  if (isNaN(num)) return undefined;
  if (num > 0) return "green";
  if (num < 0) return "red";
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
  const handleMouseEnter = (e: React.MouseEvent, symbol: string) => {
    onSymbolHover(symbol);
    window.showPreviewChart?.(e.nativeEvent, symbol);
  };

  const handleMouseLeave = () => {
    onSymbolHover(null);
    window.hidePreviewChart?.();
  };

  const handleClick = (symbol: string) => {
    window.hidePreviewChart?.();
    onSymbolClick(symbol);
  };

  const renderCell = (column: ColumnDef) => {
    const value = stock[column.key];

    if (column.format) {
      const formatted = column.format(value, stock);
      if (formatted && typeof formatted === "object" && "value" in formatted) {
        const cell = formatted as FormattedCell;
        return (
          <Text c={cell.className as any} fw={500}>
            {cell.value}
          </Text>
        );
      }
      return formatted;
    }

    if (column.key === "symbol") {
      return (
        <Group
          gap={4}
          wrap="nowrap"
          className="symbol-cell"
          data-testid={`symbol-cell-${stock.symbol}`}
        >
          <Tooltip label="Click for details">
            <Anchor
              component="button"
              type="button"
              onClick={() => handleClick(stock.symbol)}
              onMouseEnter={(e) => handleMouseEnter(e, stock.symbol)}
              onMouseLeave={handleMouseLeave}
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
                onClick={(e) => {
                  e.stopPropagation();
                  copy();
                }}
                className="copy-symbol-btn"
                data-testid={`copy-symbol-btn-${stock.symbol}`}
              >
                {copied ? <IconCheck size={10} /> : <IconCopy size={10} />}
              </ActionIcon>
            )}
          </CopyButton>
          {isTouched && (
            <Badge
              size="sm"
              variant="light"
              color="blue"
              className="touched-badge"
              data-testid={`touched-badge-${stock.symbol}`}
            >
              Touched
            </Badge>
          )}
        </Group>
      );
    }

    if (column.key === "score" || column.type === "badge") {
      const scoreValue = typeof value === "number" ? value : 0;
      return (
        <Badge
          color={getScoreColor(scoreValue)}
          variant="light"
          className="score-badge"
          data-testid={`score-badge-${stock.symbol}`}
        >
          {scoreValue}
        </Badge>
      );
    }

    if (column.type === "number") {
      const color = getValueColor(value);
      return (
        <Text
          c={color}
          fw={500}
          className="number-cell"
          data-testid={`number-cell-${stock.symbol}-${column.key}`}
        >
          {formatNumber(value)}
        </Text>
      );
    }

    return value ?? "-";
  };

  return (
    <Table.Tr
      id={`stock-row-${stock.symbol}`}
      className={`stock-row ${isTouched ? "touched" : "approaching"}`}
      data-testid={`stock-row-${stock.symbol}`}
    >
      {columns.map((column) => (
        <Table.Td
          key={column.key}
          className={`stock-cell cell-${column.key}`}
          data-testid={`cell-${stock.symbol}-${column.key}`}
        >
          {renderCell(column)}
        </Table.Td>
      ))}
    </Table.Tr>
  );
}
