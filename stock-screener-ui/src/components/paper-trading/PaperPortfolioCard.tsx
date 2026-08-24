import { memo } from "react";
import { Text } from "@/ui";
import Box from "@mui/material/Box";
import { formatNumber, formatSignedPnl, getPnLTextColor } from "../../utils/ui-helpers";

export interface Portfolio {
  total_value: number;
  cash: number;
  margin_used: number;
  day_pnl: number;
  positions_count: number;
  available_margin?: number;
}

interface PaperPortfolioCardProps {
  portfolio: Portfolio | null;
}

export const PaperPortfolioCard = memo(function PaperPortfolioCard({ portfolio }: PaperPortfolioCardProps) {
  if (!portfolio) {
    return (
      <Text c="dimmed" size="xs" data-testid="portfolio-card">
        Loading...
      </Text>
    );
  }

  const pnlColor = getPnLTextColor(portfolio.day_pnl);

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1, py: 0.5, flexWrap: "wrap" }} data-testid="portfolio-card" id="portfolio-card">
      <Text size="xs" c="dimmed">Val ₹{formatNumber(portfolio.total_value)}</Text>
      <Text size="xs" c="dimmed">Cash ₹{formatNumber(portfolio.cash)}</Text>
      <Text size="xs" c="dimmed">Mrgn ₹{formatNumber(portfolio.margin_used)}</Text>
      <Text size="xs" c={pnlColor} fw={500}>{formatSignedPnl(portfolio.day_pnl)}</Text>
    </Box>
  );
});
