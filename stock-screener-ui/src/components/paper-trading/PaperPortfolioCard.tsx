import { Group, Text } from "@mantine/core";
import { getPnLTextColor } from "../../utils/ui-helpers";

function fmt(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_00_00_000) return `${(n / 1_00_00_000).toFixed(1)}Cr`;
  if (abs >= 1_00_000) return `${(n / 1_00_000).toFixed(1)}L`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toFixed(0);
}

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

export function PaperPortfolioCard({ portfolio }: PaperPortfolioCardProps) {
  if (!portfolio) {
    return (
      <Text c="dimmed" size="xs" data-testid="portfolio-card">
        Loading...
      </Text>
    );
  }

  const pnlColor = getPnLTextColor(portfolio.day_pnl);
  const pnlSign = portfolio.day_pnl >= 0 ? "+" : "";
  const available = portfolio.available_margin ?? portfolio.cash;

  return (
    <Group gap="xs" px={4} py={0} data-testid="portfolio-card" id="portfolio-card">
      <Text size="xs" c="dimmed">Val ₹{fmt(portfolio.total_value)}</Text>
      <Text size="xs" c="dimmed">Cash ₹{fmt(portfolio.cash)}</Text>
      <Text size="xs" c="dimmed">Mrgn ₹{fmt(portfolio.margin_used)}</Text>
      <Text size="xs" c={pnlColor} fw={500}>{pnlSign}₹{fmt(portfolio.day_pnl)}</Text>
    </Group>
  );
}
