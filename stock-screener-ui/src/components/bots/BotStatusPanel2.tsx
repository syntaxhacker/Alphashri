import { Box, Card, Text, Button, Group, Stack, SimpleGrid, Badge, Tooltip } from "@/ui";
import { IconRefresh, IconPlayerPlay, IconPlayerStop } from "@tabler/icons-react";
import type { BotConfig, BotStatus, BotTrade } from "../../types/bots";
import { loadBotStatus, loadBotTrades } from "../../state/bots";
import { StatusBadge } from "../common/BadgeComponents";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import { subscribeToHolidays, isMarketClosedToday } from "../../state/holidays";
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
  useStoreSubscription(subscribeToHolidays);
  const marketClosed = isMarketClosedToday();

  const handleRefresh = async () => {
    await Promise.all([loadBotStatus(bot.id), loadBotTrades(bot.id)]);
  };

  const handleStart = async () => {
    await onStart(bot.id);
    await loadBotStatus(bot.id);
    await loadBotTrades(bot.id);
  };

  const handleStop = async () => {
    await onStop(bot.id);
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
      <Stack spacing={1} gap="sm" className="gap-2 p-2">
        <Card
          elevation={1}
          padding="sm"
          radius="sm"
          id="bot-header-card"
          data-testid="bot-header-card"
          className="p-2"
        >
          <Box className="flex items-center justify-between gap-2 p-2">
            <Stack gap={1} className="gap-2">
              <Text fw={700} size="lg" c="primary.main" data-testid="bot-name">
                {bot.name}
              </Text>
              <Group gap={1} align="center" className="flex items-center gap-2">
                <StatusBadge
                  running={status?.running ?? false}
                  pid={status?.pid ?? undefined}
                  statusUnknown={status?.status === "unknown"}
                  data-testid="bot-running-badge"
                />
                {bot.live_trading ? (
                  <Badge color="error" variant="filled" size="sm" data-testid="live-trading-badge">
                    LIVE
                  </Badge>
                ) : (
                  <Badge color="success" variant="filled" size="sm" data-testid="paper-trading-badge">
                    PAPER
                  </Badge>
                )}
              </Group>
            </Stack>
            <Group gap={1} align="center" className="flex items-center gap-2">
              {status?.running ? (
                <Button
                  leftSection={<IconPlayerStop size={16} />}
                  variant="filled"
                  color="error"
                  onClick={handleStop}
                  data-testid="stop-bot-btn"
                >
                  Stop Bot
                </Button>
              ) : (
                <Tooltip
                  label="Market closed — cannot start bot"
                  disabled={!marketClosed}
                >
                  <span>
                    <Button
                      leftSection={<IconPlayerPlay size={16} />}
                      variant="filled"
                      color="success"
                      onClick={handleStart}
                      disabled={marketClosed}
                      data-testid="start-bot-btn"
                    >
                      Start Bot
                    </Button>
                  </span>
                </Tooltip>
              )}
              <Button
                leftSection={<IconRefresh size={16} />}
                variant="light"
                color="secondary"
                onClick={handleRefresh}
                data-testid="refresh-bot-status-btn"
              >
                Refresh
              </Button>
            </Group>
          </Box>
        </Card>

        {status?.portfolio ? (
          <PortfolioSummaryCard portfolio={status.portfolio} />
        ) : (
          <Card
            elevation={1}
            padding="sm"
            radius="md"
            id="portfolio-placeholder"
            data-testid="portfolio-placeholder"
            className="p-2"
          >
            <Box className="flex items-center justify-center p-2">
              <Text c="dimmed" ta="center">
                Start the bot to see live portfolio data
              </Text>
            </Box>
          </Card>
        )}

        {status?.strategies && (
          <Stack spacing={1} gap={0} data-testid="strategies-status" className="gap-2 p-2">
            <Group gap={1} align="center" mb="sm" className="flex items-center gap-2 p-2">
              <Box w={4} h={20} className="rounded-sm bg-fin-text-muted" />
              <Text fw={600} size="sm">
                Strategy Status
              </Text>
              <Badge size="sm" variant="light" color="secondary">
                {Object.keys(status.strategies).length}
              </Badge>
            </Group>
            <SimpleGrid cols={3} spacing={16}>
              {Object.values(status.strategies).map((s) => (
                <StrategyStatusCard key={s.strategy_id} strategy={s} isRunning={status?.running ?? false} />
              ))}
            </SimpleGrid>
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
