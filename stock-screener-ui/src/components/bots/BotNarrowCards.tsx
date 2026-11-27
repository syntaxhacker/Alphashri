import { For, Show } from "solid-js";
import { Badge, Box, Group, Text } from "@/ui";
import type { BotConfig } from "../../types/bots";
import { StatusBadge } from "../common/BadgeComponents";
import {
  BotActionButtons,
  BotSummaryCell,
  getBotIndicatorColor,
} from "./BotHelpers";
import { formatBotCapitalPct, formatBotMaxPositions } from "./botFormat";

interface BotNarrowCardsProps {
  bots: BotConfig[];
  onViewStatus: (bot: BotConfig) => void;
  onStart: (botId: string) => Promise<void>;
  onStop: (botId: string) => Promise<void>;
  onEdit: (bot: BotConfig) => void;
  onDelete: (botId: string) => Promise<void>;
}

function Field(props: { label: string; children: any }) {
  return (
    <Box className="flex min-w-0 flex-col gap-0.5">
      <Text size="xs" c="dimmed" className="text-ui-micro uppercase tracking-wide">{props.label}</Text>
      <Box className="min-w-0">{props.children}</Box>
    </Box>
  );
}

/**
 * Phone/tablet bot list. Every column the desktop table carries stays in the
 * row — a narrower table would hide Max Positions, Max Capital and Actions
 * behind a sideways scroll that has no visible affordance at 390px.
 */
export function BotNarrowCards(props: BotNarrowCardsProps) {
  return (
    <Box
      data-testid="bots-narrow-cards"
      role="list"
      aria-label="Configured bots"
      class="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto p-2"
    >
      <For each={props.bots}>
        {(bot) => (
          <Box
            data-testid={`bot-row-${bot.id}`}
            role="listitem"
            class="shrink-0 rounded border border-fin-border bg-fin-surface p-2"
          >
            <Group gap={8} wrap="nowrap" class="min-w-0 items-center justify-between gap-2">
              <Group gap={4} wrap="nowrap" class="min-w-0 items-center gap-2">
                <Box
                  w={8}
                  h={8}
                  class="shrink-0 rounded-full"
                  style={{ "background-color": getBotIndicatorColor(bot.running) }}
                />
                <Text fw={600} class="truncate" data-testid={`bot-name-${bot.id}`}>{bot.name}</Text>
                <Show when={bot.live_trading}>
                  <Badge color="error" size="xs" variant="filled">LIVE</Badge>
                </Show>
                <Show when={!bot.is_active}>
                  <Badge color="secondary" size="xs" variant="filled">Inactive</Badge>
                </Show>
              </Group>
              <Box class="shrink-0" data-testid={`bot-status-${bot.id}`}>
                <StatusBadge
                  running={bot.running}
                  pid={bot.pid ?? undefined}
                  statusUnknown={bot.status === "UNKNOWN"}
                />
              </Box>
            </Group>

            <Box class="mt-2 grid grid-cols-2 gap-x-2 gap-y-2">
              <Field label="Strategies">
                <BotSummaryCell bot={bot} />
              </Field>
              <Field label="Max positions">
                <Text size="xs" fw={600} class="font-mono tabular-nums" data-testid={`bot-max-positions-${bot.id}`}>
                  {formatBotMaxPositions(bot.max_total_positions)}
                </Text>
              </Field>
              <Field label="Max capital">
                <Text size="xs" fw={600} class="font-mono tabular-nums" data-testid={`bot-max-capital-${bot.id}`}>
                  {formatBotCapitalPct(bot.max_total_capital_pct)}
                </Text>
              </Field>
              <Field label="Actions">
                <Box data-testid={`bot-actions-${bot.id}`}>
                  <BotActionButtons
                    bot={bot}
                    onView={props.onViewStatus}
                    onStart={props.onStart}
                    onStop={props.onStop}
                    onEdit={props.onEdit}
                    onDelete={props.onDelete}
                  />
                </Box>
              </Field>
            </Box>
          </Box>
        )}
      </For>
    </Box>
  );
}
