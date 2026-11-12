import { For, Show } from "solid-js";
import { Box, Text } from "@/ui";
import type { InternalStockMover } from "./sectorUtils";
import { getPnLTextColor } from "../../utils/ui-helpers";
import { MONO } from "@/ui/palette";

function pct(value: number): string {
  return `${value.toFixed(2)}%`;
}

const GRID_COLS = "grid grid-cols-[minmax(0,1fr)_44px_44px_52px] items-center gap-0.5 min-h-[18px] px-0.5 border-b border-fin-border";
const NUM_CELL = { "font-family": MONO, "font-variant-numeric": "tabular-nums" } as const;

export function IntervalMoversTable(props: { movers: InternalStockMover[] }) {
  const movers = () => props.movers ?? [];

  return (
    <Show
      when={movers().length > 0}
      fallback={
        <Box className="flex items-center justify-center p-1">
          <Text size="xs" c="dimmed" ta="center" py={1}>
            Collecting baseline for interval moves...
          </Text>
        </Box>
      }
    >
      <Box data-testid="interval-movers-table" className="flex flex-col">
        <Box className={GRID_COLS}>
          <For each={["Stock", "Prev", "Now", "Δ"]}>
            {(label, index) => (
              <Text
                c="dimmed"
                className="text-[9px] font-bold tracking-[0.3px]"
                style={{ "text-align": index() === 0 ? "left" : "right" }}
              >
                {label}
              </Text>
            )}
          </For>
        </Box>
        <For each={movers()}>
          {(mover) => (
            <Box className="grid grid-cols-[minmax(0,1fr)_44px_44px_52px] items-center gap-0.5 min-h-5 px-0.5 border-b border-fin-border">
              <Text truncate className="text-[10.5px] font-semibold">
                {mover.symbol}
              </Text>
              <Text c="dimmed" ta="right" className="text-[10px] font-mono tabular-nums" style={NUM_CELL}>
                {pct(mover.prev_change)}
              </Text>
              <Text ta="right" className="text-[10px] font-mono tabular-nums" style={NUM_CELL}>
                {pct(mover.change)}
              </Text>
              <Text
                c={getPnLTextColor(mover.delta)}
                fw={700}
                ta="right"
                className="text-[10px] font-mono tabular-nums"
                style={NUM_CELL}
              >
                {mover.delta > 0 ? "+" : ""}
                {pct(mover.delta)}
              </Text>
            </Box>
          )}
        </For>
      </Box>
    </Show>
  );
}
