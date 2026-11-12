import type { CSSProperties, JSX } from "solid-js";
import { SymbolLink } from "@/components/common/SymbolLink";

export interface SymbolTvLinkProps {
  symbol: string;
  testId: string;
  children: JSX.Element;
  /** Extra layout only (flex, padding) — the link skin stays shared. */
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
}

/**
 * Thin wrapper over SymbolLink for TradingView-only links (no chart icon).
 * Preserves the `pattern-tv-link` class and existing testId contract.
 */
export function SymbolTvLink(props: SymbolTvLinkProps) {
  return (
    <SymbolLink
      symbol={props.symbol}
      testId={props.testId}
      tvLink={true}
      showChart={false}
      tvIcon={false}
      className={props.className}
      style={props.style}
      textClassName="pattern-tv-link"
      stopPropagation={true}
      ariaLabel={props.ariaLabel}
    >
      {props.children}
    </SymbolLink>
  );
}
