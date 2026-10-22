/**
 * Pure derivations for the Nifty tape table — formatters, the heat scale, the
 * session roll-up and the live change-flash diff.
 *
 * Nothing here touches React or the network: every value is a function of the
 * rows the caller already has, so the table can memoise on the payload and the
 * maths can be unit-tested on its own.
 *
 * The number formatting lives in {@link ./reportFormat} — this module only
 * holds the tape's own vocabulary (the terminal palette, the "—" glyph, the
 * baseline label) on top of it.
 */

import type { NiftyTape, NiftyTapeRow } from "@/types/niftyReport";
import * as palette from "@/ui/palette";
import { hexToRgba } from "@/utils/color";
import {
  formatReportClock,
  formatReportCompact,
  formatReportNum,
  formatReportPct,
  formatReportRatio,
} from "./reportFormat";

/**
 * Terminal palette — matches the reference tape screenshot (pitch-black
 * desk, blue call/put deltas, brown Net, blue/brown Spot-flip).
 * Scoped to this table only; the global app palette stays untouched.
 */
export const TAPE_TERM_BG = "#000000";
export const TAPE_SPOT = "#F2CC60";
export const TAPE_CALL_DOI = "#80B5FF";
export const TAPE_PUT_DOI = "#8AA4C2";
export const TAPE_NET_HUE = "#7A4D16";
export const TAPE_NET_TEXT = "#FFDDB3";
export const TAPE_POS_HUE = "#1F7FFF";
export const TAPE_FLIP_POS_TEXT = "#B3D1FF";
export const TAPE_NEG_HUE = "#DB6D28";
export const TAPE_FLIP_NEG_TEXT = "#FFC680";
export const TAPE_TICK_POS = palette.POSITIVE;
export const TAPE_TICK_NEG = palette.NEGATIVE;

/** Signed compact OI delta: +170.16M / +5.53M / +850 / -12. */
export function formatTapeCompact(v: number | null | undefined): string {
  return formatReportCompact(v, { sign: "always" });
}

/** Spot / strike-style price with Indian grouping. */
export function formatTapePrice(v: number | null | undefined): string {
  return formatReportNum(v, { digits: 2 });
}

/** Signed points, e.g. +12 / -8. */
export function formatTapeSigned(v: number | null | undefined): string {
  return formatReportNum(v, { digits: 2, sign: "always" });
}

/** Signed percent with 2 decimals. */
export function formatTapePct(v: number | null | undefined): string {
  return formatReportPct(v, { digits: 2, sign: "always" });
}

/** Plain ratio with 2 decimals (PCR vol/OI). */
export function formatTapeRatio(v: number | null | undefined): string {
  return formatReportRatio(v);
}

/** ISO timestamp → HH:MM:SS; bare HH:MM labels pass through. */
export function formatTapeTime(t: string): string {
  if (t.includes("T")) {
    const time = t.split("T")[1] ?? "";
    return time.slice(0, 8) || t;
  }
  return t;
}

/** IST HH:MM:SS for an epoch-ms value — host-TZ independent. */
export function formatIstClock(ms: number): string {
  return formatReportClock(ms);
}

/** Per-column max |value| across the rendered rows — the heat scale. */
export interface TapeScale {
  call_doi: number;
  put_doi: number;
  net: number;
  net_pct: number;
  call_tick: number;
  put_tick: number;
  pcr_doi: number;
  spot_flip: number;
}

/** Largest |value| per heat column. Empty rows → all zeros (no tint). */
export function computeTapeScale(rows: NiftyTapeRow[]): TapeScale {
  const maxAbs = (pick: (r: NiftyTapeRow) => number | null | undefined): number =>
    rows.reduce((m, r) => {
      const v = pick(r);
      return v === null || v === undefined || !Number.isFinite(v) ? m : Math.max(m, Math.abs(v));
    }, 0);
  return {
    call_doi: maxAbs((r) => r.call_doi),
    put_doi: maxAbs((r) => r.put_doi),
    net: maxAbs((r) => r.net),
    net_pct: maxAbs((r) => r.net_pct),
    call_tick: maxAbs((r) => r.call_tick),
    put_tick: maxAbs((r) => r.put_tick),
    pcr_doi: maxAbs((r) => r.pcr_doi),
    spot_flip: maxAbs((r) => r.spot_flip),
  };
}

/**
 * Magnitude heat: background alpha scales with |value| ÷ column max, so a
 * big print glows and a quiet one barely registers — "more has more
 * background, less has lesser opacity". `floor` keeps the hue legible even
 * at the minimum, `ceil` caps the strongest fill.
 */
export function tapeHeat(
  v: number,
  max: number,
  hue: string,
  floor = 0.05,
  ceil = 0.7,
): string | undefined {
  if (!Number.isFinite(v) || v === 0 || max <= 0) return undefined;
  const r = Math.min(1, Math.abs(v) / max);
  return hexToRgba(hue, floor + (ceil - floor) * r);
}

/**
 * Spot change vs the previous chronological minute, keyed by row timestamp.
 * The first recorded row (and any unparseable pair) has no entry.
 */
export function computeSpotDeltas(rows: NiftyTapeRow[]): Map<string, number> {
  const asc = [...rows].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  const out = new Map<string, number>();
  for (let i = 1; i < asc.length; i++) {
    const prev = asc[i - 1];
    const cur = asc[i];
    if (!Number.isFinite(prev.spot) || !Number.isFinite(cur.spot)) continue;
    out.set(cur.t, cur.spot - prev.spot);
  }
  return out;
}

