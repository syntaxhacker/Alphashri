import { Anchor } from "@mantine/core";
import { useNavigate } from "react-router-dom";
import { usePreviewChart } from "./PreviewChartProvider";

interface ClickableSymbolProps {
  symbol: string;
  fw?: number;
  size?: string;
  showPreview?: boolean;
  onClick?: (symbol: string) => void;
}

export function ClickableSymbol({
  symbol,
  fw = 600,
  size = "sm",
  showPreview = false,
  onClick,
}: ClickableSymbolProps) {
  const navigate = useNavigate();
  const { showPreviewChart, hidePreview } = usePreviewChart();

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
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
      onMouseEnter={showPreview ? (e) => showPreviewChart(e, symbol) : undefined}
      onMouseLeave={showPreview ? hidePreview : undefined}
      className="symbol-link"
    >
      {symbol}
    </Anchor>
  );
}
