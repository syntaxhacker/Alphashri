import { Text } from "@/ui";

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
 * Renders the symbol as a button (hover preview is a React-context feature
 * and has no Solid equivalent yet — preview is a no-op here). When no
 * onClick is supplied, a full-page navigation to /chart/<symbol> is used so
 * the app works before the Solid router lands.
 */
export function ClickableSymbolSolid(props: ClickableSymbolSolidProps) {
  const testIdValue = () => props.testId ?? `symbol-link-${props.symbol}`;
  const stop = () => props.stopPropagation ?? true;

  const handleClick = (e: MouseEvent) => {
    if (stop()) e.stopPropagation();
    if (props.onClick) {
      props.onClick(props.symbol);
    } else if (typeof window !== "undefined") {
      window.location.assign(`/chart/${props.symbol}`);
    }
  };

  return (
    <button
      type="button"
      class="symbol-link font-semibold text-sky-400 hover:underline focus:outline-none"
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
