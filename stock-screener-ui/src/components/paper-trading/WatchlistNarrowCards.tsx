import { For, Show } from "solid-js";
import { alpha } from "@/ui/alpha";
import { Badge, Box, Group, Text } from "@/ui";
import * as palette from "@/ui/palette";
import { SideBadge } from "../common";
import { ClickableSymbolSolid } from "./ClickableSymbolSolid";
import { formatTimeAgo } from "../../utils/ui-helpers";
import type { PaperScanItem } from "../../types/paperTrading";
import { nearBreakoutPct } from "./PositionsHelpers";

const STATUS_BORDER_COLOR: Record<string, string> = {
  signal: palette.POSITIVE,
  watching: palette.WARNING,
  rejected: palette.NEGATIVE,
  skipped: palette.BORDER,
};

function Field(props: { label: string; value: string; testId: string; tone?: string }) {
  return (
    <Box className="flex min-w-0 flex-col gap-0.5">
      <Text size="xs" c="dimmed" class="text-ui-micro uppercase tracking-wide">{props.label}</Text>
      <Text size="xs" fw={500} c={props.tone} class="truncate font-mono tabular-nums" data-testid={props.testId}>
        {props.value}
      </Text>
    </Box>
  );
}

/** Phone-sized watchlist: every column of the desktop scan table, no sideways scroll. */
export function WatchlistNarrowCards(props: {
  items: PaperScanItem[];
  selectedSymbol: string | null;
  onSelect: (item: PaperScanItem) => void;
}) {
  return (
    <Box
      data-testid="watchlist-narrow-cards"
      role="list"
      aria-label="Watchlist scan"
      class="flex min-h-0 min-w-0 flex-col gap-1 p-1"
    >
      <For each={props.items}>
        {(item) => {
          const near = () => nearBreakoutPct(item);
          const nearText = () => Number.isFinite(near()) && near() < 9999 ? `${near().toFixed(2)}%` : "—";
          return (
            <Box
              data-testid={`watchlist-narrow-row-${item.symbol}`}
              role="listitem"
              class="shrink-0 rounded border border-fin-border bg-fin-surface p-2"
              style={{
                "border-left-width": "3px",
                "border-left-style": "solid",
                "border-left-color": STATUS_BORDER_COLOR[item.status] ?? STATUS_BORDER_COLOR.skipped,
                "background-color": item.symbol === props.selectedSymbol ? alpha(palette.PRIMARY, 0.08) : undefined,
              }}
            >
              <Box class="flex min-w-0 items-center justify-between gap-2">
                <Group gap="xs" wrap="nowrap" class="min-w-0 items-center gap-1">
                  <ClickableSymbolSolid
                    symbol={item.symbol}
                    testId={`watchlist-narrow-symbol-${item.symbol}`}
                    onClick={() => props.onSelect(item)}
                  />
                  <Badge size="xs" variant="light" color={item.status === "signal" ? "success" : item.status === "watching" ? "warning" : "secondary"}>
                    {item.status}
                  </Badge>
                  <Show when={item.side}>{(side) => <SideBadge side={side()} />}</Show>
                </Group>
              </Box>
              <Box class="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-2">
                <Field label="Price" value={Number.isFinite(item.price) ? `₹${Number(item.price).toFixed(2)}` : "—"} testId={`watchlist-narrow-price-${item.symbol}`} />
                <Field label="Near" value={nearText()} testId={`watchlist-narrow-near-${item.symbol}`} />
                <Field label="Strategy" value={item.strategy_name || "—"} testId={`watchlist-narrow-strategy-${item.symbol}`} />
                <Field
                  label="Age"
                  value={item.timestamp ? formatTimeAgo(item.timestamp) : "—"}
                  testId={`watchlist-narrow-age-${item.symbol}`}
                />
              </Box>
              <Text size="xs" c="dimmed" class="mt-1.5 truncate" data-testid={`watchlist-narrow-notes-${item.symbol}`}>
                {item.reason || "—"}
              </Text>
            </Box>
          );
        }}
      </For>
    </Box>
  );
}
