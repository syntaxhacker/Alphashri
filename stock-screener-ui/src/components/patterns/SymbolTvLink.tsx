import type { ReactNode } from "react";
import { SymbolLink } from "@/components/common/SymbolLink";

export interface SymbolTvLinkProps {
  symbol: string;
  testId: string;
  children: ReactNode;
  /** Extra layout only (flex, padding) — the link skin stays shared. */
  sx?: Record<string, unknown>;
  ariaLabel?: string;
}

/**
 * Thin wrapper over SymbolLink for TradingView-only links (no chart icon).
 * Preserves the `pattern-tv-link` class and existing testId contract.
 */
export function SymbolTvLink({ symbol, testId, children, sx }: SymbolTvLinkProps) {
  return (
    <SymbolLink
      symbol={symbol}
      testId={testId}
      tvLink={true}
      showChart={false}
      tvIcon={false}
      sx={sx}
      textClassName="pattern-tv-link"
      stopPropagation={true}
    >
      {children}
    </SymbolLink>
  );
}