import { createSignal, createMemo, Show } from "solid-js";
import { Box, ToolbarRow, Select, Button, Tooltip, Text, useMediaQuery } from "@/ui";
import { IconRefresh, IconPlayerPlay, IconPlayerStop } from "@/components/common/Icons";
import type { BotSummary } from "../../types/paperTrading";
import { isMarketOpenNow, subscribeToHolidays, getHolidayState } from "../../state/holidays";
import { useMarketClockTick, marketClosedReason } from "../bots/BotHelpers";
import { useStoreSnapshot } from "./storeSnapshot";
import * as palette from "@/ui/palette";

interface BotSelectorProps {
  bots: BotSummary[];
  selectedBotId: string | null;
  onSelectBot: (botId: string) => void;
  onToggleBot: () => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
}

function getBotLabel(bot: BotSummary): string {
  return `${bot.name} (${bot.position_count} pos)`;
}

export function BotSelector(props: BotSelectorProps) {
  const narrow = useMediaQuery("(max-width: 599px)");
  const holidaySnap = useStoreSnapshot(subscribeToHolidays, getHolidayState);
  const [refreshing, setRefreshing] = createSignal(false);

  const options = createMemo(() =>
    props.bots.map((bot) => ({
      value: bot.id,
      label: getBotLabel(bot),
    })),
  );

  const selectedBot = createMemo(() => props.bots.find((b) => b.id === props.selectedBotId) || null);
  const running = createMemo(() => selectedBot()?.running ?? false);
  const clockTick = useMarketClockTick();
  // holidaySnap() tracks the holiday store; clockTick() flips the session at 15:30.
  const marketClosed = createMemo(() => {
    holidaySnap();
    clockTick();
    return !isMarketOpenNow();
  });

  const dotBackground = () => !props.selectedBotId
    ? palette.BORDER
    : running()
      ? palette.POSITIVE
      : palette.TEXT_MUTED;

  const handleRefresh = async () => {
    if (refreshing()) return;
    setRefreshing(true);
    try {
      await props.onRefresh();
    } finally {
      setTimeout(() => setRefreshing(false), 500);
    }
  };

  return (
    <Show when={props.bots.length > 0}>
      <ToolbarRow gap={narrow() ? 4 : 8} wrap={false} data-testid="bot-selector" className={narrow() ? "w-full min-w-0" : undefined}>
        <Box class={narrow() ? "hidden" : undefined}>
          <Text size="sm" c="dimmed" fw={500}>
            Bot:
          </Text>
        </Box>
        <Box class={narrow() ? "min-w-0 flex-1" : undefined}>
          <Select
            size="xs"
            data={options()}
            value={props.selectedBotId}
            onChange={(val) => val && props.onSelectBot(val)}
            w={narrow() ? "100%" : 280}
            placeholder="Select bot"
            data-testid="bot-select"
          />
        </Box>
        <Tooltip label={running() ? "Running" : "Stopped"}>
          <div
            class="size-2 rounded-full shrink-0"
            data-testid="bot-status-dot"
            role="img"
            aria-label={running() ? "Bot running" : "Bot stopped"}
            style={{ background: dotBackground() }}
          />
        </Tooltip>
        <Box class={narrow() ? "hidden" : undefined}>
          <Text size="xs" c="dimmed" data-testid="bot-status">
            {running() ? "Running" : "Stopped"}
          </Text>
        </Box>
        <Tooltip label="Refresh">
          <Button
            size="xs"
            variant="subtle"
            leftSection={<IconRefresh size={14} />}
            onClick={handleRefresh}
            loading={refreshing()}
            disabled={!props.selectedBotId}
            data-testid="refresh-btn"
            aria-label="Refresh"
          >
            <Show when={!narrow()}>Refresh</Show>
          </Button>
        </Tooltip>
        <Show
          when={running()}
          fallback={
            <Tooltip
              label={`Market closed — ${marketClosedReason()}`}
              disabled={!marketClosed()}
            >
              <span>
                {/* The @/ui Button binds `disabled` once at mount (its eager
                    `known.disabled || known.loading` read), so the two states
                    are distinct elements to keep the market closed/open flip
                    correct without re-creating the toolbar. */}
                <Show
                  when={!(marketClosed() || !props.selectedBotId)}
                  fallback={
                    <Button
                      size="xs"
                      variant="subtle"
                      color="primary"
                      leftSection={<IconPlayerPlay size={14} />}
                      disabled
                      data-testid="start-bot-btn"
                      aria-label="Start bot"
                    >
                      <Show when={!narrow()}>Start</Show>
                    </Button>
                  }
                >
                  <Button
                    size="xs"
                    variant="subtle"
                    color="primary"
                    leftSection={<IconPlayerPlay size={14} />}
                    onClick={() => props.onToggleBot()}
                    data-testid="start-bot-btn"
                    aria-label="Start bot"
                  >
                    <Show when={!narrow()}>Start</Show>
                  </Button>
                </Show>
              </span>
            </Tooltip>
          }
        >
          <Button
            size="xs"
            variant="subtle"
            color="error"
            leftSection={<IconPlayerStop size={14} />}
            onClick={() => props.onToggleBot()}
            data-testid="stop-bot-btn"
            aria-label="Stop bot"
          >
            <Show when={!narrow()}>Stop</Show>
          </Button>
        </Show>
      </ToolbarRow>
    </Show>
  );
}
