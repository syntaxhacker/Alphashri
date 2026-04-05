import { Card, Text, Grid, Stack } from "@mantine/core";
import type { PortfolioSummary } from "../../../types/bots";
import { formatNumber as formatNumberShared, getPnLTextColor } from "../../../utils/ui-helpers";

export function PortfolioSummaryCard({ portfolio }: { portfolio: PortfolioSummary }) {
  const pnlColor = getPnLTextColor(portfolio.total_pnl);

  return (
    <Card shadow="sm" padding="md" radius="md" withBorder data-testid="portfolio-summary">
      <Text fw={600} mb="sm">
        Portfolio Summary
      </Text>
      <Grid>
        <Grid.Col span={6}>
          <Stack gap="xs">
            <Stack gap={0}>
              <Text size="sm" c="dimmed">
                Capital
              </Text>
              <Text fw={600}>₹{formatNumberShared(portfolio.initial_capital)}</Text>
            </Stack>
            <Stack gap={0}>
              <Text size="sm" c="dimmed">
                Cash
              </Text>
              <Text fw={600}>₹{formatNumberShared(portfolio.cash)}</Text>
            </Stack>
          </Stack>
        </Grid.Col>
        <Grid.Col span={6}>
          <Stack gap="xs">
            <Stack gap={0}>
              <Text size="sm" c="dimmed">
                Positions
              </Text>
              <Text fw={600}>{portfolio.total_positions}</Text>
            </Stack>
            <Stack gap={0}>
              <Text size="sm" c="dimmed">
                Total P&L
              </Text>
              <Text fw={600} c={pnlColor}>
                {portfolio.total_pnl >= 0 ? "+" : ""}₹{formatNumberShared(portfolio.total_pnl)}
                <Text span size="sm" ml={4}>
                  ({portfolio.total_pnl_pct >= 0 ? "+" : ""}
                  {portfolio.total_pnl_pct.toFixed(2)}%)
                </Text>
              </Text>
            </Stack>
          </Stack>
        </Grid.Col>
      </Grid>
    </Card>
  );
}
