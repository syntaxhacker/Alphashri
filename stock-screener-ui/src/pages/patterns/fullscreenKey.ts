/**
 * `fullscreenKey` — framework-free identity helpers for the fullscreen
 * pattern chart.
 *
 * These lived in `src/hooks/usePatternFullscreen.ts` (the last React hook of
 * the pattern stack). The hook is gone; the pure helpers survive here so the
 * Solid list/grid views can de-duplicate a clicked card hit against live
 * detected hits without importing a React module.
 */

import type { PatternHitDTO } from "../../types/chartPatterns";

/**
 * Structural identity for de-duplicating a clicked card hit against
 * live-detected hits. Live detection returns the same pattern with
 * ``id: null`` while a stored card hit carries a DB id, so the id-based
 * identity would keep both as separate rows.
 */
export function fullscreenDedupeKey(hit: PatternHitDTO): string {
  return `${hit.symbol}|${hit.timeframe}|${hit.pattern_id}|${hit.start_date}|${hit.end_date}`;
}

/**
 * Test-isolation hook kept for suites that reset fullscreen bookkeeping
 * between cases (its previous home was the React hook module, whose state
 * needed clearing). The key helpers above are pure and hold no module state,
 * so there is nothing to reset here — the call sites stay explicit rather
 * than silently losing their reset step.
 */
export function __resetFullscreen(): void {
  // Intentionally empty: `fullscreenDedupeKey` is a pure function.
}
