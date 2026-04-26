import { Box, Card, Text, Button, Group, Stack, Grid } from "@mantine/core";
import { IconRefresh, IconPlayerPlay, IconPlayerStop } from "@tabler/icons-react";
import type { BotConfig, BotStatus, BotTrade } from "../../types/bots";
import { loadBotStatus, loadBotTrades, startAutoRefresh, stopAutoRefresh } from "../../state/bots";
import { StatusBadge } from "../common/BadgeComponents";
import {
  PortfolioSummaryCard,
  StrategyStatusCard,
  PositionsTable,
  TradesTable,
} from "./BotHelpers";

interface BotStatusPanelProps {
  bot: BotConfig;
  status: BotStatus | null;
  trades: BotTrade[];
  onStart: (botId: string) => Promise<void>;
  onStop: (botId: string) => Promise<void>;
}

export function BotStatusPanel({ bot, status, trades, onStart, onStop }: BotStatusPanelProps) {
  const handleRefresh = async () => {
    await Promise.all([loadBotStatus(bot.id), loadBotTrades(bot.id)]);
  };

  const handleStart = async () => {
    await onStart(bot.id);
    await loadBotStatus(bot.id);
    await loadBotTrades(bot.id);
    startAutoRefresh(bot.id, 5000);
  };

  const handleStop = async () => {
    await onStop(bot.id);
    stopAutoRefresh();
    await loadBotStatus(bot.id);
  };

  const handleRefreshTrades = async () => {
    await loadBotTrades(bot.id);
  };

  return (
    <Box
      data-testid="bot-status-panel"
      data-bot-id={bot.id}
      id="bot-status-panel"
      className="bot-status-panel"
    >
      <Stack gap="sm">
        <Card
          shadow="sm"
          padding="sm"
          radius="md"
          withBorder
          id="bot-header-card"
          data-testid="bot-header-card"
        >
          <Group justify="space-between">
            <Stack gap={4}>
              <Text fw={700} size="lg" data-testid="bot-name">
                {bot.name}
              </Text>
              <StatusBadge
                running={status?.running ?? false}
                pid={status?.pid ?? undefined}
                statusUnknown={status?.status === "unknown"}
                data-testid="bot-running-badge"
              />
            </Stack>
            <Group gap="xs">
              {status?.running ? (
                <Button
                  leftSection={<IconPlayerStop size={16} />}
                  variant="light"
                  color="orange"
                  onClick={handleStop}
                  data-testid="stop-bot-btn"
                >
                  Stop Bot
                </Button>
              ) : (
                <Button
                  leftSection={<IconPlayerPlay size={16} />}
                  variant="light"
                  color="green"
                  onClick={handleStart}
                  data-testid="start-bot-btn"
                >
                  Start Bot
                </Button>
              )}
              <Button
                leftSection={<IconRefresh size={16} />}
                variant="subtle"
                onClick={handleRefresh}
                data-testid="refresh-bot-status-btn"
              >
                Refresh
              </Button>
            </Group>
          </Group>
        </Card>

        {status?.portfolio ? (
          <PortfolioSummaryCard portfolio={status.portfolio} />
        ) : (
          <Card
            shadow="sm"
            padding="sm"
            radius="md"
            withBorder
            id="portfolio-placeholder"
            data-testid="portfolio-placeholder"
          >
            <Text c="dimmed" ta="center">
              Start the bot to see live portfolio data
            </Text>
          </Card>
        )}

        {status?.strategies && (
          <Stack gap={0} data-testid="strategies-status">
            <Text fw={600} mb="sm">
              Strategy Status
            </Text>
            <Grid>
              {Object.values(status.strategies).map((s) => (
                <Grid.Col key={s.strategy_id} span={{ base: 12, sm: 6, md: 4 }}>
                  <StrategyStatusCard strategy={s} isRunning={status?.running ?? false} />
                </Grid.Col>
              ))}
            </Grid>
          </Stack>
        )}

        {status?.positions && status.positions.length > 0 && (
          <PositionsTable positions={status.positions} />
        )}

        <TradesTable trades={trades} onRefresh={handleRefreshTrades} />

        {status?.last_update && (
          <Text size="sm" c="dimmed" ta="center" data-testid="bot-last-update">
            Last update: {new Date(status.last_update).toLocaleTimeString()}
          </Text>
        )}
      </Stack>
    </Box>
  );
}
