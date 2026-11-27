import type { ReplayTrade } from "../tick";

export interface StableArray<T> {
  input: T[] | null;
  key: number;
  value: T[];
}

export const newStableArray = <T,>(): StableArray<T> => ({ input: null, key: -1, value: [] });

/**
 * Reuse the previous array while the source and the number of selected rows are
 * unchanged. The playback clock advances at 4fps; a plain `.filter()` inside a
 * memo allocates a fresh array on every tick, which makes the table re-sort and
 * recreate all of its rows even when no trade crossed its signal.
 */
export function stableArray<T>(input: T[], key: number, build: () => T[], cache: StableArray<T>): T[] {
  if (cache.input === input && cache.key === key) return cache.value;
  cache.input = input;
  cache.key = key;
  cache.value = build();
  return cache.value;
}

export function revealedCount(trades: ReplayTrade[], now: number): number {
  let n = 0;
  for (const t of trades) if (t.time <= now) n++;
  return n;
}

export function closedCount(trades: ReplayTrade[], now: number): number {
  let n = 0;
  for (const t of trades) if (t.exit_time <= now) n++;
  return n;
}
