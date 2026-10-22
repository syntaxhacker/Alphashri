/**
 * Participant flow over the NIFTY tape — pure builder.
 *
 * Per clock bucket, splits option flow into writers vs buyers on each leg
 * (CE / PE) from per-strike OI **and** premium changes between consecutive
 * tape rows:
 *
 * - OI build + premium up   → buyers (long buildup)
 * - OI build + premium down → writers (short buildup)
 * - OI unwind + premium up  → cover (short covering → separate bucket)
 * - OI unwind + premium down → liquidation (long unwind → writer side)
 *
 * Magnitude is premium rupees (`|ΔOI| × avg premium`); when the premium is
 * missing or non-positive it falls back to `|ΔOI|` lots. Cover is kept as
 * its own `ceCover` / `peCover` bucket (the chart stacks it on the buy
 * side), while liquidation joins the writer side (supply leaving).
 *
 * Chain legs are `[ce_ltp, pe_ltp, ce_oi, pe_oi, ce_vol, pe_vol]`; row shape
 * is declared locally and both snake_case / camelCase time fields work.
 */

/** Minimal tape row — only `t` plus the optional per-strike chain. */
export interface ParticipantFlowRow {
  t: string;
  chain?: Record<string, number[] | undefined> | null;
}

/** Who traded, read from ΔOI + premium direction. */
export type FlowKind = "writers" | "buyers" | "cover" | "liquidation" | "none";

/** One clock bucket of classified flow (₹ premium, see above). */
export interface ParticipantFlowBucket {
  /** `HH:MM` bucket start. */
  label: string;
  /** Minutes since midnight of the bucket start (`null` when unparseable). */
  startMin: number | null;
  ceWriters: number;
  ceBuyers: number;
  ceCover: number;
  peWriters: number;
  peBuyers: number;
  peCover: number;
  /** (buyers + cover) − writers across both legs. */
  net: number;
}

/** Chain leg indexes: `[ce_ltp, pe_ltp, ce_oi, pe_oi, ce_vol, pe_vol]`. */
const CE_LTP_IDX = 0;
const PE_LTP_IDX = 1;
const CE_OI_IDX = 2;
const PE_OI_IDX = 3;

function finiteOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Minutes since midnight; `null` when the timestamp is unparseable. */
export function flowClockMinutes(t: string | null | undefined): number | null {
  const raw = String(t ?? "").trim();
  if (!raw) return null;
  const clock = /(\d{1,2}):(\d{2})/.exec(raw);
  if (clock) {
    const h = Number(clock[1]);
    const m = Number(clock[2]);
    if (Number.isFinite(h) && Number.isFinite(m) && h < 24 && m < 60) {
      return h * 60 + m;
    }
    return null;
  }
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) {
    const d = new Date(parsed);
    return d.getHours() * 60 + d.getMinutes();
  }
  return null;
}

