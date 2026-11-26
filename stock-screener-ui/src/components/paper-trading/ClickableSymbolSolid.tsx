import { Text } from "@/ui";
import { chartHrefForSymbol } from "@/components/common/symbolDockContext";
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
 * Renders a canonical label (option contracts collapse to one form) while the
 * raw symbol stays in the click payload and the tooltip. With no onClick the
 * chart route is built by the shared helper so feed decoration never reaches
 * the URL.
 */
export function ClickableSymbolSolid(props: ClickableSymbolSolidProps) {
  const testIdValue = () => props.testId ?? `symbol-link-${props.symbol}`;
  const stop = () => props.stopPropagation ?? true;
  const label = () => displayOptionSymbol(props.symbol);
  const chartHref = () => chartHrefForSymbol(resolveUnderlyingSymbol(props.symbol));

  const handleClick = (e: MouseEvent) => {
    if (stop()) e.stopPropagation();
    if (props.onClick) {
      props.onClick(props.symbol);
    } else if (typeof window !== "undefined") {
      window.location.assign(chartHref());
    }
  };

  return (
    <button
      type="button"
      class="symbol-link font-semibold text-sky-400 hover:underline focus:outline-none"
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
