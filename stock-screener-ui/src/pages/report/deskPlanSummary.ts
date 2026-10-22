/**
 * Desk plan summary — one-line verdict + weighted confidence.
 *
 * Pure, total helper: it takes a structural snapshot of a two-sided desk plan
 * (bias, spot, the active side's DO block and the reasons behind it) and turns
 * it into the single sentence a trader reads first. No network, no clock, no
 * imports from the mutable `deskPlan` module, so the summary is stable while
 * the plan builder is still being edited.
 *
 * Confidence rule (kept deliberately explicit):
 *   - Base weights: trend 40, gamma 25, oi 20, vol 10, structure 5.
 *   - Only tags actually present in `reasons` are weighted, renormalized to 100.
 *   - An *active* reason supports a directional bias when its tag is one of
 *     trend / gamma / oi / structure. `vol` is context (rich/cheap premium),
 *     not direction, so it never adds confidence. This mirrors the current plan
 *     builder, which computes those four reasons against the bull case for the
 *     bear side (and against the bear case for the bull side).
 *   - confidence = min(95, 35 + 12 × supportingCount); neutral = 0.
 *   - A weak active-side R:R (< 1.5) costs 15 points and is flagged inline.
 *
 * Missing blocks are normal on partial payloads: every accessor tolerates
 * absent/non-finite values and this module never throws.
 */

type PlanBias = "bullish" | "bearish" | "neutral";
type PlanTone = "positive" | "negative" | "neutral";

interface PlanDo {
  action?: string;
  trigger?: string;
  stop?: number | null;
  target?: number | null;
  rr?: number | null;
}

interface PlanSide {
  do?: PlanDo;
}

interface PlanReason {
  tag: string;
  text: string;
}

export interface PlanInput {
  bias: PlanBias;
  spot: number;
  bull?: PlanSide;
  bear?: PlanSide;
  /** Both sides combined, or just the active side — both are accepted. */
  reasons?: PlanReason[];
}

interface WeightedReason {
  tag: string;
  weight: number;
}

interface DeskPlanSummary {
  headline: string;
  action: string;
  /** 0-100, integer. */
  confidence: number;
  /** Normalized integer weights, sum 100 (empty when no known tags). */
  weights: WeightedReason[];
  tone: PlanTone;
}

/** Render/weight order — matches the desk plan's reason order. */
const PLAN_REASON_ORDER = ["trend", "gamma", "oi", "vol", "structure"] as const;

/** Base weights before normalization (only for tags present in the reasons). */
const BASE_REASON_WEIGHTS: Readonly<Record<string, number>> = {
  trend: 40,
  gamma: 25,
  oi: 20,
  vol: 10,
  structure: 5,
};

/** Tags that argue for the active direction; `vol` is context only. */
const SUPPORTING_REASON_TAGS: readonly string[] = [
  "trend",
  "gamma",
  "oi",
  "structure",
];

const BASE_CONFIDENCE = 35;
const CONFIDENCE_PER_REASON = 12;
const MAX_CONFIDENCE = 95;
/** An active-side reward:risk below this is not worth the headline. */
const WEAK_RR = 1.5;
const WEAK_RR_PENALTY = 15;
export const MAX_HEADLINE_LENGTH = 120;

const NEUTRAL_HEADLINE = "NEUTRAL · no trade — wait for a trigger";
const NO_TRADE = "No trade — wait";

