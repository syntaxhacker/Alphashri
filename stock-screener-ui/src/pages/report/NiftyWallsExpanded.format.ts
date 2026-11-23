import * as palette from "@/ui/palette";
import type { WallsEvent, WallsPayload } from "@/api/reportNifty";
import { STATE_COLOR, fmtNum, fmtPct, formatDte } from "./niftyWallsFormat";

/**
 * Display strings owned by the expanded walls view. Pure functions keep the
 * numbers, units and fallback prose in one place while the JSX modules stay
 * about layout — the text is byte-identical to the pre-split facade.
 */

export interface WallsStatCell {
  label: string;
  value: string;
  color?: string;
}

/** Fields shared by the live alert and the recorded break events. */
export type WallsBreak = Pick<
  WallsEvent,
  "at" | "wall" | "spot" | "erosion_30m" | "put_build_30m" | "max_pain"
>;

export const wallsStateColor = (walls: WallsPayload): string =>
  STATE_COLOR[walls.state] ?? palette.TEXT_MUTED;

export const wallsDteLabel = (walls: WallsPayload): string => formatDte(walls.dte);

export function wallsStatCells(walls: WallsPayload): WallsStatCell[] {
  return [
    { label: "SPOT", value: fmtNum(walls.spot, 2) },
    { label: "MAX PAIN", value: fmtNum(walls.max_pain) },
    { label: "DRIFT", value: fmtNum(walls.max_pain_drift) },
    { label: "ATM", value: fmtNum(walls.atm) },
    {
      label: "PIN",
      value: `${walls.pin_distance_pts > 0 ? "+" : ""}${fmtNum(walls.pin_distance_pts, 0)} (${walls.pin_distance_pct.toFixed(2)}%)`,
      color: palette.PRIMARY,
    },
    { label: "GEX", value: walls.gex_degraded ? "n/a" : fmtNum(walls.net_gex, 1) },
    {
      label: "GEX FLIP",
      value: walls.gex_degraded ? "n/a" : fmtNum(walls.flip),
    },
  ];
}

export const wallsReadText = (walls: WallsPayload): string =>
  walls.read ||
  (walls.expiry_day
    ? "0-DTE: the walls sit at the spot. A break needs the call wall to erode, the put floor to build, and max pain to drift — the 14:25 gamma leg, not the 14:04 touch."
    : "Non-expiry: wall erosion is positioning. The violent 0-DTE gamma/pin does not apply; watch the wall as a level, not a pin.");

export const wallsBreakHeadline = (
  alert: WallsPayload["alert"],
  primary: WallsBreak,
): string =>
  alert
    ? `${fmtNum(alert.wall)} gave way · ${fmtNum(alert.spot, 1)}`
    : `First break ${fmtNum(primary.wall)} · ${fmtNum(primary.spot, 1)}`;

export const wallsBreakDetail = (primary: WallsBreak): string =>
  `${primary.at.slice(11, 19)} · call wall ${fmtPct(primary.erosion_30m)} · put build ${fmtPct(primary.put_build_30m)} · max pain ${fmtNum(primary.max_pain)}`;

export const wallsRebreakDetail = (last: WallsBreak): string =>
  `Re-broke ${last.at.slice(11, 19)} · call ${fmtPct(last.erosion_30m)} · put ${fmtPct(last.put_build_30m)}`;

export const wallsGapLabel = (walls: WallsPayload): string => {
  const gaps = walls.freshness.gaps;
  if (gaps.length === 0) return "";
  const last = gaps[gaps.length - 1];
  return ` · last gap ${last.from.slice(11, 16)}→${last.to.slice(11, 16)} (${Math.round(last.seconds)}s)`;
};

export const wallsEventLabel = (event: WallsEvent, isFirst: boolean): string => {
  if (event.kind !== "BREAK") return "TOUCH";
  return isFirst ? "FIRST BREAK" : "RE-BREAK";
};
