import { matchSequence } from "@/components/patterns/sequenceMatch";
import { selectLastN } from "@/components/patterns/selectLastN";
import type { PatternMatrixRow } from "@/components/patterns/symbolMatrix";
import type {
  PatternFilters,
  PatternHitDTO,
  PatternMatrixResponse,
  PatternSummary,
} from "@/types/chartPatterns";

/**
 * Only the filter fields that can change which hits survive sequencing.
 * A memo over these fields (with `sameSequenceFilterArgs` as its equality)
 * stays referentially stable while unrelated filters such as `q` or `sort`
 * change, so the expensive derivations downstream do not rescan results.
 */
export interface SequenceFilterArgs {
  enabled: boolean;
  patternIds: string[];
  maxGapDays: number | null;
  maxBarsAgo: number | null;
  stepStatuses: string[];
}

export function sequenceFilterArgs(filters: PatternFilters): SequenceFilterArgs {
  return {
    enabled: !!filters.sequence && (filters.pattern_id?.length ?? 0) >= 2,
    patternIds: filters.pattern_id ?? [],
    maxGapDays: filters.sequence_gap_days ?? 20,
    maxBarsAgo: filters.sequence_max_bars ?? null,
    stepStatuses: filters.sequence_step_status ?? [],
  };
}

function sameOrdered(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function sameSequenceFilterArgs(a: SequenceFilterArgs, b: SequenceFilterArgs): boolean {
  if (
    a.enabled !== b.enabled ||
    a.maxGapDays !== b.maxGapDays ||
    a.maxBarsAgo !== b.maxBarsAgo
  ) {
    return false;
  }
  // Sequence steps are positional; statuses are consumed through a Set.
  const statusesA = new Set(a.stepStatuses);
  const statusesB = new Set(b.stepStatuses);
  return sameOrdered(a.patternIds, b.patternIds) &&
    statusesA.size === statusesB.size &&
    [...statusesA].every((status) => statusesB.has(status));
}

export function sequenceHits(hits: PatternHitDTO[], args: SequenceFilterArgs): PatternHitDTO[] {
  if (!args.enabled) return hits;
  const bySymbol = new Map<string, PatternHitDTO[]>();
  for (const hit of hits) {
    const key = `${hit.symbol}|${hit.timeframe}`;
    const group = bySymbol.get(key);
    if (group) group.push(hit);
    else bySymbol.set(key, [hit]);
  }
  const keep = new Set<number>();
  for (const group of bySymbol.values()) {
    for (const hit of matchSequence(group, args.patternIds, {
      maxGapDays: args.maxGapDays,
      maxBarsAgo: args.maxBarsAgo,
      stepStatuses: args.stepStatuses,
    })) {
      if (hit.id != null) keep.add(hit.id);
    }
  }
  return hits.filter((hit) => hit.id != null && keep.has(hit.id));
}

/** Quote merge and per-symbol hit grouping share one pass over the hits. */
export function buildMatrixRows(
  rows: PatternMatrixRow[],
  hits: PatternHitDTO[],
  history: number,
): PatternMatrixRow[] {
  const bySymbol = new Map<string, PatternHitDTO[]>();
  const quotes = new Map<string, { ltp: number | null; change: number | null; explicit: boolean }>();
  for (const hit of hits) {
    const group = bySymbol.get(hit.symbol);
    if (group) group.push(hit);
    else bySymbol.set(hit.symbol, [hit]);

    const prev = quotes.get(hit.symbol);
    const ltp = hit.last_close ?? hit.end_price ?? null;
    const explicit = hit.day_change_pct != null;
    const fallback = hit.start_price
      ? ((hit.end_price - hit.start_price) / hit.start_price) * 100
      : null;
    const change = hit.day_change_pct ?? fallback;
    quotes.set(hit.symbol, {
      ltp: prev?.ltp ?? ltp,
      change:
        hit.day_change_pct ??
        (prev?.explicit ? prev.change : (change ?? prev?.change ?? null)),
      explicit: explicit || (prev?.explicit ?? false),
    });
  }
  return rows
    .filter((row) => bySymbol.has(row.symbol))
    .map((row) => {
      const quote = quotes.get(row.symbol);
      const best = row.best;
      const move =
        best?.start_price && Number.isFinite(best.start_price) && Number.isFinite(best.end_price)
          ? ((best.end_price - best.start_price) / best.start_price) * 100
          : null;
      const hitsForSymbol = bySymbol.get(row.symbol) ?? [];
      return {
        ...row,
        ltp: quote?.ltp ?? row.ltp ?? best?.end_price ?? null,
        day_change_pct: quote?.change ?? row.day_change_pct ?? move,
        hits: selectLastN(hitsForSymbol, history),
        hit_count: hitsForSymbol.length,
      };
    });
}

export function summarizeDisplay(
  base: PatternSummary | null,
  latest: PatternHitDTO[],
  resultCount: number,
  total: number,
): PatternSummary | null {
  if (!base || resultCount < total) return base;
  const patternCounts: Record<string, number> = {};
  const familyCounts: Record<string, number> = {};
  let confirmed = 0;
  let bullish = 0;
  let bearish = 0;
  for (const hit of latest) {
    if (hit.status === "confirmed") confirmed += 1;
    if (hit.direction === "bullish") bullish += 1;
    if (hit.direction === "bearish") bearish += 1;
    patternCounts[hit.pattern_id] = (patternCounts[hit.pattern_id] ?? 0) + 1;
    familyCounts[hit.family] = (familyCounts[hit.family] ?? 0) + 1;
  }
  return {
    ...base,
    patterns: latest.length,
    in_view: latest.length,
    confirmed,
    bullish,
    bearish,
    pattern_counts: patternCounts,
    family_counts: familyCounts,
  };
}

export function usedMatrixTimeframes(data: PatternMatrixResponse | null): string[] {
  const used = new Set<string>();
  for (const row of data?.rows ?? []) {
    for (const tf of Object.keys(row.timeframes)) used.add(tf);
  }
  return (data?.timeframes ?? []).filter((tf) => used.has(tf));
}

/** Index of the next docked hit; `-1` when there is nothing to step through. */
export function stepIndex(length: number, current: number, delta: number): number {
  if (length <= 0) return -1;
  if (current < 0) return delta > 0 ? 0 : length - 1;
  return (((current + delta) % length) + length) % length;
}

export function sameFilters(a: PatternFilters, b: PatternFilters): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof PatternFilters>;
  for (const key of keys) {
    const av = a[key];
    const bv = b[key];
    if (Array.isArray(av) || Array.isArray(bv)) {
      const as = [...((av ?? []) as unknown[])].map(String).sort().join("|");
      const bs = [...((bv ?? []) as unknown[])].map(String).sort().join("|");
      if (as !== bs) return false;
    } else if ((av ?? null) !== (bv ?? null)) {
      return false;
    }
  }
  return true;
}
