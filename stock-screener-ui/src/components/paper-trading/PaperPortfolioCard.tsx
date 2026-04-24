import { Group, Text, Badge, Progress } from "@mantine/core";
import { CompactPanel, CompactStat, CompactStatGrid } from "../common/compact";
import { formatCurrencyIN, getPnLTextColor } from "../../utils/ui-helpers";

export interface Portfolio {
  total_value: number;
  cash: number;
  margin_used: number;
  day_pnl: number;
  positions_count: number;
  max_daily_loss_pct?: number;
  daily_loss_limit_exceeded?: boolean;
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
      <Text c="dimmed" size="xs" data-testid="portfolio-card">
        Loading...
      </Text>
    );
  }

  const pnlColor = getPnLTextColor(portfolio.day_pnl);
  const pnlSign = portfolio.day_pnl >= 0 ? "+" : "";

  const showDailyLossLimit =
    portfolio.max_daily_loss_pct != null &&
    portfolio.max_daily_loss_pct > 0 &&
    portfolio.day_pnl < 0;

  const dailyLossPct =
    showDailyLossLimit && portfolio.max_daily_loss_pct
      ? Math.min(
          (Math.abs(portfolio.day_pnl) / (portfolio.max_daily_loss_pct * 100)) * 100,
          100,
        )
      : 0;

  const dailyLossBarColor =
    portfolio.daily_loss_limit_exceeded
      ? "red"
      : dailyLossPct >= 80
        ? "orange"
        : "gray";

  return (
    <CompactPanel data-testid="portfolio-card" className="paper-portfolio-card" id="portfolio-card">
      <CompactStatGrid spacing="xs">
        <CompactStat
          p="xs"
          labelSize="xs"
          valueSize="md"
          label="Total Value"
          value={`₹${formatCurrencyIN(portfolio.total_value)}`}
        />
        <CompactStat
          p="xs"
          labelSize="xs"
          valueSize="md"
          label="Cash"
          value={`₹${formatCurrencyIN(portfolio.cash)}`}
        />
        <CompactStat
          p="xs"
          labelSize="xs"
          valueSize="md"
          label="Margin Used"
          value={`₹${formatCurrencyIN(portfolio.margin_used)}`}
        />
        <CompactStat
          p="xs"
          labelSize="xs"
          valueSize="md"
          label="Day P&L"
          value={`${pnlSign}₹${formatCurrencyIN(portfolio.day_pnl)}`}
          tone={pnlColor}
        />
      </CompactStatGrid>

      {portfolio.daily_loss_limit_exceeded && (
        <Badge variant="filled" color="red" size="xs" mt={4} data-testid="daily-loss-halted">
          LOSS LIMIT
        </Badge>
      )}

      {showDailyLossLimit && (
        <Group gap="xs" mt={4} align="center">
          <Progress
            value={dailyLossPct}
            size="xs"
            radius="xl"
            color={dailyLossBarColor}
            style={{ flex: 1 }}
            data-testid="daily-loss-progress"
          />
          <Text size="xs" c={portfolio.daily_loss_limit_exceeded ? "red" : "dimmed"}>
            {dailyLossPct.toFixed(0)}% / {((portfolio.max_daily_loss_pct ?? 0) * 100).toFixed(0)}%
          </Text>
        </Group>
      )}

      {isMultiStrategy && strategySummaries.length > 0 && (
        <Group
          gap={4}
          mt="xs"
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
