import type { CSSProperties, ReactNode } from "react";
import { SymbolLink } from "@/components/common/SymbolLink";

export interface SymbolTvLinkProps {
  symbol: string;
  testId: string;
  children: ReactNode;
  /** Extra layout only (flex, padding) — the link skin stays shared. */
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
}

/**
 * Thin wrapper over SymbolLink for TradingView-only links (no chart icon).
 * Preserves the `pattern-tv-link` class and existing testId contract.
 */
export function SymbolTvLink({ symbol, testId, children, className, style, ariaLabel }: SymbolTvLinkProps) {
  return (
    <SymbolLink
      symbol={symbol}
      testId={testId}
      tvLink={true}
      showChart={false}
      tvIcon={false}
      className={className}
      style={style}
      textClassName="pattern-tv-link"
      stopPropagation={true}
      ariaLabel={ariaLabel}
    >
      {children}
    </SymbolLink>
  );
}
