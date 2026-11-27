import { formatNumberIN } from "@/utils/ui-helpers";
import { clockLabel } from "./tapeRange";

export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** IST HH:MM for a tape timestamp (ISO or bare HH:MM). */
export function burstTimeLabel(t: string): string {
  return clockLabel(t);
}

export function compact(v: number): string {
  const sign = v < 0 ? "-" : "+";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${abs}`;
}

export function levelText(v: number | null | undefined): string {
  return typeof v === "number" && Number.isFinite(v) ? formatNumberIN(Math.round(v)) : "";
}

/** Alert timestamp from a burst clock (bare `HH:MM` has no date → now). */
export function burstTs(t: string): number {
  const parsed = Date.parse(t);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

export function shortNum(v: string): string {
  return v.endsWith(".00") ? v.slice(0, -3) : v;
}
