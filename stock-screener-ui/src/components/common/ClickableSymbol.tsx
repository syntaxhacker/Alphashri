import { useRef, useCallback } from "react";
import { Anchor } from "@mantine/core";
import { useNavigate } from "react-router-dom";
import { usePreviewChart } from "./PreviewChartProvider";

interface ClickableSymbolProps {
  symbol: string;
  fw?: number;
  size?: string;
  showPreview?: boolean;
  previewTimeout?: number;
  onClick?: (symbol: string) => void;
}

export function ClickableSymbol({
  symbol,
  fw = 600,
  size = "sm",
  showPreview = false,
  previewTimeout = 5000,
  onClick,
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

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    handleClosePreview();
    if (onClick) {
      onClick(symbol);
    } else {
      navigate(`/chart/${symbol}`);
    }
  };

  return (
    <Anchor
      component="button"
      type="button"
      size={size}
      fw={fw}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className="symbol-link"
    >
      {symbol}
    </Anchor>
  );
}
