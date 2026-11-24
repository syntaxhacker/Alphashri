import type { JSX } from "solid-js";
import * as palette from "@/ui/palette";
import type { WallsPayload, WallsRow } from "@/api/reportNifty";
import { erosionArrow, statusTone } from "./niftyWallsFormat";

/** The walls band always reserves three rows per side: the Index Report is a
 *  one-page layout, so a thin payload (or a null payload) must never shrink
 *  the card. */
export const WALLS_ROWS = 3;

/** Capped columns: strike minmax(0,210px) so strike and numbers stay one unit;
 *  OI 48px, NEW 48px, 5m 40px, 30m 40px, DIST 44px stay fixed and readable. */

export const WALLS_HEADINGS = ["OI", "NEW", "5m", "30m", "DIST"] as const;

/** Fixed numeric columns sized for 13px tabular values; the strike column
 *  absorbs the slack. The inner grid never narrows below this, so 390px
 *  scrolls the table instead of clipping a number. */
export const WALLS_GRID_COLS = "grid-cols-[minmax(0,210px)_64px_64px_52px_52px_56px]";
export const WALLS_MIN_W = "min-w-[520px]";

export const WALLS_RESERVED_H = 96;

export function toneColor(tone: "positive" | "warning" | "negative" | "muted"): string {
  switch (tone) {
    case "positive":
      return palette.POSITIVE;
    case "negative":
      return palette.NEGATIVE;
    case "warning":
      return palette.WARNING;
    default:
      return palette.TEXT_MUTED;
  }
}

export function flowToneColor(tone: "bull" | "bear" | "muted"): string {
  return tone === "bull" ? palette.POSITIVE : tone === "bear" ? palette.NEGATIVE : palette.TEXT_MUTED;
}

// Call-wall erosion is upside fuel for the desk and put-wall erosion is
// downside fuel, so colour the erosion cells by that fuel direction (side +
// status) — never by the erosion sign alone.
export function wallFuelColor(side: "CALL" | "PUT", row: WallsRow): string {
  const arrow = erosionArrow(side, row.status ?? "");
  if (arrow === "▲") return palette.POSITIVE;
  if (arrow === "▼") return palette.NEGATIVE;
  return toneColor(statusTone(row.status));
}

export interface WallsCardProps {
  walls: WallsPayload | null;
  onExpand: () => void;
  /** Opens the deeper pressure desk (phase plane + selected-wall path). */
  onOpenDesk?: () => void;
  emptyText?: string;
  /** Replay cannot reconstruct the tape: use the one shared "not captured"
   *  treatment and drop the permanently hidden skeleton from the DOM. */
  unavailableInReplay?: boolean;
  /** The session was recorded but the walls snapshot is absent — the recorder
   *  did not persist this band. Distinct from "the fetch failed". */
  noDataRecorded?: boolean;
  /** Forces/rejects the failed state. Omitted, it is derived from the session
   *  clock: a null payload during a live session IS the failed state. */
  loadFailed?: boolean;
  /** Recovery action for the failed state only. */
  onRetry?: () => void;
  /** Collapse the five-column band to a one-glance summary; the full detail
   *  stays mounted and is reachable through the EXPAND affordance. */
  compact?: boolean;
  /** Optional dense levels rows (e.g. LevelsInPlayContent) rendered inside
   *  this same card, after the walls grid. */
  levels?: JSX.Element;
  /** Override the panel testid when a second instance is promoted to a
   *  permanent rail next to the dock's own copy of the strips. */
  testId?: string;
}
