import { Show, For, createMemo, createSignal, onMount, onCleanup } from "solid-js";
import { Box, Card, Text, Button, Stack, SimpleGrid, Badge, ToolbarRow, Tooltip } from "@/ui";
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
      className="bot-status-panel flex h-full min-h-0 flex-col"
    >
      <Stack spacing={1} gap="sm" className="flex flex-1 min-h-0 flex-col gap-2 p-2">
        <Card
          padding="xs"
          id="bot-header-card"
          data-testid="bot-header-card"
          className="shrink-0"
        >
          <ToolbarRow gap={8} wrap={false} className="px-2" style={{ "min-height": "30px" }}>
            <Box className="flex items-center gap-2">
              <Text fw={700} size="sm" data-testid="bot-name">
                {props.bot.name}
              </Text>
              <StatusBadge
                running={status()?.running ?? false}
                pid={status()?.pid ?? undefined}
                statusUnknown={status()?.status === "unknown"}
                data-testid="bot-running-badge"
              />
              <Show
                when={props.bot.live_trading}
                fallback={
                  <Badge color="success" variant="filled" size="xs" data-testid="paper-trading-badge">
                    PAPER
                  </Badge>
                }
              >
                <Badge color="error" variant="filled" size="xs" data-testid="live-trading-badge">
                  LIVE
                </Badge>
              </Show>
            </Box>
            <Box className="ml-auto flex items-center gap-2">
              <Show
                when={status()?.running}
                fallback={
                  <Tooltip label="Market closed — cannot start bot" disabled={!marketClosed()}>
                    <span>
                      <Button
                        leftSection={<IconPlayerPlay size={14} />}
                        variant="filled"
                        color="success"
                        size="xs"
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
                  leftSection={<IconPlayerStop size={14} />}
                  variant="filled"
                  color="error"
                  size="xs"
                  onClick={handleStop}
                  data-testid="stop-bot-btn"
                >
                  Stop Bot
                </Button>
              </Show>
              <Button
                leftSection={<IconRefresh size={14} />}
                variant="light"
                color="secondary"
                size="xs"
                onClick={handleRefresh}
                data-testid="refresh-bot-status-btn"
                style={{ height: "24px" }}
              >
                Refresh
              </Button>
            </Box>
          </ToolbarRow>
        </Card>

        <Show
          when={status()?.portfolio}
          fallback={
            <Card
              padding="xs"
              id="portfolio-placeholder"
              data-testid="portfolio-placeholder"
              className="shrink-0"
            >
              <Box className="flex items-center justify-center px-2 py-3">
                <Text size="xs" c="dimmed" ta="center">
                  Start the bot to see live portfolio data
                </Text>
              </Box>
            </Card>
          }
        >
          {(portfolio) => <PortfolioSummaryCard portfolio={portfolio()} />}
        </Show>

        <Show when={status()?.strategies}>
          <Box data-testid="strategies-status" className="shrink-0">
            <ToolbarRow gap={8} wrap={false} className="px-2" style={{ height: "24px" }}>
              <Box w={4} h={14} className="rounded-sm bg-fin-text-muted" />
              <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ "font-size": "10px", "letter-spacing": "0.06em", "text-transform": "uppercase" }}>
                Strategy Status
              </Text>
              <Badge size="xs" variant="light" color="secondary">
                {strategyCount()}
              </Badge>
            </ToolbarRow>
            <SimpleGrid cols={3} spacing={8}>
              <For each={strategies()}>
                {(s) => (
                  <StrategyStatusCard strategy={s} isRunning={status()?.running ?? false} />
                )}
              </For>
            </SimpleGrid>
          </Box>
        </Show>

        <Show when={positions().length > 0}>
          <PositionsTable positions={positions()} />
        </Show>

        <TradesTable trades={props.trades} onRefresh={handleRefreshTrades} />

        <Show when={lastUpdate()}>
          <Text size="xs" c="dimmed" className="font-mono tabular-nums" data-testid="bot-last-update">
            Last update: {new Date(lastUpdate()!).toLocaleTimeString()}
          </Text>
        </Show>
      </Stack>
    </Box>
  );
}
