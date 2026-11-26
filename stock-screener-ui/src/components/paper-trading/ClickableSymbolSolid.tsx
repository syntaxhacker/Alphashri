import { Text } from "@/ui";
import { chartHrefForSymbol, useSymbolDock } from "@/components/common/symbolDockContext";
import { displayOptionSymbol, resolveUnderlyingSymbol } from "./optionTradeUtils";

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
 * The canonical label collapses both option encodings while the raw contract
 * stays in the tooltip and click payload. An explicit `onClick` owns the action;
 * otherwise the app-wide dock charts the resolved underlying, and contexts
 * without a dock fall back to the shared `/chart/:symbol` route.
 */
export function ClickableSymbolSolid(props: ClickableSymbolSolidProps) {
  const dock = useSymbolDock();
  const testIdValue = () => props.testId ?? `symbol-link-${props.symbol}`;
  const stop = () => props.stopPropagation ?? true;
  const label = () => displayOptionSymbol(props.symbol);
  const chartHref = () => chartHrefForSymbol(resolveUnderlyingSymbol(props.symbol));
  // A real provider exposes `mode`; the inert default context does not.
  const dockAvailable = () => typeof dock.mode === "function";

  const handleClick = (e: MouseEvent) => {
    if (stop()) e.stopPropagation();
    if (props.onClick) {
      props.onClick(props.symbol);
      return;
    }
    if (dockAvailable()) {
      dock.open(resolveUnderlyingSymbol(props.symbol));
    } else if (typeof window !== "undefined") {
      location.assign(chartHref());
    }
  };

  return (
    <button
      type="button"
      class="symbol-link font-semibold text-sky-400 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-fin-primary)]"
      data-testid={testIdValue()}
      onClick={handleClick}
      title={props.symbol}
      aria-label={`Open chart for ${label()}`}
    >
      <Text span fw={props.fw ?? 600} size={props.size ?? "sm"} style={{ color: "inherit" }}>
        {label()}
      </Text>
    </button>
  );
}
