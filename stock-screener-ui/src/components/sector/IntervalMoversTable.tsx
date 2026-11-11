import { Box, Text } from "@/ui";
import type { InternalStockMover } from "./sectorUtils";
import { getPnLTextColor } from "../../utils/ui-helpers";
import { MONO } from "@/ui/palette";

function pct(value: number): string {
  return `${value.toFixed(2)}%`;
}

const GRID_COLS = "grid grid-cols-[minmax(0,1fr)_44px_44px_52px] items-center gap-0.5 min-h-[18px] px-0.5 border-b border-fin-border";
const NUM_CELL = { fontFamily: MONO, fontVariantNumeric: "tabular-nums" } as const;

export function IntervalMoversTable({ movers }: { movers: InternalStockMover[] }) {
  if (movers.length === 0) {
    return (
      <Box className="flex items-center justify-center p-1">
        <Text size="xs" c="dimmed" ta="center" py={1}>
          Collecting baseline for interval moves...
        </Text>
      </Box>
    );
  }

  return (
    <Box data-testid="interval-movers-table" className="flex flex-col">
      <Box className={GRID_COLS}>
        {["Stock", "Prev", "Now", "Δ"].map((label, index) => (
          <Text
            key={label}
            c="dimmed"
            className="text-[9px] font-bold tracking-[0.3px]"
            style={{ textAlign: index === 0 ? "left" : "right" }}
          >
            {label}
          </Text>
        ))}
      </Box>
      {movers.map((mover) => (
        <Box
          key={mover.symbol}
          className="grid grid-cols-[minmax(0,1fr)_44px_44px_52px] items-center gap-0.5 min-h-5 px-0.5 border-b border-fin-border"
        >
          <Text truncate className="text-[10.5px] font-semibold">
            {mover.symbol}
          </Text>
          <Text c="dimmed" ta="right" className="text-[10px]" style={NUM_CELL}>
            {pct(mover.prev_change)}
          </Text>
          <Text ta="right" className="text-[10px]" style={NUM_CELL}>
            {pct(mover.change)}
          </Text>
          <Text
            c={getPnLTextColor(mover.delta)}
            fw={700}
            ta="right"
            className="text-[10px]"
            style={NUM_CELL}
          >
            {mover.delta > 0 ? "+" : ""}
            {pct(mover.delta)}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
