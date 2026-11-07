import type { PatternHitDTO } from "@/types/chartPatterns";

/** True when the two hits' date spans intersect (inclusive). */
export function hitsOverlap(a: PatternHitDTO, b: PatternHitDTO): boolean {
  const { start_date: as, end_date: ae } = a;
  const { start_date: bs, end_date: be } = b;
  if (!as || !ae || !bs || !be) return false;
  return as <= be && bs <= ae;
}

/**
 * Last N non-overlapping hits, newest first (mirrors `chart_patterns.history`).
 * Used by the chart's History selector so the drawn patterns are sequential.
 */
export function selectLastN(
  hits: PatternHitDTO[],
  n: number,
  nonOverlapping = true,
): PatternHitDTO[] {
  if (n <= 0) return [];
  const ordered = [...hits].sort((a, b) => {
    const ea = a.end_date ?? "";
    const eb = b.end_date ?? "";
    if (ea !== eb) return ea < eb ? 1 : -1;
    return (b.confidence ?? 0) - (a.confidence ?? 0);
  });
  const out: PatternHitDTO[] = [];
  for (const hit of ordered) {
    if (nonOverlapping && out.some((kept) => hitsOverlap(hit, kept))) continue;
    out.push(hit);
    if (out.length >= n) break;
  }
  return out;
}
