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
import { safeNumNull } from "@/utils/reportParsers";
import { chainLeg, chainMetric, type ChainMap } from "./chainTuple";

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
  chain?: ChainMap | null;
}

type HeatCellSign = "ce" | "pe" | "flat";

interface HeatBucket {
  /** ISO timestamp of the bucket's last row (empty when no tape row landed). */
  t: string;
  /** Short HH:MM label of the bucket's representative (last) row. */
  label: string;
  /** HH:MM wall-clock start of the bucket — used for axis ticks. */
  startLabel: string;
  /** Spot of the bucket's representative row; null for a padded empty bucket
   *  (tape started after the session's first candle). */
  spot: number | null;
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
  /** CE/PE LTP change vs the previous data bucket (premium evidence). This is
   *  computed regardless of the cell `metric` so a read can tell buyers from
   *  writers: OI up + premium up = buying, OI up + premium down = writing. */
  cePremiumDoi: number | null;
  pePremiumDoi: number | null;
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
  /** Field the cells colour (OI change / volume / premium change). */
  metric: "oi" | "volume" | "premium";
}

interface HeatmapOptions {
  bucketMin?: number;
  widthPts?: number;
  /** Max-pain touch window in points (any row in the bucket). */
  touchTol?: number;
  /**
   * Which field the cells colour: OI change (default), traded volume, or
   * premium change. Volume answers "where is the fight" (2026-10-23 13:33
   * printed 17.5M at 22,450 before the break); premium answers "who is paying".
   */
  metric?: "oi" | "volume" | "premium";
  /**
   * Session anchor for the time axis (the first intraday candle, 09:15). When
   * supplied, the axis starts there and missing tape minutes become empty
   * buckets instead of being silently compressed out of the left edge.
   */
  startTime?: string | null;
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
  metric: "oi" | "volume" | "premium" = "oi",
): { ce: number | null; pe: number | null } {
  const leg = chainLeg(chain, strike);
  return chainMetric(leg, metric);
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
  const metric = opts.metric ?? "oi";
  const empty: OiHeatmap = { buckets: [], strikes: [], cells: [], maxAbs: 0, empty: true, metric };

  const asc = (rows ?? [])
    .filter((r) => r && typeof r.t === "string" && r.t.length > 0)
    .sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  if (asc.length === 0) return empty;

  // Reference spot = last row with a finite spot (drives the ±width window).
  let refSpot = 0;
  for (let i = asc.length - 1; i >= 0; i--) {
    const s = safeNumNull(asc[i].spot);
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

  // Time buckets anchored at the session's first candle when the caller passes
  // `startTime`; otherwise at the first tape row's minute. Padding the axis
  // from 09:15 makes the opening pump visible even when the first chain
  // snapshot arrived at 09:30 (the old axis silently started at 09:30).
  const rowFirstMin = heatMinutes(asc[0].t) ?? 0;
  const requestedMin = opts.startTime ? heatMinutes(opts.startTime) : null;
  const firstMin = requestedMin !== null && requestedMin < rowFirstMin ? requestedMin : rowFirstMin;
  const padFromStart = requestedMin !== null && requestedMin < rowFirstMin;
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
  const presentKeys = [...bucketRows.keys()].sort((a, b) => a - b);
  const keys = padFromStart
    ? Array.from({ length: presentKeys[presentKeys.length - 1] + 1 }, (_, i) => i)
    : presentKeys;

  // Representative = last row of each bucket (latest chain snapshot). A bucket
  // still counts as a max-pain touch when ANY row inside it sat on the pin —
  // the representative row can be several points away by the bucket's end.
  const buckets: HeatBucket[] = keys.map((b) => {
    const list = bucketRows.get(b) ?? [];
    const startLabel = clockLabel(firstMin + b * Math.max(1, bucketMin));
    if (list.length === 0) {
      return {
        t: "",
        label: startLabel,
        startLabel,
        spot: null,
        maxPain: null,
        flip: null,
        atmStrike: null,
        touch: null,
      };
    }
    const rep = list[list.length - 1];
    const mp = safeNumNull(rep.max_pain ?? rep.maxPain);
    const flip = safeNumNull(rep.flip);
    const atm = safeNumNull(rep.atm_strike);
    const touches = maxPainTouches(
      list.map((r) => ({ value: safeNumNull(r.spot) ?? NaN, maxPain: safeNumNull(r.max_pain ?? r.maxPain) })),
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
      startLabel,
      spot: safeNumNull(rep.spot) ?? 0,
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

  // Per-cell ΔOI vs the previous DATA bucket's representative chain. Empty
  // padded buckets carry null deltas; the next data bucket still measures
  // against the last real snapshot across the gap.
  const cells: HeatCell[] = [];
  let maxAbs = 0;
  let prevRep: HeatmapTapeRow | null = null;
  keys.forEach((b, bi) => {
    const list = bucketRows.get(b) ?? [];
    const rep = list.length > 0 ? list[list.length - 1] : null;
    if (!rep) {
      for (const strike of strikes) {
        cells.push({
          bucket: bi,
          strike,
          ceDoi: null,
          peDoi: null,
          cePremiumDoi: null,
          pePremiumDoi: null,
          sign: "flat",
          intensity: 0,
        });
      }
      return;
    }
    for (const strike of strikes) {
      if (!prevRep) {
        cells.push({
          bucket: bi,
          strike,
          ceDoi: null,
          peDoi: null,
          cePremiumDoi: null,
          pePremiumDoi: null,
          sign: "flat",
          intensity: 0,
        });
        continue;
      }
      const cur = strikeOi(rep.chain, strike, metric);
      const prev = strikeOi(prevRep.chain, strike, metric);
      const ceDoi = cur.ce !== null && prev.ce !== null ? cur.ce - prev.ce : null;
      const peDoi = cur.pe !== null && prev.pe !== null ? cur.pe - prev.pe : null;
      // Premium leg [0,1] is always read, independent of the colour metric.
      const curPrem = strikeOi(rep.chain, strike, "premium");
      const prevPrem = strikeOi(prevRep.chain, strike, "premium");
      const cePremiumDoi =
        curPrem.ce !== null && prevPrem.ce !== null ? curPrem.ce - prevPrem.ce : null;
      const pePremiumDoi =
        curPrem.pe !== null && prevPrem.pe !== null ? curPrem.pe - prevPrem.pe : null;
      const net = (ceDoi ?? 0) - (peDoi ?? 0);
      const sign: HeatCellSign =
        ceDoi === null && peDoi === null ? "flat" : net > 0 ? "ce" : net < 0 ? "pe" : "flat";
      const mag = Math.max(Math.abs(ceDoi ?? 0), Math.abs(peDoi ?? 0));
      if (mag > maxAbs) maxAbs = mag;
      cells.push({
        bucket: bi,
        strike,
        ceDoi,
        peDoi,
        cePremiumDoi,
        pePremiumDoi,
        sign,
        intensity: 0,
      });
    }
    prevRep = rep;
  });

  if (maxAbs > 0) {
    for (const c of cells) {
      c.intensity = Math.max(Math.abs(c.ceDoi ?? 0), Math.abs(c.peDoi ?? 0)) / maxAbs;
    }
  }

  return { buckets, strikes, cells, maxAbs, empty: false, metric };
}

interface HeatmapRead {
  /** Strike with the largest positive CE ΔOI (call writers pressing). */
  ceStrike: number | null;
  ceDoi: number | null;
  /** CE premium change at `ceStrike` in the winning bucket (null = no evidence). */
  cePremiumDoi: number | null;
  /** Strike with the largest positive PE ΔOI (put buyers). */
  peStrike: number | null;
  peDoi: number | null;
  /** PE premium change at `peStrike` in the winning bucket (null = no evidence). */
  pePremiumDoi: number | null;
  /** Spot from the latest bucket that carries one. */
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
  let cePremiumDoi: number | null = null;
  let peStrike: number | null = null;
  let peDoi: number | null = null;
  let pePremiumDoi: number | null = null;

  for (const c of model.cells) {
    if (c.ceDoi !== null && c.ceDoi > 0 && (ceDoi === null || c.ceDoi > ceDoi)) {
      ceDoi = c.ceDoi;
      ceStrike = c.strike;
      cePremiumDoi = c.cePremiumDoi;
    }
    if (c.peDoi !== null && c.peDoi > 0 && (peDoi === null || c.peDoi > peDoi)) {
      peDoi = c.peDoi;
      peStrike = c.strike;
      pePremiumDoi = c.pePremiumDoi;
    }
  }

  // Latest bucket that actually carries a spot (padded empty buckets are null).
  let last: (typeof model.buckets)[number] | null = null;
  for (let i = model.buckets.length - 1; i >= 0; i--) {
    const b = model.buckets[i];
    if (b.spot !== null && Number.isFinite(b.spot) && b.spot > 0) {
      last = b;
      break;
    }
  }
  const spot = last?.spot ?? null;

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

  return {
    ceStrike,
    ceDoi,
    cePremiumDoi,
    peStrike,
    peDoi,
    pePremiumDoi,
    spot,
    maxPain,
    spotVsMaxPain,
  };
}

/** Buyer/writer wording only when premium evidence exists; otherwise the
 *  neutral OI-build clause (OI alone cannot name the initiator). */
function buildClause(
  side: "CE" | "PE",
  strike: number | null,
  premiumDoi: number | null,
): string | null {
  if (strike === null) return null;
  if (premiumDoi !== null && Number.isFinite(premiumDoi) && premiumDoi !== 0) {
    const who = premiumDoi > 0 ? "buyers" : "writers";
    return `${side === "CE" ? "call" : "put"} ${who} at ${fmtStrike(strike)}`;
  }
  return `${side} OI build at ${fmtStrike(strike)}`;
}

/**
 * One-line interpretation of a heatmap read:
 * `call buyers at 23,000 · put writers at 22,700 · spot 22,738 below max pain 22,900`.
 * Buyer/writer wording appears only when the premium delta proves it (OI up +
 * premium up = buying; OI up + premium down = writing). Otherwise the clause
 * stays neutral (`CE OI build at …`). Clauses whose data is missing are omitted.
 */
export function heatmapReadText(read: HeatmapRead): string {
  const parts: string[] = [];
  const call = buildClause("CE", read.ceStrike, read.cePremiumDoi);
  const put = buildClause("PE", read.peStrike, read.pePremiumDoi);
  if (call) parts.push(call);
  if (put) parts.push(put);
  if (read.spot !== null && read.maxPain !== null && read.spotVsMaxPain !== null) {
    parts.push(`spot ${fmtStrike(read.spot)} ${read.spotVsMaxPain} max pain ${fmtStrike(read.maxPain)}`);
  }
  return parts.join(" · ");
}
