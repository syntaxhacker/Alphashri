/**
 * OI heatmap builder — pure, no store, no network.
 *
 * Input is the NIFTY tape (`fetchNiftyTape`). Each tape row may carry a
 * `chain` snapshot shaped like the backend's `_premium_chain_snapshot`:
 * `{[strike]: [ce_ltp, pe_ltp, ce_oi, pe_oi, ce_vol, pe_vol]}` with dead legs
 * stored as `null`. Older tapes have no `chain` at all — the builder then
 * returns an empty-strikes model so the component can render its muted state.
 *
 * Bucketing: rows are sorted ascending by `t` and grouped into wall-clock
 * buckets of `bucketMin` minutes. The first bucket has no predecessor, so its
 * cells carry `null` deltas (`flat` sign, zero intensity).
 */

import { MAX_PAIN_TOUCH_TOL, maxPainTouches } from "./maxPainTouches";
import { formatReportNum } from "./reportFormat";

export type ChainTuple = [
  ce_ltp: number | null,
  pe_ltp: number | null,
  ce_oi: number | null,
  pe_oi: number | null,
  ce_vol: number | null,
  pe_vol: number | null,
];

/** Minimal tape-row surface this builder reads — deliberately local so the
 *  component never depends on another agent's in-flight file. */
export interface HeatmapTapeRow {
  t: string;
  spot: number;
  atm_strike?: number | null;
  max_pain?: number | null;
  maxPain?: number | null;
  flip?: number | null;
  walls?: { call?: number; put?: number } | null;
  chain?: Record<string, ChainTuple | (number | null)[]> | null;
}

type HeatCellSign = "ce" | "pe" | "flat";

interface HeatBucket {
  /** ISO timestamp of the bucket's last row. */
  t: string;
  /** Short HH:MM label of the bucket's representative (last) row. */
  label: string;
  /** HH:MM wall-clock start of the bucket — used for axis ticks. */
  startLabel: string;
  spot: number;
  maxPain: number | null;
  flip: number | null;
  atmStrike: number | null;
  /** Closest row *inside* this bucket whose spot sat on the max-pain pin
   *  (`|spot − row maxPain| ≤ touchTol`). Null when no row touched. */
  touch: HeatBucketTouch | null;
}

interface HeatBucketTouch {
  /** HH:MM of the touching row (not necessarily the representative). */
  label: string;
  /** Spot of the touching row — where the circle is drawn. */
  spot: number;
  maxPain: number;
  distance: number;
}

interface HeatCell {
  bucket: number;
  strike: number;
  ceDoi: number | null;
  peDoi: number | null;
  sign: HeatCellSign;
  /** 0..1, normalized by the largest |ΔOI| in the whole model. */
  intensity: number;
}

interface OiHeatmap {
  buckets: HeatBucket[];
  /** Ascending, within spot ± widthPts of the last row's spot. */
  strikes: number[];
  cells: HeatCell[];
  /** Largest |ΔOI| across all cells (0 when there is no data). */
  maxAbs: number;
  /** True when no row carried a usable chain. */
  empty: boolean;
}

interface HeatmapOptions {
  bucketMin?: number;
  widthPts?: number;
  /** Max-pain touch window in points (any row in the bucket). */
  touchTol?: number;
}

/** Plot geometry (viewBox) shared with the flow strip below the heatmap. */
export const HEATMAP_VB_W = 1000;
export const HEATMAP_PAD_L = 64;

/**
 * The heatmap's time axis: which wall-clock bucket each tape minute falls
 * into. The flow strip positions its ticks with the SAME map, so a 09:36
 * burst lands under the 09:36 heatmap column instead of at "1/3 of the
 * events" (which put a 15:00 burst next to a 09:20 one).
 */
function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** IST wall-clock HH:MM for an ISO stamp or a bare HH:MM. */
function heatTimeLabel(t: string): string {
  if (!t) return "--:--";
  if (t.includes("T")) {
    const time = t.split("T")[1] ?? "";
    return time.slice(0, 5) || "--:--";
  }
  return t.slice(0, 5);
}

