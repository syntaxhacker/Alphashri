import { Group, Stack, Text } from "@/ui";
import type { BotSummary } from "../../types/paperTrading";
import { BOT_SELECTED_BG } from "../../config/colors";
import * as palette from "@/ui/palette";

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
          <div
            key={bot.id}
            className="p-8"
            data-testid={`bot-card-${bot.id}`}
            style={{
              cursor: bot.is_active ? "pointer" : "default",
              borderRadius: 6,
              background: isSelected ? BOT_SELECTED_BG : "transparent",
              opacity: bot.is_active ? 1 : 0.5,
            }}
            onClick={() => {
              if (bot.is_active && !isSelected) onSelect(bot.id);
            }}
          >
            <Stack className="gap-2">
              <Group className="gap-8">
                <div className="size-2 rounded-full shrink-0" style={{ background: isRunning ? palette.POSITIVE : palette.BORDER }} />
                <Text size="sm" fw={500}>
                  {bot.name}
                </Text>
              </Group>
              <Text size="xs" c="dimmed">
                {bot.position_count} position{bot.position_count !== 1 ? "s" : ""}
              </Text>
            </Stack>
          </div>
        );
      })}
    </Group>
  );
};
