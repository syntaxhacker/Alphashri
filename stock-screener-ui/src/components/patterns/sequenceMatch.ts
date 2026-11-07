import type { PatternHitDTO } from "@/types/chartPatterns";

export interface SequenceOptions {
  /** Max days between one step's end and the next step's start. */
  maxGapDays?: number | null;
  /** The last step must be at most this many bars old (null = any). */
  maxBarsAgo?: number | null;
  /** Allowed statuses for the earlier steps (empty = any). */
  stepStatuses?: string[];
}

function gapDays(a: PatternHitDTO, b: PatternHitDTO): number | null {
  const end = a.end_date ? Date.parse(a.end_date) : NaN;
  const start = b.start_date ? Date.parse(b.start_date) : NaN;
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return (start - end) / 86_400_000;
}

/**
 * Ordered sequence match (mirrors `chart_patterns.sequence.match_sequence`).
 *
 * The latest hit (max `end_date`) must be the last step. Steps must not
 * overlap; `maxGapDays` bounds the gap, `maxBarsAgo` bounds the age of the
 * last step, and `stepStatuses` filters the earlier steps' status.
 */
export function matchSequence(
  hits: PatternHitDTO[],
  steps: string[],
  options: SequenceOptions = {},
): PatternHitDTO[] {
  const { maxGapDays = null, maxBarsAgo = null, stepStatuses = [] } = options;
  const clean = steps.filter(Boolean);
  if (clean.length < 2) return [];

  const ordered = [...hits]
    .filter((h) => h.pattern_id)
    .sort((a, b) => String(a.end_date ?? "").localeCompare(String(b.end_date ?? "")));
  if (ordered.length === 0) return [];

  const latest = ordered[ordered.length - 1];
  if (latest.pattern_id !== clean[clean.length - 1]) return [];
  if (maxBarsAgo != null && (latest.bars_ago ?? Number.POSITIVE_INFINITY) > maxBarsAgo) return [];

  const allowed = new Set(stepStatuses);
  const chain: PatternHitDTO[] = [latest];
  let upper: PatternHitDTO = latest;
  for (let i = clean.length - 2; i >= 0; i -= 1) {
    const step = clean[i];
    let candidates = ordered.filter(
      (h) =>
        h.pattern_id === step &&
        String(h.end_date ?? "") < String(upper.start_date ?? "") &&
        (allowed.size === 0 || allowed.has(String(h.status ?? ""))),
    );
    if (maxGapDays != null) {
      candidates = candidates.filter((h) => {
        const gap = gapDays(h, upper);
        return gap != null && gap <= maxGapDays;
      });
    }
    if (candidates.length === 0) return [];
    const prev = candidates[candidates.length - 1];
    chain.unshift(prev);
    upper = prev;
  }
  return chain;
}
