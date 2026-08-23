import { Group, Stack, Box, Text } from "@/ui";
import type { BotSummary } from "../../types/paperTrading";
import { BOT_SELECTED_BG } from "../../config/colors";

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
        return (
          <Box
            key={bot.id}
            p={4}
            data-testid={`bot-card-${bot.id}`}
            sx={(theme) => ({
              cursor: bot.is_active ? "pointer" : "default",
              borderRadius: 6,
              border: isSelected ? `1px solid ${theme.palette.primary.main}` : `1px solid ${theme.palette.divider}`,
              borderLeft: `4px solid ${isRunning ? theme.palette.success.main : theme.palette.grey[500]}`,
              background: isSelected ? BOT_SELECTED_BG : "transparent",
              opacity: bot.is_active ? 1 : 0.5,
            })}
            onClick={() => {
              if (bot.is_active && !isSelected) onSelect(bot.id);
            }}
          >
            <Stack gap={1}>
              <Group gap={4}>
                <Box
                  sx={(theme) => ({
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: isRunning ? theme.palette.success.main : theme.palette.grey[500],
                  })}
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