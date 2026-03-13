import { Card, Group, Text, SimpleGrid, Badge } from "@mantine/core";

export interface Portfolio {
  total_value: number;
  cash: number;
  margin_used: number;
  day_pnl: number;
  positions_count: number;
}

export interface StrategySummary {
  strategy_name: string;
  pnl: number;
  positions: number;
}

interface PaperPortfolioCardProps {
  portfolio: Portfolio | null;
  isMultiStrategy: boolean;
  strategySummaries: StrategySummary[];
}

function formatCurrency(value: number | undefined | null): string {
  if (value === undefined || value === null || isNaN(value)) return "0";
  return value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export function PaperPortfolioCard({
  portfolio,
  isMultiStrategy,
  strategySummaries,
}: PaperPortfolioCardProps) {
  if (!portfolio) {
    return (
      <Card shadow="sm" padding="md" radius="md" withBorder data-testid="portfolio-card" className="paper-portfolio-card" id="portfolio-card">
        <Text c="dimmed" ta="center">
          Loading portfolio...
        </Text>
      </Card>
    );
  }

  const pnlColor = portfolio.day_pnl >= 0 ? "green" : "red";
  const pnlSign = portfolio.day_pnl >= 0 ? "+" : "";

  return (
    <Card shadow="sm" padding="md" radius="md" withBorder data-testid="portfolio-card" className="paper-portfolio-card" id="portfolio-card">
      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md" data-testid="portfolio-row-1" className="portfolio-row" id="portfolio-row-1">
        <Group gap="xs">
          <Text size="sm" c="dimmed">
            Total Value
          </Text>
          <Text size="md" fw={600}>
            ₹{formatCurrency(portfolio.total_value)}
          </Text>
        </Group>
        <Group gap="xs">
          <Text size="sm" c="dimmed">
            Cash
          </Text>
          <Text size="md" fw={600}>
            ₹{formatCurrency(portfolio.cash)}
          </Text>
        </Group>
        <Group gap="xs">
          <Text size="sm" c="dimmed">
            Margin Used
          </Text>
          <Text size="md" fw={600}>
            ₹{formatCurrency(portfolio.margin_used)}
          </Text>
        </Group>
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md" mt="md" data-testid="portfolio-row-2" className="portfolio-row" id="portfolio-row-2">
        <Group gap="xs">
          <Text size="sm" c="dimmed">
            Day P&L
          </Text>
          <Text size="md" fw={600} c={pnlColor}>
            {pnlSign}₹{formatCurrency(portfolio.day_pnl)}
          </Text>
        </Group>
        <Group gap="xs">
          <Text size="sm" c="dimmed">
            Positions
          </Text>
          <Badge variant="light" color="blue">
            {portfolio.positions_count}
          </Badge>
        </Group>
      </SimpleGrid>

      {isMultiStrategy && strategySummaries.length > 0 && (
        <Group gap="xs" mt="md" data-testid="strategy-summaries" className="portfolio-strategies" id="strategy-summaries">
          {strategySummaries.map((summary) => (
            <Badge
              key={summary.strategy_name}
              variant="outline"
              color={summary.pnl >= 0 ? "green" : "red"}
              data-testid={`strategy-badge-${summary.strategy_name}`}
            >
              {summary.strategy_name}: {summary.pnl >= 0 ? "+" : ""}₹{formatCurrency(summary.pnl)}
            </Badge>
          ))}
        </Group>
      )}
    </Card>
  );
}
