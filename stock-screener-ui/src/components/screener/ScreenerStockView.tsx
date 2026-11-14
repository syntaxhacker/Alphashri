import { ScreenerTable } from "./ScreenerTable";
import type { Stock } from "../../types";
import type { ColumnDef } from "./columns";

interface ScreenerStockViewProps {
  stocks: Stock[];
  columns: ColumnDef[];
  touchedSymbols: Set<string>;
  badgeLabel?: string;
  scoreFormula?: string;
  onSymbolClick: (symbol: string) => void;
  onSymbolHover: (symbol: string | null) => void;
  section: string;
}

export function ScreenerStockView(props: ScreenerStockViewProps) {
  return (
    <ScreenerTable
      stocks={props.stocks}
      columns={props.columns}
      touchedSymbols={props.touchedSymbols}
      badgeLabel={props.badgeLabel}
      scoreFormula={props.scoreFormula}
      onSymbolClick={props.onSymbolClick}
      onSymbolHover={props.onSymbolHover}
      testId={`screener-table-${props.section}`}
    />
  );
}