/** `HH:MM` label for a bucket start (`"—"` when unknown). */
export function flowBucketLabel(startMin: number | null): string {
  if (startMin === null || !Number.isFinite(startMin)) return "—";
  const h = Math.floor(startMin / 60);
  const m = startMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Classify one leg's move. Zero / non-finite ΔOI or Δpremium carries no
 * information → `"none"` (ignored, never attributed).
 */
export function classifyParticipantFlow(
  dOi: number | null | undefined,
  dPrem: number | null | undefined,
): FlowKind {
  if (
    dOi === null ||
    dOi === undefined ||
    dPrem === null ||
    dPrem === undefined ||
    !Number.isFinite(dOi) ||
    !Number.isFinite(dPrem) ||
    dOi === 0 ||
    dPrem === 0
  ) {
    return "none";
  }
  if (dOi > 0) return dPrem > 0 ? "buyers" : "writers";
  return dPrem > 0 ? "cover" : "liquidation";
}

/**
 * Rupee magnitude of one leg's move: `|ΔOI| × avg premium`. Falls back to
 * `|ΔOI|` lots when the average premium is missing / non-positive.
 */
export function legFlowAmount(
  dOi: number,
  premBefore: number | null,
  premAfter: number | null,
): number {
  const qty = Math.abs(dOi);
  const a = finiteOrNull(premBefore);
  const b = finiteOrNull(premAfter);
  const avg =
    a !== null && b !== null
      ? (a + b) / 2
      : (a ?? b);
  if (avg !== null && avg > 0) return qty * avg;
  return qty;
}

/**
 * Bucket consecutive-row flow into `bucketMin`-minute clock buckets
 * (default 30). Each consecutive pair's per-strike ΔOI/Δpremium is
 * attributed to the bucket holding the **later** row; pairs where either
 * row lacks a chain are skipped. Every bucket that holds at least one row
 * appears in the output (zero-flow buckets included) so the chart's time
 * axis never drops quiet stretches.
 */
export function buildParticipantFlow(
  rows: ParticipantFlowRow[],
  opts?: { bucketMin?: number },
): ParticipantFlowBucket[] {
  const bucketMin = opts?.bucketMin && opts.bucketMin > 0 ? opts.bucketMin : 30;
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return [];

  const indexed = list.map((row, i) => ({ row, i }));
  indexed.sort((a, b) => {
    const ta = flowClockMinutes(a.row?.t);
    const tb = flowClockMinutes(b.row?.t);
    if (ta === null && tb === null) return a.i - b.i;
    if (ta === null) return 1;
    if (tb === null) return -1;
    return ta === tb ? a.i - b.i : ta - tb;
  });
  const ordered = indexed.map((x) => x.row);

  const starts = ordered.map((r) => {
    const mins = flowClockMinutes(r?.t);
    return mins === null ? null : Math.floor(mins / bucketMin) * bucketMin;
  });

  const order: Array<number | null> = [];
  const buckets = new Map<number | null, ParticipantFlowBucket>();
  const ensure = (start: number | null): ParticipantFlowBucket => {
    let b = buckets.get(start);
    if (!b) {
      b = {
        label: flowBucketLabel(start),
        startMin: start,
        ceWriters: 0,
        ceBuyers: 0,
        ceCover: 0,
        peWriters: 0,
        peBuyers: 0,
        peCover: 0,
        net: 0,
      };
      buckets.set(start, b);
      order.push(start);
    }
    return b;
  };
  for (const s of starts) ensure(s);

  for (let i = 1; i < ordered.length; i++) {
    const before = ordered[i - 1];
    const after = ordered[i];
    const chainBefore = before?.chain;
    const chainAfter = after?.chain;
    if (!chainBefore || !chainAfter || typeof chainBefore !== "object" || typeof chainAfter !== "object") {
      continue;
    }
    const bucket = ensure(starts[i]);
    const strikes = new Set([...Object.keys(chainBefore), ...Object.keys(chainAfter)]);
    for (const key of strikes) {
      if (!Number.isFinite(Number(key))) continue;
      const legBefore = chainBefore[key];
      const legAfter = chainAfter[key];
      if (!Array.isArray(legBefore) || !Array.isArray(legAfter)) continue;
      const ceOiBefore = finiteOrNull(legBefore[CE_OI_IDX]);
      const ceOiAfter = finiteOrNull(legAfter[CE_OI_IDX]);
      const peOiBefore = finiteOrNull(legBefore[PE_OI_IDX]);
      const peOiAfter = finiteOrNull(legAfter[PE_OI_IDX]);
      const cePremBefore = finiteOrNull(legBefore[CE_LTP_IDX]);
      const cePremAfter = finiteOrNull(legAfter[CE_LTP_IDX]);
      const pePremBefore = finiteOrNull(legBefore[PE_LTP_IDX]);
      const pePremAfter = finiteOrNull(legAfter[PE_LTP_IDX]);
      if (ceOiBefore !== null && ceOiAfter !== null && cePremBefore !== null && cePremAfter !== null) {
        const dOi = ceOiAfter - ceOiBefore;
        const dPrem = cePremAfter - cePremBefore;
        const kind = classifyParticipantFlow(dOi, dPrem);
        if (kind !== "none") {
          const amount = legFlowAmount(dOi, cePremBefore, cePremAfter);
          if (kind === "buyers") bucket.ceBuyers += amount;
          else if (kind === "writers" || kind === "liquidation") bucket.ceWriters += amount;
          else bucket.ceCover += amount;
        }
      }
      if (peOiBefore !== null && peOiAfter !== null && pePremBefore !== null && pePremAfter !== null) {
        const dOi = peOiAfter - peOiBefore;
        const dPrem = pePremAfter - pePremBefore;
        const kind = classifyParticipantFlow(dOi, dPrem);
        if (kind !== "none") {
          const amount = legFlowAmount(dOi, pePremBefore, pePremAfter);
          if (kind === "buyers") bucket.peBuyers += amount;
          else if (kind === "writers" || kind === "liquidation") bucket.peWriters += amount;
          else bucket.peCover += amount;
        }
      }
    }
  }

  const out = order.map((s) => buckets.get(s) as ParticipantFlowBucket);
  for (const b of out) {
    b.ceWriters = round2(b.ceWriters);
    b.ceBuyers = round2(b.ceBuyers);
    b.ceCover = round2(b.ceCover);
    b.peWriters = round2(b.peWriters);
    b.peBuyers = round2(b.peBuyers);
    b.peCover = round2(b.peCover);
    b.net = round2(
      b.ceBuyers + b.ceCover + b.peBuyers + b.peCover - b.ceWriters - b.peWriters,
    );
  }
  return out;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
