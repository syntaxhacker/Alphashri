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
import { ascTapeByTime } from "./tapeRange";
import {
  formatReportClock,
  formatReportCompact,
  formatReportNum,
  formatReportPct,
  formatReportRatio,
} from "./reportFormat";

export const TAPE_TERM_BG = palette.BG;
export const TAPE_CELL_RULE = palette.TAPE_CELL_RULE;
export const TAPE_HEADER_RULE = palette.TAPE_HEADER_RULE;
export const TAPE_COL_RULE = palette.TAPE_COL_RULE;
export const TAPE_ROW_HOVER = palette.TAPE_ROW_HOVER;
export const TAPE_ROW_LATEST = palette.TAPE_ROW_LATEST;
export const TAPE_SPOT = palette.TAPE_SPOT;
export const TAPE_CALL_DOI = palette.TAPE_CALL_DOI;
export const TAPE_PUT_DOI = palette.TAPE_PUT_DOI;
export const TAPE_NET_HUE = palette.TAPE_NET_HUE;
export const TAPE_NET_TEXT = palette.TAPE_NET_TEXT;
export const TAPE_POS_HUE = palette.TAPE_POS_HUE;
export const TAPE_FLIP_POS_TEXT = palette.TAPE_FLIP_POS_TEXT;
export const TAPE_NEG_HUE = palette.TAPE_NEG_HUE;
export const TAPE_FLIP_NEG_TEXT = palette.TAPE_FLIP_NEG_TEXT;
export const TAPE_TICK_POS = palette.POSITIVE;
export const TAPE_TICK_NEG = palette.NEGATIVE;

export function formatTapeCompact(v: number | null | undefined): string {
  return formatReportCompact(v, { sign: "always" });
}

export function formatTapePrice(v: number | null | undefined): string {
  return formatReportNum(v, { digits: 2 });
}

export function formatTapeSigned(v: number | null | undefined): string {
  return formatReportNum(v, { digits: 2, sign: "always" });
}

export function formatTapePct(v: number | null | undefined): string {
  return formatReportPct(v, { digits: 2, sign: "always" });
}

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

const maxAbs = (cur: number, v: number | null | undefined): number =>
  v === null || v === undefined || !Number.isFinite(v) ? cur : Math.max(cur, Math.abs(v));

/**
 * One pass over the rows for all eight maxima. The old version ran eight
 * `reduce`s — eight full scans of a ~375-row tape on every poll — for the same
 * numbers.
 */
export function computeTapeScale(rows: readonly NiftyTapeRow[]): TapeScale {
  let call_doi = 0;
  let put_doi = 0;
  let net = 0;
  let net_pct = 0;
  let call_tick = 0;
  let put_tick = 0;
  let pcr_doi = 0;
  let spot_flip = 0;
  for (const r of rows) {
    call_doi = maxAbs(call_doi, r.call_doi);
    put_doi = maxAbs(put_doi, r.put_doi);
    net = maxAbs(net, r.net);
    net_pct = maxAbs(net_pct, r.net_pct);
    call_tick = maxAbs(call_tick, r.call_tick);
    put_tick = maxAbs(put_tick, r.put_tick);
    pcr_doi = maxAbs(pcr_doi, r.pcr_doi);
    spot_flip = maxAbs(spot_flip, r.spot_flip);
  }
  return { call_doi, put_doi, net, net_pct, call_tick, put_tick, pcr_doi, spot_flip };
}

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
 * `asc` is an optional pre-sorted view of `rows`. Callers that already hold the
 * chronological tape pass it in so this derivation never sorts a second time.
 */
export function computeSpotDeltas(
  rows: readonly NiftyTapeRow[],
  asc?: readonly NiftyTapeRow[],
): Map<string, number> {
  const sorted = asc ?? ascTapeByTime(rows);
  const out = new Map<string, number>();
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (!Number.isFinite(prev.spot) || !Number.isFinite(cur.spot)) continue;
    out.set(cur.t, cur.spot - prev.spot);
  }
  return out;
}

export function computeTapeSession(
  rows: readonly NiftyTapeRow[],
  asc?: readonly NiftyTapeRow[],
): {
  spotHi: number;
  spotLo: number;
  maxCallDoi: number;
  maxPutDoi: number;
  netLast: number;
} {
  let spotHi = -Infinity;
  let spotLo = Infinity;
  let maxCallDoi = 0;
  let maxPutDoi = 0;
  const sorted = asc ?? ascTapeByTime(rows);
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
  const last = sorted.length > 0 ? sorted[sorted.length - 1] : null;
  const netLast = last && Number.isFinite(last.net) ? last.net : 0;
  return {
    spotHi: Number.isFinite(spotHi) ? spotHi : 0,
    spotLo: Number.isFinite(spotLo) ? spotLo : 0,
    maxCallDoi,
    maxPutDoi,
    netLast,
  };
}

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

export function getTapeBaseline(
  tape?: NiftyTape,
  rows?: readonly NiftyTapeRow[],
  asc?: readonly NiftyTapeRow[],
): string | null {
  const explicit =
    tape?.baseline_t && tape.baseline_t.length > 0
      ? formatTapeBaseline(tape.baseline_t)
      : "";
  if (explicit) return explicit;
  if (rows && rows.length > 0) {
    const sorted = asc ?? ascTapeByTime(rows);
    const hhmm = formatTapeBaseline(sorted[0]?.t);
    if (hhmm) return hhmm;
  }
  return null;
}

export function tapeDoiLabel(
  tape?: NiftyTape,
  rows?: readonly NiftyTapeRow[],
  asc?: readonly NiftyTapeRow[],
): string {
  const baseline = getTapeBaseline(tape, rows, asc);
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
  rows: readonly NiftyTapeRow[],
  tape?: NiftyTape,
  flipAtSpot?: number | null,
  asc?: readonly NiftyTapeRow[],
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
  const sorted = asc ?? ascTapeByTime(rows);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
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
