import { ScreenerTable } from "./ScreenerTable";
import { ScreenerHeatmapView } from "./ScreenerHeatmapView";
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
      <ScreenerHeatmapView
        stocks={stocks}
        activeScreener={activeScreener}
        onSymbolClick={onSymbolClick}
        testId={`screener-heatmap-${section}`}
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
