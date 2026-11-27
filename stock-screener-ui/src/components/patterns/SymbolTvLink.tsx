import type { JSX } from "solid-js";
import { SymbolLink } from "@/components/common/SymbolLink";

type CSSProperties = JSX.CSSProperties;

export interface SymbolTvLinkProps {
  symbol: string;
  testId: string;
  children: JSX.Element;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
  showCopy?: boolean;
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
      showCopy={props.showCopy}
    >
      {props.children}
    </SymbolLink>
  );
}
