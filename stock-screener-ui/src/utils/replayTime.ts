import { TZ_IST } from "@/config/constants";

const fmtHM = (ts: number, timeZone: string) =>
  new Date(ts * 1000).toLocaleString("en-IN", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

/** "09:30–09:45 IST" for an opening-range window starting at startSec lasting minutes. */
export function orRangeLabel(startSec: number, minutes: number, timeZone: string = TZ_IST): string {
  return `${fmtHM(startSec, timeZone)}–${fmtHM(startSec + minutes * 60, timeZone)} IST`;
}

/** True once the opening-range window has completed at the given replay clock. */
export function isOrComplete(clockSec: number, orStartSec: number, minutes: number): boolean {
  if (!clockSec || !orStartSec || minutes <= 0) return false;
  return clockSec >= orStartSec + minutes * 60;
}
