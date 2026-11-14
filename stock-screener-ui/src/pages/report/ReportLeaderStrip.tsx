/**
 * The daily report's breadth readout and sector/theme leadership board.
 *
 * Split out of `DailyReportPage.tsx` so the page keeps only the fetching and
 * the tab layout. The board never overflows horizontally — every group stays
 * visible at any width, unlike a pill tape.
 */

import { For } from "solid-js";
import { Text, Tooltip } from "@/ui";
import * as palette from "@/ui/palette";
import { formatPercentage, getPnLTextColor } from "../../utils/ui-helpers";
import type { SectorLeader, SectorLeaderBoard } from "../../types/report";

/** One type treatment for every label / number on the strip, so a stat cell and
 *  a leader row cannot drift apart. Numbers are mono + tabular or the columns
 *  do not line up. */
const STRIP_LABEL_STYLE = {
  "font-size": "10px",
  "font-weight": 700,
  "text-transform": "uppercase",
  "letter-spacing": "0.06em",
  "line-height": "1.2",
  "white-space": "nowrap",
} as const;

const STRIP_VALUE_STYLE = {
  "font-size": "11px",
  "font-family": palette.MONO,
  "font-variant-numeric": "tabular-nums",
  "line-height": "1.2",
  "text-align": "right",
} as const;

/** Row identity: proportional + left, so it reads faster than the mono column. */
const STRIP_NAME_STYLE = {
  "font-size": "11px",
  "line-height": "1.2",
  "text-align": "left",
} as const;

/** Borderless 41px stat cell — dividers come from the cell edge so the strip has
 *  no outer card. Matches `CompactStat` so both align on one row. `flex-1`
 *  makes the cells share the band evenly: the row can never wrap onto a second
 *  line, whatever the viewport. */
const STAT_CELL_STYLE = {
  height: "41px",
  "font-variant-numeric": "tabular-nums",
} as const;

export function BreadthStat(props: {
  label: string;
  value: string;
  testId: string;
  color?: "success" | "error" | "dimmed";
}) {
  return (
    <div
      data-testid={props.testId}
      class="flex flex-1 flex-col justify-center min-w-0 px-2 border-l border-fin-border first:border-l-0"
      style={STAT_CELL_STYLE}
    >
      <Text c="dimmed" truncate style={STRIP_LABEL_STYLE}>
        {props.label}
      </Text>
      <Text fw={700} c={props.color ?? "default"} style={STRIP_VALUE_STYLE}>
        {props.value}
      </Text>
    </div>
  );
}

/** One side of the leadership board: fixed header + aligned rows. Names are
 *  left, change is right, so the eye scans a single numeric column. */
function LeaderRows(props: { items: SectorLeader[]; side: "up" | "down"; testId: string }) {
  if (props.items.length === 0) return null;
  const up = props.side === "up";
  return (
    <div class={`min-w-0${up ? "" : " sm:border-l sm:border-fin-border"}`}>
      <div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1 px-2 py-1 border-b border-fin-border">
        <Text c={up ? "success" : "error"} style={STRIP_LABEL_STYLE}>
          {up ? "▲ Leaders" : "▼ Laggards"}
        </Text>
        <Text c="dimmed" style={{ ...STRIP_LABEL_STYLE, "text-align": "right" }}>
          CHG
        </Text>
      </div>
      <For each={props.items}>
        {(leader) => (
          <Tooltip
            className="w-full"
            label={`${leader.stock_count} stocks · ${leader.advances} adv / ${leader.declines} dec`}
            withArrow
            position="left"
          >
            <div
              data-testid={`${props.testId}-item-${leader.name}`}
              class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1 px-2 h-6 w-full border-b border-fin-border last:border-b-0 hover:bg-fin-surface-alt"
            >
              <Text truncate style={STRIP_NAME_STYLE}>
                {leader.name}
              </Text>
              <Text fw={600} c={getPnLTextColor(leader.change)} style={STRIP_VALUE_STYLE}>
                {formatPercentage(leader.change)}
              </Text>
            </div>
          </Tooltip>
        )}
      </For>
    </div>
  );
}

/** Leadership board: sectors/themes split into leaders and laggards as one
 *  borderless band. The page panel owns the outer border, so the strip only
 *  carries its header rule and the row dividers. */
export function LeaderStrip(props: { leaders: SectorLeader[] | SectorLeaderBoard | undefined; testId: string; label: string }) {
  // Backend sends `{top: [...5], bottom: [...5]}`; accept a flat array too.
  const all = (Array.isArray(props.leaders) ? props.leaders : [...(props.leaders?.top ?? []), ...(props.leaders?.bottom ?? [])]).filter(
    (l) => l && typeof l.name === "string",
  );
  if (all.length === 0) return null;
  const board = Array.isArray(props.leaders) ? null : props.leaders;
  const winners = (board ? board.top : all.filter((l) => l.change >= 0)).filter((l) => l && typeof l.name === "string");
  const losers = (board ? board.bottom : all.filter((l) => l.change < 0)).filter((l) => l && typeof l.name === "string");
  return (
    <div data-testid={props.testId} class="flex flex-col min-w-0 overflow-hidden">
      <div class="flex items-center justify-between gap-1 px-2 py-1 bg-fin-surface-alt border-b border-fin-border">
        <Text c="dimmed" style={STRIP_LABEL_STYLE}>
          {props.label}
        </Text>
        <Text c="dimmed" style={{ ...STRIP_VALUE_STYLE, "font-size": "10px" }}>
          {winners.length} up · {losers.length} down
        </Text>
      </div>
      <div class="grid grid-cols-[minmax(0,1fr)] sm:grid-cols-[repeat(2,minmax(0,1fr))] min-w-0">
        <LeaderRows items={winners} side="up" testId={props.testId} />
        <LeaderRows items={losers} side="down" testId={props.testId} />
      </div>
    </div>
  );
}
