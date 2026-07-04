import React, { useCallback, memo } from "react";

import {
  Table,
  Anchor,
  Badge,
  Tooltip,
  Group,
  Text,
  ActionIcon,
  CopyButton,
  Checkbox,
} from "@/ui";
import { IconCopy, IconCheck } from "@tabler/icons-react";
import type { Stock } from "../../types";
import type { ColumnDef, FormattedCell } from "./columns";
import { getValueColor, getScoreColor, formatNumber } from "../../utils/ui-helpers";
import { usePreviewChart } from "../common/PreviewChartProvider";
import { toggleSymbolSelection, selectedSymbols } from "../../state";

interface StockRowProps {
  stock: Stock;
  columns: ColumnDef[];
  isTouched: boolean;
  badgeLabel?: string;
  scoreFormula?: string;
  onSymbolClick: (symbol: string) => void;
  onSymbolHover: (symbol: string | null) => void;
}

export const StockRow = memo(function StockRow({
  stock,
  columns,
  isTouched,
  badgeLabel,
  scoreFormula,
  onSymbolClick,
  onSymbolHover,
}: StockRowProps) {
  const { showPreviewChart, hidePreviewChart } = usePreviewChart();

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent, symbol: string) => {
      onSymbolHover(symbol);
      showPreviewChart(e, symbol);
    },
    [onSymbolHover, showPreviewChart],
  );

  const handleMouseLeave = useCallback(() => {
    onSymbolHover(null);
    hidePreviewChart();
  }, [onSymbolHover, hidePreviewChart]);

  const handleClick = useCallback(
    (symbol: string) => {
      hidePreviewChart();
      onSymbolClick(symbol);
    },
    [hidePreviewChart, onSymbolClick],
  );

  const handleSymbolClick = useCallback(() => {
    handleClick(stock.symbol);
  }, [handleClick, stock.symbol]);

  const handleSymbolMouseEnter = useCallback(
    (e: React.MouseEvent) => {
      handleMouseEnter(e, stock.symbol);
    },
    [handleMouseEnter, stock.symbol],
  );

  const handleCheckboxChange = useCallback(() => {
    toggleSymbolSelection(stock.symbol);
  }, [stock.symbol]);

  const handleCheckboxClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  const renderCell = useCallback((column: ColumnDef) => {
    const value = stock[column.key];

    if (column.format) {
      const formatted = column.format(value, stock);
      if (
        formatted !== null &&
        formatted !== undefined &&
        typeof formatted === "object" &&
        "value" in (formatted as FormattedCell)
      ) {
        const cell = formatted as FormattedCell;
        return (
          <Text c={cell.className as any} fw={500}>
            {cell.value}
          </Text>
        );
      }
      if (formatted !== null && formatted !== undefined) {
        return formatted;
      }
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
              onClick={handleSymbolClick}
              onMouseEnter={handleSymbolMouseEnter}
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
          {isTouched && badgeLabel ? (
            <Badge
              size="sm"
              variant="light"
              color="blue"
              className="touched-badge"
              data-testid={`touched-badge-${stock.symbol}`}
            >
              {badgeLabel}
            </Badge>
          ) : null}
        </Group>
      );
    }

    if (column.key === "score" || column.type === "badge") {
      const scoreValue = typeof value === "number" ? value : 0;
      return (
        <Tooltip
          label={scoreFormula ? `${scoreFormula} = ${scoreValue}` : `Score: ${scoreValue}`}
          multiline
          w={300}
          withinPortal
        >
          <Badge
            color={getScoreColor(scoreValue)}
            variant="light"
            className="score-badge"
            data-testid={`score-badge-${stock.symbol}`}
          >
            {scoreValue}
          </Badge>
        </Tooltip>
      );
    }

    if (column.type === "number") {
      if (value === undefined || value === null || isNaN(value)) {
        return <Text c="dimmed" data-testid={`number-cell-${stock.symbol}-${column.key}`}>-</Text>;
      }
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
  }, [stock, isTouched, badgeLabel, scoreFormula, handleClick, handleMouseEnter, handleMouseLeave]);

  return (
    <Table.Tr
      id={`stock-row-${stock.symbol}`}
      className={`stock-row ${isTouched ? "touched" : "approaching"}`}
      data-testid={`stock-row-${stock.symbol}`}
    >
      <Table.Td style={{ width: 40 }} data-testid={`sel-cell-${stock.symbol}`}>
        <Checkbox
          size="xs"
          checked={selectedSymbols.includes(stock.symbol)}
          onChange={handleCheckboxChange}
          data-testid={`sel-checkbox-${stock.symbol}`}
          onClick={handleCheckboxClick}
        />
      </Table.Td>
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
});
