/**
 * The daily report's breadth readout and sector/theme leadership board.
 *
 * Split out of `DailyReportPage.tsx` so the page keeps only the fetching and
 * the tab layout. The board never overflows horizontally — every group stays
 * visible at any width, unlike a pill tape.
 */

import Box from "@mui/material/Box";
import { Text, Tooltip } from "@/ui";
import { formatPercentage } from "../../utils/ui-helpers";
import type { SectorLeader, SectorLeaderBoard } from "../../types/report";

export function BreadthStat({ label, value, testId, color }: { label: string; value: string; testId: string; color?: "success" | "error" | "dimmed" }) {
  return (
    <Box data-testid={testId} sx={{ display: "flex", alignItems: "baseline", gap: 0.5, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
      <Text size="xs" c="dimmed" span>
        {label}
      </Text>
      <Text size="xs" fw={700} c={color ?? "default"} span sx={{ fontVariantNumeric: "tabular-nums" }}>
        {value}
      </Text>
    </Box>
  );
}

/** One side of the leadership board: fixed header + aligned rows. Names are
 * left, change is right, so the eye scans a single numeric column. */
function LeaderRows({
  items,
  side,
  testId,
}: {
  items: SectorLeader[];
  side: "up" | "down";
  testId: string;
}) {
  if (items.length === 0) return null;
  const up = side === "up";
  return (
    <Box sx={{ minWidth: 0 }}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          alignItems: "center",
          gap: 1,
          px: 1,
          py: 0.25,
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <Text size="xs" c={up ? "success" : "error"} fw={700} span>
          {up ? "▲ Leaders" : "▼ Laggards"}
        </Text>
        <Text size="xs" c="dimmed" fw={600} span>
          CHG
        </Text>
      </Box>
      {items.map((leader) => (
        <Tooltip
          key={leader.name}
          label={`${leader.stock_count} stocks · ${leader.advances} adv / ${leader.declines} dec`}
          withArrow
          placement="left"
        >
          <Box
            data-testid={`${testId}-item-${leader.name}`}
            sx={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) auto",
              alignItems: "center",
              gap: 1,
              px: 1,
              minHeight: 20,
              "&:hover": { bgcolor: "action.hover" },
            }}
          >
            <Text size="xs" span truncate>
              {leader.name}
            </Text>
            <Text
              size="xs"
              fw={600}
              c={leader.change >= 0 ? "success" : "error"}
              span
              sx={{ fontVariantNumeric: "tabular-nums" }}
            >
              {formatPercentage(leader.change)}
            </Text>
          </Box>
        </Tooltip>
      ))}
    </Box>
  );
}

/** Leadership board: sectors/themes split into leaders and laggards inside one
 * bordered section. Unlike a pill tape this never overflows horizontally —
 * every group is always visible at any width. */
export function LeaderStrip({ leaders, testId, label }: { leaders: SectorLeader[] | SectorLeaderBoard | undefined; testId: string; label: string }) {
  // Backend sends `{top: [...5], bottom: [...5]}`; accept a flat array too.
  const all = (Array.isArray(leaders) ? leaders : [...(leaders?.top ?? []), ...(leaders?.bottom ?? [])]).filter(
    (l) => l && typeof l.name === "string",
  );
  if (all.length === 0) return null;
  const board = Array.isArray(leaders) ? null : leaders;
  const winners = (board ? board.top : all.filter((l) => l.change >= 0)).filter((l) => l && typeof l.name === "string");
  const losers = (board ? board.bottom : all.filter((l) => l.change < 0)).filter((l) => l && typeof l.name === "string");
  return (
    <Box
      data-testid={testId}
      sx={{
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        overflow: "hidden",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 1, px: 1, py: 0.5, bgcolor: "action.hover" }}>
        <Text size="xs" c="dimmed" fw={700} tt="uppercase" span>
          {label}
        </Text>
        <Text size="xs" c="dimmed" span>
          {winners.length} up · {losers.length} down
        </Text>
      </Box>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" },
          columnGap: 2,
          rowGap: 1,
          p: 1,
          minWidth: 0,
        }}
      >
        <LeaderRows items={winners} side="up" testId={testId} />
        <LeaderRows items={losers} side="down" testId={testId} />
      </Box>
    </Box>
  );
}
