// Shared replay formatters — single source for the clock strings rendered by the
// controls strip and the chart's time axis.
import { TZ_IST } from "@/config/constants";

/** IST wall-clock with seconds, e.g. "09:15:00". */
export const fmtClock = (ts: number): string =>
  new Date(ts * 1000).toLocaleString("en-IN", { timeZone: TZ_IST, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

/** Signed P&L in points with one decimal, e.g. "+12.5 pts" / "-3.0 pts".
 * Exact-duplicate pattern (previously inlined in the stat chip panels and
 * ReplayShell's trades summary). */
export const fmtPts = (v: number): string => `${v > 0 ? "+" : ""}${v.toFixed(1)} pts`;
