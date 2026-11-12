import { Show } from "solid-js";
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

export function ScreenerStockView(props: ScreenerStockViewProps) {
  return (
    <Show
      when={props.viewMode === "heatmap"}
      fallback={
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
      }
    >
      <ScreenerHeatmapView
        stocks={props.stocks}
        activeScreener={props.activeScreener}
        onSymbolClick={props.onSymbolClick}
        testId={`screener-heatmap-${props.section}`}
      />
    </Show>
  );
}
