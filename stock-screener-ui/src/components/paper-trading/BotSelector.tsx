import { createSignal, createMemo, Show } from "solid-js";
import { ToolbarRow, Select, Button, Tooltip, Text } from "@/ui";
import { IconRefresh, IconPlayerPlay, IconPlayerStop } from "@/components/common/Icons";
import type { BotSummary } from "../../types/paperTrading";
import { isMarketClosedToday, subscribeToHolidays, getHolidayState } from "../../state/holidays";
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
  // holidaySnap() tracks the holidays store; re-evaluate when it notifies.
  const marketClosed = createMemo(() => {
    holidaySnap();
    return isMarketClosedToday();
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
      <ToolbarRow gap={8} wrap={false} data-testid="bot-selector">
        <Text size="sm" c="dimmed" fw={500}>
          Bot:
        </Text>
        <Select
          size="xs"
          data={options()}
          value={props.selectedBotId}
          onChange={(val) => val && props.onSelectBot(val)}
          w={280}
          placeholder="Select bot"
          data-testid="bot-select"
        />
        <Tooltip label={running() ? "Running" : "Stopped"}>
          <div
            class="size-2 rounded-full shrink-0"
            data-testid="bot-status-dot"
            style={{ background: dotBackground() }}
          />
        </Tooltip>
        <Text size="xs" c="dimmed" data-testid="bot-status">
          {running() ? "Running" : "Stopped"}
        </Text>
        <Tooltip label="Refresh">
          <Button
            size="xs"
            variant="subtle"
            leftSection={<IconRefresh size={14} />}
            onClick={handleRefresh}
            loading={refreshing()}
            disabled={!props.selectedBotId}
            data-testid="refresh-btn"
          >
            Refresh
          </Button>
        </Tooltip>
        <Show
          when={running()}
          fallback={
            <Tooltip label="Market closed — cannot start bot" disabled={!marketClosed()}>
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
                    >
                      Start
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
                  >
                    Start
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
          >
            Stop
          </Button>
        </Show>
      </ToolbarRow>
    </Show>
  );
}
