import { Group, Stack, Box, Text } from "@/ui";
import type { BotSummary } from "../../types/paperTrading";

interface BotCardStripProps {
  bots: BotSummary[];
  selectedBotId: string | null;
  onSelect: (botId: string) => void;
}

export function BotCardStrip({ bots, selectedBotId, onSelect }: BotCardStripProps) {
  if (bots.length === 0) return null;

  return (
    <Group gap="xs" wrap="wrap">
      {bots.map((bot) => {
        const isSelected = bot.id === selectedBotId;
        const isRunning = bot.running;
        const borderColor = isSelected
          ? "1px solid var(--mantine-color-blue-6)"
          : "1px solid var(--mantine-color-default-border)";
        const bgColor = isSelected ? "rgba(34, 139, 230, 0.08)" : "transparent";
        const leftBarColor = isRunning
          ? "var(--mantine-color-green-6)"
          : "var(--mantine-color-gray-6)";
        const dotColor = isRunning ? "var(--mantine-color-green-6)" : "var(--mantine-color-gray-6)";

        return (
          <Box
            key={bot.id}
            p={4}
            data-testid={`bot-card-${bot.id}`}
            style={{
              cursor: bot.is_active ? "pointer" : "default",
              borderRadius: 6,
              border: borderColor,
              borderLeft: `4px solid ${leftBarColor}`,
              background: bgColor,
              opacity: bot.is_active ? 1 : 0.5,
            }}
            onClick={() => {
              if (bot.is_active && !isSelected) onSelect(bot.id);
            }}
          >
            <Stack gap={1}>
              <Group gap={4}>
                <Box
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: dotColor,
                  }}
                />
                <Text size="sm" fw={500}>
                  {bot.name}
                </Text>
              </Group>
              <Text size="xs" c="dimmed">
                {bot.position_count} position{bot.position_count !== 1 ? "s" : ""}
              </Text>
            </Stack>
          </Box>
        );
      })}
    </Group>
  );
};