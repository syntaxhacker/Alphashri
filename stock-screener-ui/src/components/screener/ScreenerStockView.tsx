import { ScreenerTable } from "./ScreenerTable";
import { ScreenerHeatmap } from "./ScreenerHeatmap";
import type { Stock, ColumnDef } from "../../types";

interface ScreenerStockViewProps {
  stocks: Stock[];
  columns: ColumnDef[];
  touchedSymbols: Set<string>;
  badgeLabel?: string;
  scoreFormula?: string;
  sortColumn: string;
  sortDirection: "asc" | "desc";
  onSortChange: (column: string) => void;
  onSymbolClick: (symbol: string) => void;
  onSymbolHover: (symbol: string | null) => void;
  viewMode: "table" | "heatmap";
  section: string;
  activeScreener: string;
}

export function ScreenerStockView({
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
  viewMode,
  section,
  activeScreener,
}: ScreenerStockViewProps) {
  if (viewMode === "heatmap") {
    return (
      <ScreenerHeatmap
        stocks={stocks}
        columns={columns}
        touchedSymbols={touchedSymbols}
        badgeLabel={badgeLabel}
        onSymbolClick={onSymbolClick}
        onSymbolHover={onSymbolHover}
        data-testid={`screener-heatmap-${section}`}
      />
    );
  }

  return (
    <ScreenerTable
      stocks={stocks}
      columns={columns}
      touchedSymbols={touchedSymbols}
      badgeLabel={badgeLabel}
      scoreFormula={scoreFormula}
      sortColumn={sortColumn}
      sortDirection={sortDirection}
      onSortChange={onSortChange}
      onSymbolClick={onSymbolClick}
      onSymbolHover={onSymbolHover}
      screenerType={activeScreener}
      data-testid={`screener-table-${section}`}
    />
  );
}
