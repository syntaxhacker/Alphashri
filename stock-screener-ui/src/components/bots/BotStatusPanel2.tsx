import { Show, For, createMemo, createSignal, onMount, onCleanup } from "solid-js";
import { Box, Card, Text, Button, Group, Stack, SimpleGrid, Badge, Tooltip } from "@/ui";
import { IconRefresh, IconPlayerPlay, IconPlayerStop } from "../common/Icons";
import type { BotConfig, BotStatus, BotTrade } from "../../types/bots";
import { loadBotStatus, loadBotTrades } from "../../state/bots";
import { StatusBadge } from "../common/BadgeComponents";
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

export function BotStatusPanel(props: BotStatusPanelProps) {
  // Holiday state is module-global without signals — tick on store notify so
  // the closed/open read below re-evaluates when holidays load.
  const [holidaysTick, setHolidaysTick] = createSignal(0);
  onMount(() => {
    const unsubscribe = subscribeToHolidays(() => setHolidaysTick((n) => n + 1));
    onCleanup(() => unsubscribe?.());
  });
  const marketClosed = createMemo(() => {
    holidaysTick();
    return isMarketClosedToday();
  });

  const status = () => props.status;
  const strategies = createMemo(() => Object.values(status()?.strategies ?? {}));
  const strategyCount = createMemo(() => Object.keys(status()?.strategies ?? {}).length);
  const positions = createMemo(() => status()?.positions ?? []);
  const lastUpdate = createMemo(() => status()?.last_update ?? null);

  const handleRefresh = async () => {
    await Promise.all([loadBotStatus(props.bot.id), loadBotTrades(props.bot.id)]);
  };

  const handleStart = async () => {
    await props.onStart(props.bot.id);
    await loadBotStatus(props.bot.id);
    await loadBotTrades(props.bot.id);
  };

  const handleStop = async () => {
    await props.onStop(props.bot.id);
    await loadBotStatus(props.bot.id);
  };

  const handleRefreshTrades = async () => {
    await loadBotTrades(props.bot.id);
  };

  return (
    <Box
      data-testid="bot-status-panel"
      data-bot-id={props.bot.id}
      id="bot-status-panel"
      className="bot-status-panel"
    >
      <Stack spacing={1} gap="sm" className="gap-2 p-2">
        <Card
          padding="sm"
          radius="sm"
          id="bot-header-card"
          data-testid="bot-header-card"
          className="p-2"
        >
          <Box className="flex items-center justify-between gap-2 p-2">
            <Stack gap={1} className="gap-2">
              <Text fw={700} size="lg" c="primary.main" data-testid="bot-name">
                {props.bot.name}
              </Text>
              <Group gap={1} align="center" className="flex items-center gap-2">
                <StatusBadge
                  running={status()?.running ?? false}
                  pid={status()?.pid ?? undefined}
                  statusUnknown={status()?.status === "unknown"}
                  data-testid="bot-running-badge"
                />
                <Show
                  when={props.bot.live_trading}
                  fallback={
                    <Badge color="success" variant="filled" size="sm" data-testid="paper-trading-badge">
                      PAPER
                    </Badge>
                  }
                >
                  <Badge color="error" variant="filled" size="sm" data-testid="live-trading-badge">
                    LIVE
                  </Badge>
                </Show>
              </Group>
            </Stack>
            <Group gap={1} align="center" className="flex items-center gap-2">
              <Show
                when={status()?.running}
                fallback={
                  <Tooltip label="Market closed — cannot start bot" disabled={!marketClosed()}>
                    <span>
                      <Button
                        leftSection={<IconPlayerPlay size={16} />}
                        variant="filled"
                        color="success"
                        onClick={handleStart}
                        disabled={marketClosed()}
                        data-testid="start-bot-btn"
                      >
                        Start Bot
                      </Button>
                    </span>
                  </Tooltip>
                }
              >
                <Button
                  leftSection={<IconPlayerStop size={16} />}
                  variant="filled"
                  color="error"
                  onClick={handleStop}
                  data-testid="stop-bot-btn"
                >
                  Stop Bot
                </Button>
              </Show>
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

        <Show
          when={status()?.portfolio}
          fallback={
            <Card
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
          }
        >
          {(portfolio) => <PortfolioSummaryCard portfolio={portfolio()} />}
        </Show>

        <Show when={status()?.strategies}>
          <Stack spacing={1} gap={0} data-testid="strategies-status" className="gap-2 p-2">
            <Group gap={1} align="center" mb="sm" className="flex items-center gap-2 p-2">
              <Box w={4} h={20} className="rounded-sm bg-fin-text-muted" />
              <Text fw={600} size="sm">
                Strategy Status
              </Text>
              <Badge size="sm" variant="light" color="secondary">
                {strategyCount()}
              </Badge>
            </Group>
            <SimpleGrid cols={3} spacing={16}>
              <For each={strategies()}>
                {(s) => (
                  <StrategyStatusCard strategy={s} isRunning={status()?.running ?? false} />
                )}
              </For>
            </SimpleGrid>
          </Stack>
        </Show>

        <Show when={positions().length > 0}>
          <PositionsTable positions={positions()} />
        </Show>

        <TradesTable trades={props.trades} onRefresh={handleRefreshTrades} />

        <Show when={lastUpdate()}>
          <Text size="sm" c="dimmed" ta="center" data-testid="bot-last-update">
            Last update: {new Date(lastUpdate()!).toLocaleTimeString()}
          </Text>
        </Show>
      </Stack>
    </Box>
  );
}
