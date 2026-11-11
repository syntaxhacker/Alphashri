import { useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { usePreviewChart } from "./PreviewChartProvider";
import { SymbolLink } from "./SymbolLink";

interface ClickableSymbolProps {
  symbol: string;
  fw?: number;
  size?: string;
  showPreview?: boolean;
  previewTimeout?: number;
  onClick?: (symbol: string) => void;
  stopClickPropagation?: boolean;
  /** Test id for the symbol button (default `symbol-link-<SYMBOL>`). */
  testId?: string;
}

/**
 * Thin wrapper over SymbolLink for clickable symbol buttons in tables.
 * - Symbol text is a button (not a TradingView link) that navigates or calls onClick.
 * - Hover preview via PreviewChartProvider (host/dock) when mounted, falls back to no-op.
 * - Preserves `.symbol-link` class and `data-testid`/`symbol-link-<symbol>` e2e contracts.
 * - Keeps `stopClickPropagation` and 5s close timer behaviour for backward compat.
 */
export function ClickableSymbol({
  symbol,
  fw = 600,
  size = "sm",
  showPreview = false,
  previewTimeout = 5000,
  onClick,
  stopClickPropagation = true,
  testId,
}: ClickableSymbolProps) {
  const navigate = useNavigate();
  const { showPreviewChart, hidePreviewChart } = usePreviewChart();
  const closeTimerRef = useRef<number | null>(null);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const handleClosePreview = useCallback(() => {
    clearCloseTimer();
    hidePreviewChart();
  }, [clearCloseTimer, hidePreviewChart]);

  const handleMouseEnter = (e: React.MouseEvent) => {
    if (!showPreview) return;
    clearCloseTimer();
    showPreviewChart(e, symbol);
  };

  const handleMouseLeave = () => {
    if (!showPreview) return;
    clearCloseTimer();
    hidePreviewChart();
    closeTimerRef.current = window.setTimeout(() => {
      handleClosePreview();
    }, previewTimeout);
  };

  const handleTextClick = (sym: string, e: React.MouseEvent) => {
    if (stopClickPropagation) {
      e.stopPropagation();
    }
    handleClosePreview();
    if (onClick) {
      onClick(sym);
    } else {
      navigate(`/chart/${sym}`);
    }
  };

  const testIdValue = testId ?? `symbol-link-${symbol}`;

  return (
    <SymbolLink
      symbol={symbol}
      tvLink={false}
      showChart={false}
      onTextClick={handleTextClick}
      onPreview={showPreview ? handleMouseEnter : undefined}
      onPreviewEnd={showPreview ? handleMouseLeave : undefined}
      testId={testIdValue}
      textClassName="symbol-link"
      weight={fw}
      size={size as "xs" | "sm" | "md"}
      stopPropagation={stopClickPropagation}
    />
  );
}