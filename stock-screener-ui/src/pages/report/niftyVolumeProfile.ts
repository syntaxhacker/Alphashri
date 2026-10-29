/**
 * Intraday option-volume profile for the NIFTY tape.
 *
 * Pure helpers only (no React) so the panel and its tests share one
 * implementation. The tape rows carry a per-strike `chain` map:
 *   chain[strike] = [ce_ltp, pe_ltp, ce_oi, pe_oi, ce_vol, pe_vol]
 * where OI/volume are cumulative counters. Types are local on purpose —
 * other agents own the canonical tape types, and this module must not
 * import their files.
 */

import { sortByField } from "@/utils/ui-helpers";
import { formatReportCompact } from "./reportFormat";

/** One tape row: spot + the per-strike cumulative chain snapshot. */
export interface NiftyVolumeTapeRow {
  t: string;
  spot: number;
  atm_strike?: number | null;
  chain?: Record<string, [number, number, number, number, number, number] | number[]> | null;
}

/** One plotted strike of the profile. */
interface VolumeProfilePoint {
  strike: number;
  ceVol: number;
  peVol: number;
  ceOi: number;
  peOi: number;
  /** ceVol + peVol — drives the top-volume marker. */
  total: number;
}

interface VolumeProfileTotals {
  ceVol: number;
  peVol: number;
  ceOi: number;
  peOi: number;
}

interface VolumeProfile {
  points: VolumeProfilePoint[];
  /** Strike nearest the reference spot, or null when there is no data. */
  atmStrike: number | null;
  /** Strike carrying the most total volume, or null when empty. */
  topStrike: number | null;
  totals: VolumeProfileTotals;
}

type VolumeProfileMode =
  | "latest"
  | "delta";

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Build the per-strike volume profile from tape rows.
 *
 * - `latest` (default): per strike, the LAST row's cumulative CE/PE
 *   volume and OI (what the chain shows right now).
 * - `delta`: per strike, last − first cumulative volume (the day's traded
 *   delta; a strike seen once counts its full value), OI stays latest.
 *
 * Rows outside ±`widthPts` of the reference spot (explicit `spot`, else the
 * last finite row spot, else the last `atm_strike`) are dropped so far-OTM
 * dust never flattens the bars. Empty/malformed input yields empty points
 * with null markers and zero totals — never a crash.
 */
export function buildVolumeProfile(
  rows: NiftyVolumeTapeRow[] | null | undefined,
  opts: { widthPts?: number; mode?: VolumeProfileMode; spot?: number | null } = {},
): VolumeProfile {
  const empty: VolumeProfile = {
    points: [],
    atmStrike: null,
    topStrike: null,
    totals: { ceVol: 0, peVol: 0, ceOi: 0, peOi: 0 },
  };
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return empty;

  const widthPts = opts.mode === undefined && opts.widthPts === undefined ? 500 : (opts.widthPts ?? 500);
  const mode: VolumeProfileMode = opts.mode ?? "latest";

  // First-seen cumulative volume per strike (delta mode) + last-seen everything.
  const first = new Map<number, { ceVol: number; peVol: number }>();
  const seen = new Map<number, number>();
  const last = new Map<number, { ceVol: number; peVol: number; ceOi: number; peOi: number }>();

  for (const row of list ?? []) {
    const chain = row?.chain;
    if (!chain || typeof chain !== "object") continue;
    for (const key of Object.keys(chain)) {
      const strike = Number(key);
      if (!Number.isFinite(strike)) continue;
      const leg = chain[key];
      if (!Array.isArray(leg)) continue;
      const ceOi = num(leg[2]);
      const peOi = num(leg[3]);
      const ceVol = num(leg[4]);
      const peVol = num(leg[5]);
      if (!first.has(strike)) first.set(strike, { ceVol, peVol });
      seen.set(strike, (seen.get(strike) ?? 0) + 1);
      last.set(strike, { ceVol, peVol, ceOi, peOi });
    }
  }
  if (last.size === 0) return empty;

  // Reference spot for the ±window and the ATM anchor.
  let refSpot: number | null = null;
  if (opts.spot !== null && opts.spot !== undefined && Number.isFinite(opts.spot)) {
    refSpot = opts.spot as number;
  } else {
    for (let i = list.length - 1; i >= 0; i--) {
      const s = Number(list[i]?.spot);
      if (Number.isFinite(s) && s > 0) {
        refSpot = s;
        break;
      }
    }
    if (refSpot === null) {
      for (let i = list.length - 1; i >= 0; i--) {
        const a = Number(list[i]?.atm_strike);
        if (Number.isFinite(a) && a > 0) {
          refSpot = a;
          break;
        }
      }
    }
  }

  const collected: VolumeProfilePoint[] = [];
  for (const [strike, l] of last) {
    if (refSpot !== null && Math.abs(strike - refSpot) > widthPts) continue;
    const f = first.get(strike) ?? { ceVol: 0, peVol: 0 };
    // Single observation: the tape started on this strike, so its full
    // cumulative value IS the day's traded delta.
    const once = (seen.get(strike) ?? 0) <= 1;
    const ceVol = mode === "delta" ? (once ? l.ceVol : Math.max(0, l.ceVol - f.ceVol)) : l.ceVol;
    const peVol = mode === "delta" ? (once ? l.peVol : Math.max(0, l.peVol - f.peVol)) : l.peVol;
    collected.push({ strike, ceVol, peVol, ceOi: l.ceOi, peOi: l.peOi, total: ceVol + peVol });
  }
  const points = sortByField(collected, "strike", "asc");
  if (points.length === 0) return empty;

  let atmStrike: number | null = null;
  if (refSpot !== null) {
    let best = Infinity;
    for (const p of points) {
      const d = Math.abs(p.strike - (refSpot as number));
      if (d < best || (d === best && (atmStrike === null || p.strike < atmStrike))) {
        best = d;
        atmStrike = p.strike;
      }
    }
  }

  let topStrike: number | null = null;
  let topTotal = -1;
  const totals: VolumeProfileTotals = { ceVol: 0, peVol: 0, ceOi: 0, peOi: 0 };
  for (const p of points) {
    totals.ceVol += p.ceVol;
    totals.peVol += p.peVol;
    totals.ceOi += p.ceOi;
    totals.peOi += p.peOi;
    if (p.total > topTotal) {
      topTotal = p.total;
      topStrike = p.strike;
    }
  }

  return { points, atmStrike, topStrike, totals };
}

/** Unsigned compact volume: 1.25M / 850.00K / 912, dash when absent. */
export function formatProfileCompact(v: number | null | undefined): string {
  return formatReportCompact(v, { round: true });
}
