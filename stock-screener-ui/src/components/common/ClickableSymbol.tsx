import { onCleanup, splitProps } from "solid-js";
import { useNavigate } from "@solidjs/router";
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
export function ClickableSymbol(props: ClickableSymbolProps) {
  const navigate = useNavigate();
  const { showPreviewChart, hidePreviewChart } = usePreviewChart();
  let closeTimer: number | null = null;

  const clearCloseTimer = () => {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
  };

  const handleClosePreview = () => {
    clearCloseTimer();
    hidePreviewChart();
  };

  const handleMouseEnter = (_symbol: string, e?: MouseEvent) => {
    if (!(props.showPreview ?? false)) return;
    if (!e) return;
    clearCloseTimer();
    showPreviewChart(e, props.symbol);
  };

  const handleMouseLeave = () => {
    if (!(props.showPreview ?? false)) return;
    clearCloseTimer();
    hidePreviewChart();
    closeTimer = window.setTimeout(() => {
      handleClosePreview();
    }, props.previewTimeout ?? 5000);
  };

  const handleTextClick = (sym: string, e: MouseEvent) => {
    if (props.stopClickPropagation ?? true) {
      e.stopPropagation();
    }
    handleClosePreview();
    if (props.onClick) {
      props.onClick(sym);
    } else {
      navigate(`/chart/${sym}`);
    }
  };

  onCleanup(clearCloseTimer);

  return (
    <SymbolLink
      symbol={props.symbol}
      tvLink={false}
      showChart={false}
      onTextClick={handleTextClick}
      onPreview={(props.showPreview ?? false) ? handleMouseEnter : undefined}
      onPreviewEnd={(props.showPreview ?? false) ? handleMouseLeave : undefined}
      testId={props.testId ?? `symbol-link-${props.symbol}`}
      textClassName="symbol-link"
      weight={props.fw ?? 600}
      size={(props.size ?? "sm") as "xs" | "sm" | "md"}
      stopPropagation={props.stopClickPropagation ?? true}
    />
  );
}