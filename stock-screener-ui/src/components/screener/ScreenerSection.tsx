import type { JSX } from "solid-js";
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
  action?: JSX.Element;
  onSymbolClick: (symbol: string) => void;
  onSymbolHover: (symbol: string | null) => void;
  viewMode: "table" | "heatmap";
  section: string;
  activeScreener: string;
}

export function ScreenerSection(props: ScreenerSectionProps) {
  return (
    <CompactPanel
      title={props.title}
      description={props.viewMode === "heatmap" ? undefined : props.description}
      testId={props.testId}
      action={props.action}
      scrollable={props.viewMode !== "heatmap"}
      padded={false}
    >
      <ScreenerStockView
        stocks={props.stocks}
        columns={props.columns}
        touchedSymbols={props.touchedSymbols}
        badgeLabel={props.badgeLabel}
        scoreFormula={props.scoreFormula}
        onSymbolClick={props.onSymbolClick}
        onSymbolHover={props.onSymbolHover}
        viewMode={props.viewMode}
        section={props.section}
        activeScreener={props.activeScreener}
      />
    </CompactPanel>
  );
}