function finite(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Indian-grouped level: whole points unless the level actually has decimals. */
function fmtPlanLevel(value: unknown): string | null {
  const n = finite(value);
  if (n === null) return null;
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function normalizeBias(value: unknown): PlanBias {
  return value === "bullish" || value === "bearish" || value === "neutral"
    ? value
    : "neutral";
}

/** First index-level number in a trigger sentence ("1-min close below 22,690"). */
export function triggerLevel(trigger: string | undefined): number | null {
  if (typeof trigger !== "string") return null;
  const match = trigger.match(/\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d{4,}(?:\.\d+)?/);
  if (!match) return null;
  return finite(match[0].replace(/,/g, ""));
}

/**
 * Unique, known tags in canonical order. Duplicate reasons and unknown tags are
 * dropped so a chatty payload cannot inflate confidence or skew the weights.
 */
function collectTags(reasons: PlanReason[] | undefined): string[] {
  const seen = new Set<string>();
  for (const reason of Array.isArray(reasons) ? reasons : []) {
    const tag = typeof reason?.tag === "string" ? reason.tag.trim().toLowerCase() : "";
    if (tag in BASE_REASON_WEIGHTS) seen.add(tag);
  }
  return PLAN_REASON_ORDER.filter((tag) => seen.has(tag));
}

/**
 * Integer weights that always sum to exactly 100: floor each share, then hand
 * the leftovers to the largest fractional remainders (stable by order).
 */
export function normalizePlanWeights(tags: string[]): WeightedReason[] {
  const known = tags.filter((tag) => tag in BASE_REASON_WEIGHTS);
  const total = known.reduce((sum, tag) => sum + BASE_REASON_WEIGHTS[tag], 0);
  if (known.length === 0 || total <= 0) return [];

  const exact = known.map((tag) => (BASE_REASON_WEIGHTS[tag] / total) * 100);
  const weights = exact.map((value) => Math.floor(value));
  let remainder = 100 - weights.reduce((sum, value) => sum + value, 0);
  const byRemainder = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  for (let i = 0; remainder > 0; i = (i + 1) % byRemainder.length) {
    weights[byRemainder[i].index] += 1;
    remainder -= 1;
  }

  return known.map((tag, index) => ({ tag, weight: weights[index] }));
}

interface HeadlineParts {
  prefix: string;
  spot: string | null;
  verb: string;
  trigger: string | null;
  stop: string | null;
  target: string | null;
  weak: boolean;
}

function composeHeadline(parts: HeadlineParts, verb: string, includeStop: boolean, includeTarget: boolean): string {
  const segments = [parts.prefix];
  if (parts.spot !== null) segments.push(`spot ${parts.spot}`);
  segments.push(parts.trigger === null ? verb : `${verb} at ${parts.trigger}`);
  if (includeStop && parts.stop !== null) segments.push(`cut ${parts.stop}`);
  if (includeTarget && parts.target !== null) segments.push(`target ${parts.target}`);
  const line = segments.join(" · ");
  return parts.weak ? `${line} · weak R:R` : line;
}

/**
 * Build the headline, preferring the full read and shedding optional segments
 * (target, then stop, then "rallies"/"dips") only to honour the 120-char cap.
 */
function buildHeadline(parts: HeadlineParts): string {
  const candidates = [
    composeHeadline(parts, parts.verb, true, true),
    composeHeadline(parts, parts.verb, true, false),
    composeHeadline(parts, parts.verb, false, false),
    composeHeadline(parts, parts.prefix === "BEARISH" ? "sell" : "buy", false, false),
  ];
  const fit = candidates.find((line) => line.length <= MAX_HEADLINE_LENGTH);
  if (fit !== undefined) return fit;
  const shortest = candidates[candidates.length - 1];
  return `${shortest.slice(0, MAX_HEADLINE_LENGTH - 1)}…`;
}

/** One-line verdict, active-side action, weighted confidence, and tone. */
export function summarizeDeskPlan(input: PlanInput): DeskPlanSummary {
  const bias = normalizeBias(input?.bias);
  const reasons = Array.isArray(input?.reasons) ? input.reasons : [];
  const tags = collectTags(reasons);
  const weights = normalizePlanWeights(tags);

  if (bias === "neutral") {
    return {
      headline: NEUTRAL_HEADLINE,
      action: "Wait",
      confidence: 0,
      weights,
      tone: "neutral",
    };
  }

  const isBear = bias === "bearish";
  const side = isBear ? input?.bear : input?.bull;
  const doBlock = side?.do;

  const action =
    typeof doBlock?.action === "string" && doBlock.action.trim() !== ""
      ? doBlock.action.trim()
      : NO_TRADE;

  const supporting = new Set<string>(
    tags.filter((tag) => SUPPORTING_REASON_TAGS.includes(tag)),
  );
  const rr = finite(doBlock?.rr);
  const weakRR = rr !== null && rr < WEAK_RR;

  let confidence = Math.min(
    MAX_CONFIDENCE,
    BASE_CONFIDENCE + CONFIDENCE_PER_REASON * supporting.size,
  );
  if (weakRR) confidence = Math.max(0, confidence - WEAK_RR_PENALTY);

  const spot = fmtPlanLevel(input?.spot);
  const trigger = triggerLevel(doBlock?.trigger);

  const headline = buildHeadline({
    prefix: bias.toUpperCase(),
    spot,
    verb: isBear ? "sell rallies" : "buy dips",
    trigger: trigger === null ? null : fmtPlanLevel(trigger),
    stop: fmtPlanLevel(doBlock?.stop),
    target: fmtPlanLevel(doBlock?.target),
    weak: weakRR,
  });

  return {
    headline,
    action,
    confidence,
    weights,
    tone: isBear ? "negative" : "positive",
  };
}
