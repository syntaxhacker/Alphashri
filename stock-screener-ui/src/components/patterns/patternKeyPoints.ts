import type { PatternHitDTO } from "@/types/chartPatterns";

export type KeyPointTone = "bull" | "bear" | "neutral";

export interface PatternKeyPoint {
  t: string;
  price: number;
  label: string;
  tone: KeyPointTone;
  kind: "high" | "low";
}

export interface KeyPointMeaning {
  label: string;
  meaning: string;
}

type Pivot = NonNullable<PatternHitDTO["pivots"]>[number];

function timeOf(p: Pivot): number {
  const t = Date.parse(p.t);
  return Number.isFinite(t) ? t : 0;
}

function byTime(a: Pivot, b: Pivot): number {
  return timeOf(a) - timeOf(b);
}

function highs(list: Pivot[]): Pivot[] {
  return list.filter((p) => p.kind !== "low").sort(byTime);
}

function lows(list: Pivot[]): Pivot[] {
  return list.filter((p) => p.kind === "low").sort(byTime);
}

function extreme(list: Pivot[], high: boolean): Pivot | null {
  if (list.length === 0) return null;
  return list.reduce((best, p) => (high ? p.price > best.price : p.price < best.price) ? p : best);
}

function between(list: Pivot[], a: Pivot, b: Pivot): Pivot[] {
  const start = timeOf(a);
  const end = timeOf(b);
  return list.filter((p) => {
    const t = timeOf(p);
    return t > start && t < end;
  });
}

function pickExtremes(list: Pivot[], count: number, high: boolean): Pivot[] {
  const sorted = [...list].sort((a, b) => (high ? b.price - a.price : a.price - b.price));
  const out: Pivot[] = [];
  for (const pivot of sorted) {
    if (out.length >= count) break;
    if (out.some((p) => p.t === pivot.t)) continue;
    out.push(pivot);
  }
  return out.sort(byTime);
}

function point(pivot: Pivot, label: string, tone: KeyPointTone): PatternKeyPoint {
  return {
    t: pivot.t,
    price: pivot.price,
    label,
    tone,
    kind: pivot.kind === "low" ? "low" : "high",
  };
}

function headShoulders(all: Pivot[], inverse: boolean): PatternKeyPoint[] {
  const primary = inverse ? lows(all) : highs(all);
  const secondary = inverse ? highs(all) : lows(all);
  const head = extreme(primary, !inverse);
  if (!head) return [];
  const left = extreme(primary.filter((p) => timeOf(p) < timeOf(head)), !inverse);
  const right = extreme(primary.filter((p) => timeOf(p) > timeOf(head)), !inverse);
  if (!left || !right) return [];
  const tone: KeyPointTone = inverse ? "bull" : "bear";
  const out = [point(left, "LS", tone), point(head, "H", tone), point(right, "RS", tone)];
  const n1 = extreme(between(secondary, left, head), inverse);
  const n2 = extreme(between(secondary, head, right), inverse);
  if (n1) out.push(point(n1, "N1", "neutral"));
  if (n2) out.push(point(n2, "N2", "neutral"));
  return out.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
}

function topsBottoms(all: Pivot[], count: number, top: boolean): PatternKeyPoint[] {
  const primary = top ? highs(all) : lows(all);
  const secondary = top ? lows(all) : highs(all);
  const points = pickExtremes(primary, count, top);
  if (points.length < 2) return [];
  const tone: KeyPointTone = top ? "bear" : "bull";
  const prefix = top ? "T" : "B";
  const out = points.map((pivot, index) => point(pivot, `${prefix}${index + 1}`, tone));
  points.slice(0, -1).forEach((pivot, index) => {
    const neck = extreme(between(secondary, pivot, points[index + 1]), !top);
    if (neck) out.push(point(neck, `N${index + 1}`, "neutral"));
  });
  return out.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
}

function cupHandle(all: Pivot[]): PatternKeyPoint[] {
  const hs = highs(all);
  const ls = lows(all);
  const cup = extreme(ls, false);
  if (!cup) return [];
  const rim1 = extreme(hs.filter((p) => timeOf(p) < timeOf(cup)), true);
  const rim2 = extreme(hs.filter((p) => timeOf(p) > timeOf(cup)), true);
  const after = timeOf(rim2 ?? cup);
  const handle = extreme(ls.filter((p) => timeOf(p) > after), false);
  const out = [point(cup, "C", "bull")];
  if (rim1) out.push(point(rim1, "R1", "neutral"));
  if (rim2) out.push(point(rim2, "R2", "neutral"));
  if (handle) out.push(point(handle, "H", "bull"));
  return out.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
}

function generic(all: Pivot[], perSide: number): PatternKeyPoint[] {
  const hs = highs(all).slice(-perSide);
  const ls = lows(all).slice(-perSide);
  return [
    ...hs.map((pivot, index) => point(pivot, `H${index + 1}`, "bear")),
    ...ls.map((pivot, index) => point(pivot, `L${index + 1}`, "bull")),
  ].sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
}

export function buildPatternKeyPoints(hit: PatternHitDTO | null | undefined): PatternKeyPoint[] {
  if (!hit?.pivots?.length) return [];
  const pivots = hit.pivots
    .filter((p) => p && p.t && Number.isFinite(p.price) && p.price > 0)
    .sort(byTime);
  if (pivots.length === 0) return [];
  switch (hit.pattern_id) {
    case "head_shoulders":
      return headShoulders(pivots, false);
    case "inverse_head_shoulders":
      return headShoulders(pivots, true);
    case "double_bottom":
      return topsBottoms(pivots, 2, false);
    case "double_top":
      return topsBottoms(pivots, 2, true);
    case "triple_bottom":
      return topsBottoms(pivots, 3, false);
    case "triple_top":
      return topsBottoms(pivots, 3, true);
    case "cup_handle":
      return cupHandle(pivots);
    case "bull_flag":
    case "bear_flag":
    case "pennant":
      return generic(pivots, 2);
    case "consolidation":
    case "rectangle":
      return generic(pivots, 2);
    case "ascending_triangle":
    case "descending_triangle":
    case "symmetrical_triangle":
    case "symmetric_triangle":
    case "rising_wedge":
    case "falling_wedge":
    case "ascending_channel":
    case "descending_channel":
    case "diamond_bottom":
    case "rounding_bottom":
    case "curve_bearish":
      return generic(pivots, 3);
    default:
      return generic(pivots, 3);
  }
}

function meaningOf(patternId: string, label: string): string {
  if (label === "LS") return "Left shoulder";
  if (label === "RS") return "Right shoulder";
  if (label === "H") return patternId === "cup_handle" ? "Handle" : "Head";
  if (label === "C") return "Cup low";
  if (label === "R1" || label === "R2") return "Rim";
  if (/^N\d+$/.test(label)) return "Neckline";
  if (/^B\d+$/.test(label)) return "Bottom";
  if (/^T\d+$/.test(label)) return "Top";
  if (/^H\d+$/.test(label)) return "Swing high";
  if (/^L\d+$/.test(label)) return "Swing low";
  return "Key point";
}

export function keyPointMeanings(
  patternId: string,
  points: PatternKeyPoint[],
): KeyPointMeaning[] {
  const labels = Array.from(new Set(points.map((p) => p.label)));
  return labels.map((label) => ({ label, meaning: meaningOf(patternId, label) }));
}
