import { Box, Text } from "@/ui";
import type { InternalStockMover } from "./sectorUtils";
import { getPnLTextColor } from "../../utils/ui-helpers";
import { MONO } from "@/ui/palette";

function pct(value: number): string {
  return `${value.toFixed(2)}%`;
}

export function IntervalMoversTable({ movers }: { movers: InternalStockMover[] }) {
  if (movers.length === 0) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", p: 1 }}>
        <Text size="xs" c="dimmed" ta="center" py={1}>
          Collecting baseline for interval moves...
        </Text>
      </Box>
    );
  }

  return (
    <Box data-testid="interval-movers-table" sx={{ display: "flex", flexDirection: "column" }}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 44px 44px 52px",
          alignItems: "center",
          gap: 0.5,
          minHeight: 18,
          px: 0.5,
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        {["Stock", "Prev", "Now", "Δ"].map((label, index) => (
          <Text
            key={label}
            c="dimmed"
            sx={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.3, textAlign: index === 0 ? "left" : "right" }}
          >
            {label}
          </Text>
        ))}
      </Box>
      {movers.map((mover) => (
        <Box
          key={mover.symbol}
          sx={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) 44px 44px 52px",
            alignItems: "center",
            gap: 0.5,
            minHeight: 20,
            px: 0.5,
            borderBottom: "1px solid",
            borderColor: "divider",
          }}
        >
          <Text truncate sx={{ fontSize: 10.5, fontWeight: 600 }}>
            {mover.symbol}
          </Text>
          <Text c="dimmed" ta="right" sx={{ fontFamily: MONO, fontSize: 10, fontVariantNumeric: "tabular-nums" }}>
            {pct(mover.prev_change)}
          </Text>
          <Text ta="right" sx={{ fontFamily: MONO, fontSize: 10, fontVariantNumeric: "tabular-nums" }}>
            {pct(mover.change)}
          </Text>
          <Text
            c={getPnLTextColor(mover.delta)}
            fw={700}
            ta="right"
            sx={{ fontFamily: MONO, fontSize: 10, fontVariantNumeric: "tabular-nums" }}
          >
            {mover.delta > 0 ? "+" : ""}
            {pct(mover.delta)}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
