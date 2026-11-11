/**
 * The daily report's breadth readout and sector/theme leadership board.
 *
 * Split out of `DailyReportPage.tsx` so the page keeps only the fetching and
 * the tab layout. The board never overflows horizontally — every group stays
 * visible at any width, unlike a pill tape.
 */

import { Text, Tooltip } from "@/ui";
import { formatPercentage } from "../../utils/ui-helpers";
import type { SectorLeader, SectorLeaderBoard } from "../../types/report";

export function BreadthStat({ label, value, testId, color }: { label: string; value: string; testId: string; color?: "success" | "error" | "dimmed" }) {
  return (
    <div data-testid={testId} className="flex items-baseline gap-1 whitespace-nowrap" style={{ fontVariantNumeric: "tabular-nums" }}>
      <Text size="xs" c="dimmed" span>
        {label}
      </Text>
      <Text size="xs" fw={700} c={color ?? "default"} span style={{ fontVariantNumeric: "tabular-nums" }}>
        {value}
      </Text>
    </div>
  );
}

/** One side of the leadership board: fixed header + aligned rows. Names are
 *  left, change is right, so the eye scans a single numeric column. */
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
    <div className="min-w-0">
      <div
        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-2 py-[2px] border-b border-fin-border"
      >
        <Text size="xs" c={up ? "success" : "error"} fw={700} span>
          {up ? "▲ Leaders" : "▼ Laggards"}
        </Text>
        <Text size="xs" c="dimmed" fw={600} span>
          CHG
        </Text>
      </div>
      {items.map((leader) => (
        <Tooltip
          key={leader.name}
          label={`${leader.stock_count} stocks · ${leader.advances} adv / ${leader.declines} dec`}
          withArrow
          placement="left"
        >
          <div
            data-testid={`${testId}-item-${leader.name}`}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-2 min-h-[20px] hover:bg-fin-surface-alt"
          >
            <Text size="xs" span truncate>
              {leader.name}
            </Text>
            <Text
              size="xs"
              fw={600}
              c={leader.change >= 0 ? "success" : "error"}
              span
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {formatPercentage(leader.change)}
            </Text>
          </div>
        </Tooltip>
      ))}
    </div>
  );
}

/** Leadership board: sectors/themes split into leaders and laggards inside one
 *  bordered section. Unlike a pill tape this never overflows horizontally —
 *  every group is always visible at any width. */
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
    <div
      data-testid={testId}
      className="flex flex-col min-w-0 border border-fin-border rounded-fin overflow-hidden"
    >
      <div className="flex items-baseline justify-between gap-2 px-2 py-1 bg-fin-surface-alt">
        <Text size="xs" c="dimmed" fw={700} span className="uppercase">
          {label}
        </Text>
        <Text size="xs" c="dimmed" span>
          {winners.length} up · {losers.length} down
        </Text>
      </div>
      <div
        className="grid grid-cols-[1fr] sm:grid-cols-[repeat(2,minmax(0,1fr))] gap-4 row-gap-1 p-2 min-w-0"
      >
        <LeaderRows items={winners} side="up" testId={testId} />
        <LeaderRows items={losers} side="down" testId={testId} />
      </div>
    </div>
  );
}
