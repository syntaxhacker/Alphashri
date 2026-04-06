import { Group, Text, Badge, Loader } from "@mantine/core";
import { CompactPanel, CompactStat, CompactStatGrid } from "../common/compact";
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


export function PaperPortfolioCard({
  portfolio,
  isMultiStrategy,
  strategySummaries,
}: PaperPortfolioCardProps) {
  if (!portfolio) {
    return (
      <Group justify="center" py="xs" data-testid="portfolio-card">
        <Loader size="xs" />
      </Group>
    );
  }

  const pnlColor = getPnLTextColor(portfolio.day_pnl);
  const pnlSign = portfolio.day_pnl >= 0 ? "+" : "";

  return (
    <CompactPanel data-testid="portfolio-card" className="paper-portfolio-card" id="portfolio-card">
      <CompactStatGrid>
        <CompactStat label="Total Value" value={`₹${formatCurrencyIN(portfolio.total_value)}`} />
        <CompactStat label="Cash" value={`₹${formatCurrencyIN(portfolio.cash)}`} />
        <CompactStat label="Margin Used" value={`₹${formatCurrencyIN(portfolio.margin_used)}`} />
        <CompactStat
          label="Day P&L"
          value={`${pnlSign}₹${formatCurrencyIN(portfolio.day_pnl)}`}
          tone={pnlColor}
        />
      </CompactStatGrid>

      <Group
        gap={6}
        mt="sm"
        align="center"
        data-testid="portfolio-row-2"
        className="portfolio-row"
        id="portfolio-row-2"
      >
        <Group gap={6} align="center">
          <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
            Positions
          </Text>
          <Badge variant="light" color="blue" size="sm">
            {portfolio.positions_count}
          </Badge>
        </Group>
      </Group>

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
    </CompactPanel>
  );
}
