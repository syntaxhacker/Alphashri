import { Group, Text, Badge } from "@mantine/core";
import { formatCurrencyIN, getPnLTextColor } from "../../utils/ui-helpers";

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

function StatItem({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <Group gap={4}>
      <Text size="xs" c="dimmed" tt="uppercase">
        {label}
      </Text>
      <Text size="xs" fw={700} c={tone}>
        {value}
      </Text>
    </Group>
  );
}

export function PaperPortfolioCard({
  portfolio,
  isMultiStrategy,
  strategySummaries,
}: PaperPortfolioCardProps) {
  if (!portfolio) {
    return (
      <Text c="dimmed" size="xs" data-testid="portfolio-card">
        Loading...
      </Text>
    );
  }

  const pnlColor = getPnLTextColor(portfolio.day_pnl);
  const pnlSign = portfolio.day_pnl >= 0 ? "+" : "";

  return (
    <Group
      gap="sm"
      wrap="wrap"
      px={2}
      py={4}
      data-testid="portfolio-card"
      className="paper-portfolio-card"
      id="portfolio-card"
    >
      <StatItem label="Value" value={`₹${formatCurrencyIN(portfolio.total_value)}`} />
      <StatItem label="Cash" value={`₹${formatCurrencyIN(portfolio.cash)}`} />
      <StatItem label="Margin" value={`₹${formatCurrencyIN(portfolio.margin_used)}`} />
      <StatItem
        label="P&L"
        value={`${pnlSign}₹${formatCurrencyIN(portfolio.day_pnl)}`}
        tone={pnlColor}
      />
      <Badge variant="light" color="blue" size="xs" ml="auto">
        {portfolio.positions_count} pos
      </Badge>

      {isMultiStrategy && strategySummaries.length > 0 && (
        <Group
          gap={4}
          data-testid="strategy-summaries"
          className="portfolio-strategies"
          id="strategy-summaries"
        >
          {strategySummaries.map((summary) => (
            <Badge
              key={summary.strategy_name}
              variant="light"
              color={getPnLTextColor(summary.pnl)}
              size="xs"
              data-testid={`strategy-badge-${summary.strategy_name}`}
            >
              {summary.strategy_name}: {summary.pnl >= 0 ? "+" : ""}₹{formatCurrencyIN(summary.pnl)}
            </Badge>
          ))}
        </Group>
      )}
    </Group>
  );
}
