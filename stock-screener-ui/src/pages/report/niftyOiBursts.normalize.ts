import type { NiftyTapeRow } from "@/types/niftyReport";
import { hhmmToMinutes, minutesToHhmm } from "./tapeRange";
import type { MinuteDoi, MinutePremium } from "./niftyOiBursts.types";
import { TREND_EMA_SPAN } from "./niftyOiBursts.types";

/** Wall event kinds the backend attaches to the bursts feed. */
export function isWallEventType(type?: string | null): boolean {
  return type === "wall_test" || type === "rejection" || type === "break" || type === "wall_break";
}

/**
 * Rows that carry no one-minute OI move: wall geometry, wall relocations,
 * coils and tape watchdog warnings. None may enter plan/flow derivation —
 * a wall relocation has `from`/`to` but no delta, and a coil's delta is 0.
 */
export function isNonTradeAlertType(type?: string | null): boolean {
  return (
    isWallEventType(type) || type === "wall" || type === "coil" || type === "data_stale"
  );
}

/**
 * Session trend at `atTime` (or at the end) from spot vs its EMA, mirroring
 * `session_trend()` in `api/reports_api/nifty_bursts.py`.
 *
 * A burst is only actionable *with* the trend: on 2026-10-13 trend-aligned
 * plans went 20/23 favourable (avg +95.5 pts) while counter-trend plans went
 * 2/22 (avg −110.1 pts).
 */
export function sessionTrend(
  rows: NiftyTapeRow[],
  atTime?: string,
): "up" | "down" | null {
  const spots: number[] = [];
  const asc = [...(rows ?? [])].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  for (const r of asc) {
    if (!Number.isFinite(r.spot) || r.spot === 0) continue;
    spots.push(r.spot);
    if (atTime !== undefined && r.t === atTime) break;
  }
  if (spots.length < 2) return null;

  const alpha = 2 / (TREND_EMA_SPAN + 1);
  let ema = spots[0];
  for (let i = 1; i < spots.length; i++) ema = alpha * spots[i] + (1 - alpha) * ema;
  const last = spots[spots.length - 1];
  if (last > ema) return "up";
  if (last < ema) return "down";
  return null;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Same-side ATM premium change between two tape rows — the client mirror of
 * the backend's `_premium_change`. The ATM strike rolling between rows makes
 * the change a strike artefact, and a non-positive premium is incomparable,
 * so both read as null (no label, not a guess).
 */
export function atmPremiumChange(
  prev: MinutePremium | null | undefined,
  cur: MinutePremium | null | undefined,
  side: "call" | "put",
): number | null {
  if (!prev || !cur) return null;
  const a = side === "call" ? prev.ce : prev.pe;
  const b = side === "call" ? cur.ce : cur.pe;
  if (typeof a !== "number" || typeof b !== "number") return null;
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return null;
  const pa = prev.strike;
  const pb = cur.strike;
  if (
    typeof pa === "number" &&
    typeof pb === "number" &&
    pa > 0 &&
    pb > 0 &&
    pa !== pb
  ) {
    return null;
  }
  return b - a;
}

/**
 * Spot `minutesBack` before `hhmm`, tolerating tape gaps by walking further
 * back (up to `tolerance` extra minutes). Null when the tape has no row
 * there — the 5-minute gate then stays unknown rather than guessing.
 */
export function spotMinutesBefore(
  spots: Map<string, number>,
  hhmm: string,
  minutesBack: number,
  tolerance = 5,
): number | null {
  const base = hhmmToMinutes(hhmm);
  if (base === null) return null;
  for (let back = minutesBack; back <= minutesBack + tolerance; back++) {
    const t = base - back;
    if (t < 0) return null;
    const v = spots.get(minutesToHhmm(t));
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  }
  return null;
}

/**
 * Same-side ATM premium change at `hhmm` vs the nearest earlier minute (up
 * to `tolerance` back) — the client fallback for bursts without a backend
 * flow label. Null when unreadable; the caller then keeps the legacy rule.
 */
export function premiumChangeBefore(
  prems: Map<string, MinutePremium>,
  hhmm: string,
  side: "call" | "put",
  tolerance = 5,
): number | null {
  const base = hhmmToMinutes(hhmm);
  if (base === null) return null;
  const cur = prems.get(hhmm);
  if (!cur) return null;
  for (let back = 1; back <= 1 + tolerance; back++) {
    const t = base - back;
    if (t < 0) return null;
    const prev = prems.get(minutesToHhmm(t));
    if (!prev) continue;
    const chg = atmPremiumChange(prev, cur, side);
    if (chg !== null) return chg;
  }
  return null;
}

/** Chronological per-minute ΔOI series; the first row is the baseline, not a delta.
 * Duplicate timestamps keep the LAST occurrence (the backend feed is
 * ascending, so that is the most recent write); rows without `t` are dropped. */
export function computeMinuteDoi(rows: NiftyTapeRow[]): MinuteDoi[] {
  const byT = new Map<string, NiftyTapeRow>();
  for (const r of rows ?? []) {
    if (r && typeof r.t === "string" && r.t.length > 0) byT.set(r.t, r);
  }
  const asc = [...byT.values()].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  const out: MinuteDoi[] = [];
  for (let i = 1; i < asc.length; i++) {
    const p = asc[i - 1];
    const c = asc[i];
    if (!p || !c) continue;
    out.push({
      t: c.t,
      dCall: (c.call_doi ?? 0) - (p.call_doi ?? 0),
      dPut: (c.put_doi ?? 0) - (p.put_doi ?? 0),
      callDoi: c.call_doi ?? 0,
      putDoi: c.put_doi ?? 0,
      spot: c.spot ?? 0,
      callTick: c.call_tick ?? 0,
      putTick: c.put_tick ?? 0,
    });
  }
  return out;
}