/** Session roll-up for the tape footer: spot range + biggest OI prints. */
export function computeTapeSession(rows: NiftyTapeRow[]): {
  spotHi: number;
  spotLo: number;
  maxCallDoi: number;
  maxPutDoi: number;
  /**
   * The CUMULATIVE net (put ΔOI − call ΔOI) at the last recorded minute.
   * The tape's `net` is already a running total vs the baseline, so summing
   * the column added the same cumulative figure up once per minute — a
   * meaningless number that grew with the length of the session.
   */
  netLast: number;
} {
  let spotHi = -Infinity;
  let spotLo = Infinity;
  let maxCallDoi = 0;
  let maxPutDoi = 0;
  const asc = [...rows].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  for (const r of rows) {
    if (Number.isFinite(r.spot)) {
      spotHi = Math.max(spotHi, r.spot);
      spotLo = Math.min(spotLo, r.spot);
    }
    const c = Math.abs(r.call_doi ?? 0);
    const p = Math.abs(r.put_doi ?? 0);
    if (Number.isFinite(c)) maxCallDoi = Math.max(maxCallDoi, c);
    if (Number.isFinite(p)) maxPutDoi = Math.max(maxPutDoi, p);
  }
  const last = asc.length > 0 ? asc[asc.length - 1] : null;
  const netLast = last && Number.isFinite(last.net) ? last.net : 0;
  return {
    spotHi: Number.isFinite(spotHi) ? spotHi : 0,
    spotLo: Number.isFinite(spotLo) ? spotLo : 0,
    maxCallDoi,
    maxPutDoi,
    netLast,
  };
}

/** Row fields that participate in the live change-flash. */
export const TAPE_FLASH_FIELDS = [
  "spot",
  "call_doi",
  "put_doi",
  "net",
  "net_pct",
  "call_tick",
  "put_tick",
  "pcr_doi",
  "spot_flip",
] as const;

/**
 * Compare the previous snapshot against the current rows and report which
 * cells actually moved, keyed by minute (`t`) → set of changed fields. Only
 * rows present in both snapshots can "change" — a brand-new minute is a
 * different event (the row flash), so it never appears here.
 */
export function computeChangedCells(
  prev: Map<string, NiftyTapeRow>,
  rows: NiftyTapeRow[],
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const r of rows) {
    const p = prev.get(r.t);
    if (!p) continue;
    const changed = new Set<string>();
    for (const f of TAPE_FLASH_FIELDS) {
      if (r[f] !== p[f]) changed.add(f);
    }
    if (changed.size > 0) out.set(r.t, changed);
  }
  return out;
}

/** ISO timestamp (or bare HH:MM) → HH:MM baseline label; "" when unknown. */
export function formatTapeBaseline(t: string | null | undefined): string {
  if (!t) return "";
  return formatTapeTime(t).slice(0, 5);
}

/** Earliest chronological row's HH:MM — explicit `tape.baseline_t` wins,
 * otherwise the first row's `t`; null when there is nothing to anchor to. */
export function getTapeBaseline(tape?: NiftyTape, rows?: NiftyTapeRow[]): string | null {
  const explicit =
    tape?.baseline_t && tape.baseline_t.length > 0
      ? formatTapeBaseline(tape.baseline_t)
      : "";
  if (explicit) return explicit;
  if (rows && rows.length > 0) {
    const asc = [...rows].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
    const hhmm = formatTapeBaseline(asc[0]?.t);
    if (hhmm) return hhmm;
  }
  return null;
}

/** Honest ΔOI label: deltas are measured vs the baseline, not the open. */
export function tapeDoiLabel(tape?: NiftyTape, rows?: NiftyTapeRow[]): string {
  const baseline = getTapeBaseline(tape, rows);
  return baseline ? `PCR ΔOI since ${baseline}` : "PCR ΔOI since open";
}

/**
 * Header-strip stats: last chronological row wins; nonzero session-summary
 * fields fill in when the row carries zeros.
 *
 * `flipDeltaPts` is **spot − flip** — the same sign convention as the tape's
 * "Spot−flip" column (positive = spot above the flip). The head used to show
 * flip − spot, so one level read with opposite signs in two places.
 */
export function buildTapeHead(
  rows: NiftyTapeRow[],
  tape?: NiftyTape,
  flipAtSpot?: number | null,
): {
  pcrOi: number;
  pcrDoiDelta: number;
  maxPain: number;
  flipDeltaPts: number;
  flip: number;
  wallCall: number;
  wallPut: number;
  spot: number;
} {
  const asc = [...rows].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  const first = asc[0];
  const last = asc[asc.length - 1];
  const pick = (rowVal: number, sumVal?: number): number =>
    rowVal !== 0 ? rowVal : (sumVal ?? 0);
  // A spot-relative flip (from `gexFlipAtSpot`) wins over the row's recorded
  // one, so the tape cannot show a stale crossing.
  const flip =
    flipAtSpot !== null && flipAtSpot !== undefined && flipAtSpot !== 0
      ? flipAtSpot
      : pick(last?.flip ?? 0, tape?.flip);
  return {
    pcrOi: pick(last?.pcr_oi ?? 0, tape?.pcr_oi),
    pcrDoiDelta: (last?.pcr_doi ?? 0) - (first?.pcr_doi ?? 0),
    maxPain: pick(last?.max_pain ?? 0, tape?.max_pain),
    // spot − flip: the same sign convention as the "Spot−flip" column.
    flipDeltaPts: flip === 0 ? 0 : (last?.spot ?? 0) - flip,
    flip,
    wallCall: pick(last?.walls?.call ?? 0, tape?.walls?.call),
    wallPut: pick(last?.walls?.put ?? 0, tape?.walls?.put),
    spot: last?.spot ?? 0,
  };
}
