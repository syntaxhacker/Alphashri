import { CompactPanel } from "../common/compact";
import { ScreenerStockView } from "./ScreenerStockView";
import type { Stock, ColumnDef } from "../../types";

interface ScreenerSectionProps {
  title: string;
  description: string;
  testId: string;
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

export function ScreenerSection({
  title,
  description,
  testId,
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
}: ScreenerSectionProps) {
  return (
    <CompactPanel
      title={title}
      description={viewMode === "heatmap" ? undefined : description}
      testId={testId}
      scrollable={viewMode !== "heatmap"}
    >
      <ScreenerStockView
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
        viewMode={viewMode}
        section={section}
        activeScreener={activeScreener}
      />
    </CompactPanel>
  );
}
