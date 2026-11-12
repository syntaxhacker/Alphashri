import { formatNumberIN } from "@/utils/ui-helpers";
import { safeNum } from "@/utils/reportParsers";
import { ascTapeByTime } from "./tapeRange";
/**
 * Flow-event strip builder — pure, no store, no network.
 *
 * Collapses the tape into a thin lane of events:
 * - `burst`: a minute whose |ΔOI| (first difference of the cumulative
 *   `call_doi`/`put_doi`) meets `burstThreshold` (default 2M units).
 * - `wall`: the top call-wall or top put-wall strike changed.
 * - `maxpain`: `max_pain` changed.
 * - `atm`: `atm_strike` changed.
 *
 * Side convention: put build / call unwind read bullish (green); call build /
 * put unwind read bearish (red); wall / max-pain / ATM shifts are structural
 * (neutral, amber in the strip).
 */

export type FlowKind = "burst" | "wall" | "maxpain" | "atm";
export type FlowSide = "bullish" | "bearish" | "neutral";

export interface FlowTapeRow {
  t: string;
  spot?: number;
  call_doi?: number;
  put_doi?: number;
  max_pain?: number | null;
  maxPain?: number | null;
  atm_strike?: number | null;
  walls?: { call?: number; put?: number } | null;
}

export interface FlowEvent {
  t: string;
  kind: FlowKind;
  label: string;
  side: FlowSide;
  /** Contracts for bursts, points for wall/max-pain/ATM shifts. */
  magnitude: number;
  /** Signed change: contracts for bursts, points for structural shifts. */
  delta: number;
  /** Segment identity used for run-length grouping (`put-unwind`, `call-build`, …). */
  segment: string;
}

interface FlowOptions {
  burstThreshold?: number;
}

const FLOW_BURST_THRESHOLD = 2_000_000;

/** Burst leg + direction → the human stem used by an aggregated bucket. */
const FLOW_SEGMENT_STEM: Record<string, string> = {
  putBuild: "Put build",
  putUnwind: "Put unwind",
  callBuild: "Call build",
  callUnwind: "Call unwind",
};

/** Default number of buckets shown in the one-line summary. */
/** The text lane shows only the newest runs; the tooltip keeps the full list. */
export const FLOW_SUMMARY_MAX_LABELS = 3;
/** Default character budget for the one-line summary (tail-biased). */
export const FLOW_SUMMARY_MAX_CHARS = 160;

function fmtInt(v: number): string {
  return formatNumberIN(Math.round(v));
}

