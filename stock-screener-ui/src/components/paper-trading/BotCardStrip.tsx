import { For, Show } from "solid-js";
import { Text, Group, Stack } from "@/ui";
import type { BotSummary } from "../../types/paperTrading";
import { BOT_SELECTED_BG } from "../../config/colors";
import * as palette from "@/ui/palette";
interface BotCardStripProps {
  bots: BotSummary[];
  selectedBotId: string | null;
  onSelect: (botId: string) => void;
}

export function BotCardStrip(props: BotCardStripProps) {
  return (
    <Show when={props.bots.length > 0}>
      <Group gap="xs" wrap="wrap">
        <For each={props.bots}>
          {(bot) => {
            return (
              <div
                class="p-8"
                data-testid={`bot-card-${bot.id}`}
                style={{
                  cursor: bot.is_active ? "pointer" : "default",
                  "border-radius": "6px",
                  background: bot.id === props.selectedBotId ? BOT_SELECTED_BG : "transparent",
                  opacity: bot.is_active ? 1 : 0.5,
                }}
                onClick={() => {
                  if (bot.is_active && bot.id !== props.selectedBotId) props.onSelect(bot.id);
                }}
              >
                <Stack className="gap-2">
                  <Group className="gap-8">
                    <div class="size-2 rounded-full shrink-0" style={{ background: bot.running ? palette.POSITIVE : palette.BORDER }} />
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
          }}
        </For>
      </Group>
    </Show>
  );
}
