import { ScreenerTable } from "./ScreenerTable";
import { ScreenerHeatmapView } from "./ScreenerHeatmapView";
import type { Stock, ColumnDef } from "../../types";

interface ScreenerStockViewProps {
  stocks: Stock[];
  columns: ColumnDef[];
  touchedSymbols: Set<string>;
  badgeLabel?: string;
  scoreFormula?: string;
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
      onSymbolClick={onSymbolClick}
      onSymbolHover={onSymbolHover}
      data-testid={`screener-table-${section}`}
    />
  );
}
