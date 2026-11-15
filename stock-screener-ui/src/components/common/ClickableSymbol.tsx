import { useNavigate } from "@solidjs/router";
import { useSymbolDock } from "./symbolDockContext";
import { SymbolLink } from "./SymbolLink";

interface ClickableSymbolProps {
  symbol: string;
  fw?: number;
  size?: string;
  /** @deprecated hover no longer opens a preview. */
  showPreview?: boolean;
  /** @deprecated the dock owns preview dismissal. */
  previewTimeout?: number;
  onClick?: (symbol: string) => void;
  stopClickPropagation?: boolean;
  /** Test id for the symbol button (default `symbol-link-<SYMBOL>`). */
  testId?: string;
}

/** Symbol button for tables: click navigates; hover does nothing. */
export function ClickableSymbol(props: ClickableSymbolProps) {
  const navigate = useNavigate();
  const dock = useSymbolDock();

  const handleTextClick = (sym: string, e: MouseEvent) => {
    if (props.stopClickPropagation ?? true) {
      e.stopPropagation();
    }
    dock.endPreview();
    if (props.onClick) {
      props.onClick(sym);
    } else {
      navigate(`/chart/${sym}`);
    }
  };

  return (
    <SymbolLink
      symbol={props.symbol}
      tvLink={false}
      showChart={false}
      onTextClick={handleTextClick}
      testId={props.testId ?? `symbol-link-${props.symbol}`}
    />
  );
}