function heatMinutes(t: string): number | null {
  const label = heatTimeLabel(t);
  const m = /^(\d{1,2}):(\d{2})/.exec(label);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Minutes-since-midnight → zero-padded HH:MM (wraps past midnight). */
function clockLabel(minutes: number): string {
  const total = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function strikeOi(
  chain: HeatmapTapeRow["chain"],
  strike: number,
): { ce: number | null; pe: number | null } {
  if (!chain || typeof chain !== "object") return { ce: null, pe: null };
  const entry = chain[String(strike)] ?? chain[String(Math.round(strike))];
  if (!Array.isArray(entry) || entry.length < 4) return { ce: null, pe: null };
  return { ce: num(entry[2]), pe: num(entry[3]) };
}

function hasChain(row: HeatmapTapeRow): boolean {
  const c = row.chain;
  return !!c && typeof c === "object" && Object.keys(c).length > 0;
}

export function buildOiHeatmap(
  rows: HeatmapTapeRow[],
  opts: HeatmapOptions = {},
): OiHeatmap {
  const bucketMin = opts.bucketMin ?? 5;
  const widthPts = opts.widthPts ?? 500;
  const touchTol = opts.touchTol ?? MAX_PAIN_TOUCH_TOL;
  const empty: OiHeatmap = { buckets: [], strikes: [], cells: [], maxAbs: 0, empty: true };

  const asc = (rows ?? [])
    .filter((r) => r && typeof r.t === "string" && r.t.length > 0)
    .sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  if (asc.length === 0) return empty;

  // Reference spot = last row with a finite spot (drives the ±width window).
  let refSpot = 0;
  for (let i = asc.length - 1; i >= 0; i--) {
    const s = num(asc[i].spot);
    if (s !== null && s > 0) {
      refSpot = s;
      break;
    }
  }
  if (refSpot <= 0) return empty;

  // Strike universe: union of chain keys within spot ± width.
  const universe = new Set<number>();
  for (const r of asc) {
    if (!hasChain(r)) continue;
    for (const k of Object.keys(r.chain as Record<string, unknown>)) {
      const s = Number(k);
      if (Number.isFinite(s) && s > 0 && Math.abs(s - refSpot) <= widthPts) universe.add(s);
    }
  }
  const strikes = [...universe].sort((a, b) => a - b);
  if (strikes.length === 0) return empty;

  // Time buckets anchored at the first row's minute.
  const firstMin = heatMinutes(asc[0].t) ?? 0;
  const bucketOf = (t: string): number => {
    const m = heatMinutes(t);
    if (m === null) return 0;
    return Math.max(0, Math.floor((m - firstMin) / Math.max(1, bucketMin)));
  };
  const bucketRows = new Map<number, HeatmapTapeRow[]>();
  for (const r of asc) {
    const b = bucketOf(r.t);
    const list = bucketRows.get(b) ?? [];
    list.push(r);
    bucketRows.set(b, list);
  }
  const keys = [...bucketRows.keys()].sort((a, b) => a - b);

  // Representative = last row of each bucket (latest chain snapshot). A bucket
  // still counts as a max-pain touch when ANY row inside it sat on the pin —
  // the representative row can be several points away by the bucket's end.
  const buckets: HeatBucket[] = keys.map((b) => {
    const list = bucketRows.get(b) as HeatmapTapeRow[];
    const rep = list[list.length - 1];
    const mp = num(rep.max_pain ?? rep.maxPain);
    const flip = num(rep.flip);
    const atm = num(rep.atm_strike);
    const touches = maxPainTouches(
      list.map((r) => ({ value: num(r.spot) ?? NaN, maxPain: num(r.max_pain ?? r.maxPain) })),
      touchTol,
    );
    // Closest wins; ties keep the earlier row.
    const best = touches.reduce<(typeof touches)[number] | null>(
      (acc, t) => (acc === null || t.distance < acc.distance ? t : acc),
      null,
    );
    return {
      t: rep.t,
      label: heatTimeLabel(rep.t),
      startLabel: clockLabel(firstMin + b * Math.max(1, bucketMin)),
      spot: num(rep.spot) ?? 0,
      maxPain: mp !== null && mp > 0 ? mp : null,
      flip: flip !== null && flip !== 0 ? flip : null,
      atmStrike: atm !== null && atm > 0 ? atm : null,
      touch:
        best === null
          ? null
          : {
              label: heatTimeLabel(list[best.index].t),
              spot: best.value,
              maxPain: best.maxPain,
              distance: best.distance,
            },
    };
  });

  // Per-cell ΔOI vs the previous bucket's representative chain.
  const cells: HeatCell[] = [];
  let maxAbs = 0;
  keys.forEach((b, bi) => {
    const rep = (bucketRows.get(b) as HeatmapTapeRow[]).slice(-1)[0];
    const prevRep = bi > 0 ? ((bucketRows.get(keys[bi - 1]) as HeatmapTapeRow[]).slice(-1)[0]) : null;
    for (const strike of strikes) {
      if (bi === 0 || !prevRep) {
        cells.push({ bucket: bi, strike, ceDoi: null, peDoi: null, sign: "flat", intensity: 0 });
        continue;
      }
      const cur = strikeOi(rep.chain, strike);
      const prev = strikeOi(prevRep.chain, strike);
      const ceDoi = cur.ce !== null && prev.ce !== null ? cur.ce - prev.ce : null;
      const peDoi = cur.pe !== null && prev.pe !== null ? cur.pe - prev.pe : null;
      const net = (ceDoi ?? 0) - (peDoi ?? 0);
      const sign: HeatCellSign =
        ceDoi === null && peDoi === null ? "flat" : net > 0 ? "ce" : net < 0 ? "pe" : "flat";
      const mag = Math.max(Math.abs(ceDoi ?? 0), Math.abs(peDoi ?? 0));
      if (mag > maxAbs) maxAbs = mag;
      cells.push({ bucket: bi, strike, ceDoi, peDoi, sign, intensity: 0 });
    }
  });

  if (maxAbs > 0) {
    for (const c of cells) {
      c.intensity = Math.max(Math.abs(c.ceDoi ?? 0), Math.abs(c.peDoi ?? 0)) / maxAbs;
    }
  }

  return { buckets, strikes, cells, maxAbs, empty: false };
}

interface HeatmapRead {
  /** Strike with the largest positive CE ΔOI (call writers pressing). */
  ceStrike: number | null;
  ceDoi: number | null;
  /** Strike with the largest positive PE ΔOI (put buyers). */
  peStrike: number | null;
  peDoi: number | null;
  /** Spot from the latest bucket. */
  spot: number | null;
  /** Latest non-null max-pain level. */
  maxPain: number | null;
  spotVsMaxPain: "above" | "below" | "at" | null;
}

function fmtStrike(v: number): string {
  return formatReportNum(v, { round: true });
}

/** Plain-English read of the strongest OI builds on the tape. */
export function readHeatmap(model: OiHeatmap): HeatmapRead {
  let ceStrike: number | null = null;
  let ceDoi: number | null = null;
  let peStrike: number | null = null;
  let peDoi: number | null = null;

  for (const c of model.cells) {
    if (c.ceDoi !== null && c.ceDoi > 0 && (ceDoi === null || c.ceDoi > ceDoi)) {
      ceDoi = c.ceDoi;
      ceStrike = c.strike;
    }
    if (c.peDoi !== null && c.peDoi > 0 && (peDoi === null || c.peDoi > peDoi)) {
      peDoi = c.peDoi;
      peStrike = c.strike;
    }
  }

  const last = model.buckets.length > 0 ? model.buckets[model.buckets.length - 1] : null;
  const spot = last && Number.isFinite(last.spot) && last.spot > 0 ? last.spot : null;

  let maxPain: number | null = null;
  for (let i = model.buckets.length - 1; i >= 0; i--) {
    const mp = model.buckets[i].maxPain;
    if (mp !== null && Number.isFinite(mp) && mp > 0) {
      maxPain = mp;
      break;
    }
  }

  const spotVsMaxPain: HeatmapRead["spotVsMaxPain"] =
    spot === null || maxPain === null ? null : spot > maxPain ? "above" : spot < maxPain ? "below" : "at";

  return { ceStrike, ceDoi, peStrike, peDoi, spot, maxPain, spotVsMaxPain };
}

/**
 * One-line interpretation of a heatmap read:
 * `Call writers pressing 23,000 · put buyers at 22,700 · spot 22,738 below max pain 22,900`.
 * Clauses whose data is missing are omitted.
 */
export function heatmapReadText(read: HeatmapRead): string {
  const parts: string[] = [];
  if (read.ceStrike !== null) parts.push(`Call writers pressing ${fmtStrike(read.ceStrike)}`);
  if (read.peStrike !== null) parts.push(`put buyers at ${fmtStrike(read.peStrike)}`);
  if (read.spot !== null && read.maxPain !== null && read.spotVsMaxPain !== null) {
    parts.push(`spot ${fmtStrike(read.spot)} ${read.spotVsMaxPain} max pain ${fmtStrike(read.maxPain)}`);
  }
  return parts.join(" · ");
}
