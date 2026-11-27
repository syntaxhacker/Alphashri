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
  tableId?: string;
}

// The description slot is hidden below `sm`: on a narrow viewport a long real
// description (e.g. the 52w_high secondary, ~102 chars) wraps to two lines and
// shifts the table, while a profile with no description reserves one nbsp line.
// Collapsing the whole slot to title-only height at <sm makes every definition
// identical there; >=sm keeps the one-line reservation and the 24px band.
const RESERVED_DESCRIPTION_LINE = "\u00a0";
const DESCRIPTION_SLOT_CLASS = "hidden sm:block";

export function ScreenerSection(props: ScreenerSectionProps) {
  return (
    <CompactPanel
      title={props.title}
      titleClassName="max-sm:truncate"
      description={
        <span class={DESCRIPTION_SLOT_CLASS}>
          {props.description || RESERVED_DESCRIPTION_LINE}
        </span>
      }
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
        tableId={props.tableId}
      />
    </CompactPanel>
  );
}
