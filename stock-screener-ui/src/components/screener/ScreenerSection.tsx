import type { JSX } from "solid-js";
import { CompactPanel } from "../common/compact";
import { ScreenerStockView } from "./ScreenerStockView";
import type { Stock } from "../../types";
import type { ColumnDef } from "./columns";

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
  section: string;
}

export function ScreenerSection(props: ScreenerSectionProps) {
  return (
    <CompactPanel
      title={props.title}
      description={props.description}
      testId={props.testId}
      action={props.action}
      scrollable
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
        section={props.section}
      />
    </CompactPanel>
  );
}