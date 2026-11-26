import { Text } from "@/ui";
import { useSymbolDock } from "@/components/common/symbolDockContext";
import { resolveUnderlyingSymbol } from "./optionTradeUtils";

interface ClickableSymbolSolidProps {
  symbol: string;
  onClick?: (symbol: string) => void;
  testId?: string;
  fw?: number;
  size?: "xs" | "sm" | "md";
  stopPropagation?: boolean;
}

/**
 * Solid-native stand-in for the React ClickableSymbol/SymbolLink pair.
 * An explicit `onClick` owns the action (positions/watchlists select locally).
 * Without one, the symbol opens the app-wide chart dock; option contract
 * symbols resolve to their chartable underlying before reaching the dock.
 */
export function ClickableSymbolSolid(props: ClickableSymbolSolidProps) {
  const dock = useSymbolDock();
  const testIdValue = () => props.testId ?? `symbol-link-${props.symbol}`;
  const stop = () => props.stopPropagation ?? true;

  const handleClick = (e: MouseEvent) => {
    if (stop()) e.stopPropagation();
    if (props.onClick) {
      props.onClick(props.symbol);
      return;
    }
    dock.open(resolveUnderlyingSymbol(props.symbol));
  };

  return (
    <button
      type="button"
      class="symbol-link font-semibold text-sky-400 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-fin-primary)]"
      data-testid={testIdValue()}
      onClick={handleClick}
      aria-label={`Open chart for ${props.symbol}`}
    >
      <Text span fw={props.fw ?? 600} size={props.size ?? "sm"} style={{ color: "inherit" }}>
        {props.symbol}
      </Text>
    </button>
  );
}
