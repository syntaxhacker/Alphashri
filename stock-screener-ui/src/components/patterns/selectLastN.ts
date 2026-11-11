import type { PatternHitDTO } from "@/types/chartPatterns";

/** True when the two hits' date spans intersect (inclusive). */
export function hitsOverlap(a: PatternHitDTO, b: PatternHitDTO): boolean {
  const { start_date: as, end_date: ae } = a;
  const { start_date: bs, end_date: be } = b;
  if (!as || !ae || !bs || !be) return false;
  return as <= be && bs <= ae;
}

/** True when both hits describe the same kind of pattern. */
function samePatternKind(a: PatternHitDTO, b: PatternHitDTO): boolean {
  return a.pattern_id === b.pattern_id;
}

/**
 * Last N hits, newest first, for one symbol/timeframe.
 *
 * Overlap rule (`nonOverlapping = true`, the default): a hit is skipped only
 * when it overlaps an already-kept hit of the **same pattern type**. The
 * detector re-detects the same base on consecutive days (two consolidations
 * spanning Aug→Nov), so those are one idea and collapse to the newest.
 * Different pattern types carry different information — a triangle that
 * resolved into a consolidation, or a channel that still contains the base —
 * and are kept even when their date spans intersect.
 *
 * `nonOverlapping = false` keeps every hit, overlapping or not.
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
    if (nonOverlapping && out.some((kept) => samePatternKind(hit, kept) && hitsOverlap(hit, kept))) {
      continue;
    }
    out.push(hit);
    if (out.length >= n) break;
  }
  return out;
}