function compact(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : "+";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${Math.round(abs)}`;
}

export function buildFlowEvents(rows: FlowTapeRow[], opts: FlowOptions = {}): FlowEvent[] {
  const threshold = opts.burstThreshold ?? FLOW_BURST_THRESHOLD;
  const asc = ascTapeByTime(rows);
  const out: FlowEvent[] = [];
  for (let i = 1; i < asc.length; i++) {
    const prev = asc[i - 1];
    const cur = asc[i];

    // Burst-like minutes on either side's first difference.
    const dCall = safeNum(cur.call_doi) - safeNum(prev.call_doi);
    const dPut = safeNum(cur.put_doi) - safeNum(prev.put_doi);
    if (Math.abs(dCall) >= threshold) {
      out.push({
        t: cur.t,
        kind: "burst",
        label: `Call ${dCall > 0 ? "build" : "unwind"} ${compact(dCall)}`,
        side: dCall > 0 ? "bearish" : "bullish",
        magnitude: Math.abs(dCall),
        delta: dCall,
        segment: dCall > 0 ? "call-build" : "call-unwind",
      });
    }
    if (Math.abs(dPut) >= threshold) {
      out.push({
        t: cur.t,
        kind: "burst",
        label: `Put ${dPut > 0 ? "build" : "unwind"} ${compact(dPut)}`,
        side: dPut > 0 ? "bullish" : "bearish",
        magnitude: Math.abs(dPut),
        delta: dPut,
        segment: dPut > 0 ? "put-build" : "put-unwind",
      });
    }

    // Top wall-strike changes.
    const pc = safeNum(cur.walls?.call);
    const pp = safeNum(prev.walls?.call);
    if (pc !== pp && pc > 0 && pp > 0) {
      out.push({
        t: cur.t,
        kind: "wall",
        label: `Call wall ${fmtInt(pp)} → ${fmtInt(pc)}`,
        side: "neutral",
        magnitude: Math.abs(pc - pp),
        delta: pc - pp,
        segment: "wall-call",
      });
    }
    const wc = safeNum(cur.walls?.put);
    const wp = safeNum(prev.walls?.put);
    if (wc !== wp && wc > 0 && wp > 0) {
      out.push({
        t: cur.t,
        kind: "wall",
        label: `Put wall ${fmtInt(wp)} → ${fmtInt(wc)}`,
        side: "neutral",
        magnitude: Math.abs(wc - wp),
        delta: wc - wp,
        segment: "wall-put",
      });
    }

    // Max-pain changes.
    const mpC = safeNum(cur.max_pain ?? cur.maxPain);
    const mpP = safeNum(prev.max_pain ?? prev.maxPain);
    if (mpC !== mpP && mpC > 0 && mpP > 0) {
      out.push({
        t: cur.t,
        kind: "maxpain",
        label: `Max pain ${fmtInt(mpP)} → ${fmtInt(mpC)}`,
        side: "neutral",
        magnitude: Math.abs(mpC - mpP),
        delta: mpC - mpP,
        segment: "maxpain",
      });
    }

    // ATM-strike roll.
    const aC = safeNum(cur.atm_strike);
    const aP = safeNum(prev.atm_strike);
    if (aC !== aP && aC > 0 && aP > 0) {
      out.push({
        t: cur.t,
        kind: "atm",
        label: `ATM ${fmtInt(aP)} → ${fmtInt(aC)}`,
        side: "neutral",
        magnitude: Math.abs(aC - aP),
        delta: aC - aP,
        segment: "atm",
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Run-length aggregation                                               */
/* ------------------------------------------------------------------ */

/**
 * One readable segment of the tape. Consecutive bursts on the same leg and in
 * the same direction collapse into a single bucket; structural shifts stay
 * one-per-event (summing a wall strike with a max-pain level is meaningless).
 */
export interface FlowBucket {
  /** Segment identity (`put-unwind`, `call-build`, `wall-call`, …). */
  segment: string;
  kind: FlowKind;
  side: FlowSide;
  /** First / last event timestamps in the bucket. */
  start: string;
  end: string;
  /** Number of events collapsed into this bucket. */
  count: number;
  /** Sum of signed deltas — contracts for bursts, points for structure. */
  total: number;
  /** Largest-magnitude delta in the bucket, keeping its sign (`peak`). */
  peak: number;
  /** Display label (`Put unwind −15.2M over 6m (peak −2.93M)`). */
  label: string;
  /** Per-event tooltip detail, never aggregated away. */
  detail: string;
  events: FlowEvent[];
}

/** Tape timestamps are ISO (`2026-10-26T11:30:00+05:30`); tooltips show HH:MM. */
export function clockLabel(t: string): string {
  const iso = /T(\d{2}:\d{2})/.exec(t);
  if (iso) return iso[1];
  const hm = /^(\d{2}:\d{2})/.exec(t);
  return hm ? hm[1] : t;
}

function bucketDetail(events: FlowEvent[]): string {
  const first = events[0];
  const last = events[events.length - 1];
  const prints = events.map((e) => `${clockLabel(e.t)} ${e.label}`).join(" · ");
  if (events.length === 1) return prints;
  return `${clockLabel(first.t)}–${clockLabel(last.t)} · ${events.length} prints · ${prints}`;
}

function bucketLabel(events: FlowEvent[], total: number, peak: number): string {
  if (events.length === 1) return events[0].label;
  const stem = FLOW_SEGMENT_STEM[events[0].segment] ?? events[0].label;
  return `${stem} ${compact(total)} over ${events.length}m (peak ${compact(peak)})`;
}

/**
 * Collapse consecutive same-segment bursts into one bucket that carries the
 * summed delta, the minute count and the peak print. A different segment or
 * any structural shift starts a new bucket.
 */
export function groupFlowRuns(events: FlowEvent[]): FlowBucket[] {
  const out: FlowBucket[] = [];
  for (const e of events ?? []) {
    const prev = out[out.length - 1];
    // Only burst runs collapse; structure is one row per move.
    if (prev && e.kind === "burst" && prev.kind === "burst" && prev.segment === e.segment) {
      const merged = [...prev.events, e];
      const total = prev.total + e.delta;
      const peak = Math.abs(e.delta) > Math.abs(prev.peak) ? e.delta : prev.peak;
      // Replace the bucket instead of mutating it (the summary memoizes on
      // bucket identity, and callers may keep the previous render's buckets).
      out[out.length - 1] = {
        ...prev,
        end: e.t,
        count: prev.count + 1,
        total,
        peak,
        label: bucketLabel(merged, total, peak),
        detail: bucketDetail(merged),
        events: merged,
      };
      continue;
    }
    out.push({
      segment: e.segment,
      kind: e.kind,
      side: e.side,
      start: e.t,
      end: e.t,
      count: 1,
      total: e.delta,
      peak: e.delta,
      label: e.label,
      detail: bucketDetail([e]),
      events: [e],
    });
  }
  return out;
}

export interface FlowSummaryOptions {
  /** Maximum number of bucket labels (the `+N earlier` marker is extra). */
  maxLabels?: number;
  /** Character budget for the whole line — keeps numbers whole. */
  maxChars?: number;
}

export interface FlowSummary {
  /** Buckets actually rendered. */
  visible: FlowBucket[];
  /** Buckets folded into the `+N earlier` marker. */
  hidden: number;
  /** Whether the `+N earlier` marker itself fits the lane. */
  showMarker: boolean;
  /** One-line render text (labels + marker). */
  text: string;
  /** Every bucket label, for the row tooltip. */
  fullText: string;
  truncated: boolean;
}

/** ` · ` is 3 char cells: the glyph plus the two 6px flex gaps (≈1 char each). */
const FLOW_SUMMARY_SEP = " · ";

function summaryText(visible: FlowBucket[], hidden: number, showMarker: boolean): string {
  const parts = visible.map((b) => b.label);
  if (showMarker && hidden > 0) parts.unshift(`+${hidden} earlier`);
  return parts.join(FLOW_SUMMARY_SEP);
}

/**
 * Display cost in character cells. The rendered separator is a `·` glyph with
 * 6px gaps on either side, i.e. ~3 char cells — exactly the width of the
 * ` · ` that `summaryText` joins with, so the string length is the real cost.
 */
function lineCost(visible: FlowBucket[], hidden: number, showMarker: boolean): number {
  return summaryText(visible, hidden, showMarker).length;
}

/**
 * Very short form used only when the lane cannot fit a full run label.
 * `Put unwind −15.94M over 6m (peak −2.93M)` → `Put unwind −15.94M`; structural
 * moves drop their "from" strike (`Max pain 25,700 → 25,800` → `Max pain 25,800`).
 */
function compactBucketLabel(b: FlowBucket): string {
  const stem = FLOW_SEGMENT_STEM[b.segment];
  if (b.kind === "burst" && stem) return `${stem} ${compact(b.total)}`;
  const arrow = " → ";
  if (b.label.includes(arrow)) {
    const [from, to] = b.label.split(arrow);
    const head = from.split(" ").slice(0, -1).join(" ");
    if (head && to) return `${head} ${to}`;
  }
  return b.label;
}

/**
 * Pick the newest buckets that fit both budgets. The oldest runs fold into a
 * leading `+N earlier` marker so the line never ends in a half-printed number.
 * If even one full label cannot fit, the surviving buckets switch to their
 * compact form rather than being clipped by CSS.
 */
export function summarizeFlowRuns(
  buckets: FlowBucket[],
  opts: FlowSummaryOptions = {},
): FlowSummary {
  const all = buckets ?? [];
  // The ATM strike rolls every time spot crosses a 50-pt boundary (48 of them
  // by lunch), so they crowd out every real event in the text lane. Keep them
  // on the lane itself, but only fall back to them in the text when there is
  // nothing else to say. A wall that shifts A→B and straight back carries no
  // information either — drop the pair instead of printing the flip-flop.
  const signal: FlowBucket[] = [];
  for (const b of all) {
    if (b.kind === "atm") continue;
    const prev = signal[signal.length - 1];
    if (
      prev &&
      prev.kind === "wall" &&
      b.kind === "wall" &&
      prev.segment === b.segment &&
      prev.total + b.total === 0
    ) {
      signal.pop();
      continue;
    }
    signal.push(b);
  }
  const pool = signal.length > 0 ? signal : all;
  const maxLabels = Math.max(1, Math.floor(opts.maxLabels ?? FLOW_SUMMARY_MAX_LABELS));
  const maxChars = Math.max(16, Math.floor(opts.maxChars ?? FLOW_SUMMARY_MAX_CHARS));
  const fullText = all.map((b) => b.label).join(FLOW_SUMMARY_SEP);

  if (all.length === 0) {
    return { visible: [], hidden: 0, showMarker: false, text: "", fullText, truncated: false };
  }

  let count = Math.min(pool.length, maxLabels);
  let hidden = pool.length - count;
  let visible = pool.slice(hidden);
  let showMarker = hidden > 0;
  let text = summaryText(visible, hidden, showMarker);

  while (count > 1 && lineCost(visible, hidden, showMarker) > maxChars) {
    count -= 1;
    hidden += 1;
    visible = pool.slice(hidden);
    showMarker = hidden > 0;
    text = summaryText(visible, hidden, showMarker);
  }

  let compacted = false;

  // Prefer the newest run's full label (with its count and peak) over the
  // `+N earlier` marker: the hidden runs are still in `fullText`/the tooltip.
  if (lineCost(visible, hidden, showMarker) > maxChars && showMarker) {
    const withoutMarker = summaryText(visible, hidden, false);
    if (withoutMarker.length < summaryText(visible, hidden, true).length) {
      showMarker = false;
      text = withoutMarker;
      compacted = true;
    }
  }

  // Still too wide: switch the surviving labels to their compact form rather
  // than letting CSS clip a number. Only when the compact line is shorter.
  if (lineCost(visible, hidden, showMarker) > maxChars) {
    const short = visible.map((b) => ({ ...b, label: compactBucketLabel(b) }));
    if (lineCost(short, hidden, showMarker) < lineCost(visible, hidden, showMarker)) {
      visible = short;
      text = summaryText(short, hidden, showMarker);
      compacted = true;
    }
  }

  return { visible, hidden, showMarker, text, fullText, truncated: hidden > 0 || compacted };
}
