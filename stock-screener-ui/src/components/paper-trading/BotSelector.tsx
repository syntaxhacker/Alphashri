import { useState, useMemo } from "react";
import { Group, Select, Box, Button, Tooltip, Text } from "@/ui";
import { IconRefresh, IconPlayerPlay, IconPlayerStop } from "@tabler/icons-react";
import type { BotSummary } from "../../types/paperTrading";
import { isMarketClosedToday } from "../../state/holidays";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import { subscribeToHolidays } from "../../state/holidays";

interface BotSelectorProps {
  bots: BotSummary[];
  selectedBotId: string | null;
  onSelectBot: (botId: string) => void;
  onToggleBot: () => void;
  onRefresh: () => void;
}

function getBotLabel(bot: BotSummary): string {
  return `${bot.name} (${bot.position_count} pos)`;
}

export function BotSelector({
  bots,
  selectedBotId,
  onSelectBot,
  onToggleBot,
  onRefresh,
}: BotSelectorProps) {
  useStoreSubscription(subscribeToHolidays);
  const [refreshing, setRefreshing] = useState(false);

  const options = useMemo(
    () =>
      bots.map((bot) => ({
        value: bot.id,
        label: getBotLabel(bot),
      })),
    [bots],
  );

  if (bots.length === 0) return null;

  const selectedBot = bots.find((b) => b.id === selectedBotId) || null;
  const running = selectedBot?.running ?? false;
  const marketClosed = isMarketClosedToday();

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setTimeout(() => setRefreshing(false), 500);
    }
  };

  return (
    <Group gap="xs" data-testid="bot-selector">
      <Text size="sm" c="dimmed" fw={500}>
        Bot:
      </Text>
      <Select
        size="xs"
        data={options}
        value={selectedBotId}
        onChange={(val) => val && onSelectBot(val)}
        w={280}
        placeholder="Select bot"
        data-testid="bot-select"
      />
      <Tooltip label={running ? "Running" : "Stopped"}>
        <Box
          sx={(theme) => ({
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: selectedBotId
              ? running ? theme.palette.success.main : theme.palette.grey[500]
              : theme.palette.grey[400],
          })}
        />
      </Tooltip>
      <Text size="xs" c="dimmed" data-testid="bot-status">
        {running ? `Running (PID ${selectedBot?.pid ?? '?'})` : "Stopped"}
      </Text>
      <Tooltip label="Refresh">
        <Button
          size="compact-xs"
          variant="subtle"
          leftSection={<IconRefresh size={14} />}
          onClick={handleRefresh}
          loading={refreshing}
          disabled={!selectedBotId}
          data-testid="refresh-btn"
        >
          Refresh
        </Button>
      </Tooltip>
      {running ? (
        <Button
          size="compact-xs"
          variant="subtle"
          color="red"
          leftSection={<IconPlayerStop size={14} />}
          onClick={onToggleBot}
          data-testid="stop-bot-btn"
        >
          Stop
        </Button>
      ) : (
        <Tooltip
          label="Market closed — cannot start bot"
          disabled={!marketClosed}
        >
          <span>
            <Button
              size="compact-xs"
              variant="subtle"
              color="blue"
              leftSection={<IconPlayerPlay size={14} />}
              onClick={onToggleBot}
              disabled={marketClosed || !selectedBotId}
              data-testid="start-bot-btn"
            >
              Start
            </Button>
          </span>
        </Tooltip>
      )}
    </Group>
  );
}
