import { clockMinutes } from "./tapeRange";

export interface SortedTape<T extends { t?: string }> {
  bucketMin: number;
  ordered: T[];
}

export function sortTapeRows<T extends { t?: string }>(
  rows: T[],
  defaultBucketMin: number,
  opts?: { bucketMin?: number },
): SortedTape<T> {
  const bucketMin = opts?.bucketMin && opts.bucketMin > 0 ? opts.bucketMin : defaultBucketMin;
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return { bucketMin, ordered: [] };

  const indexed = list.map((row, i) => ({ row, i }));
  indexed.sort((a, b) => {
    const ta = clockMinutes(a.row?.t);
    const tb = clockMinutes(b.row?.t);
    if (ta === null && tb === null) return a.i - b.i;
    if (ta === null) return 1;
    if (tb === null) return -1;
    return ta === tb ? a.i - b.i : ta - tb;
  });
  return { bucketMin, ordered: indexed.map((x) => x.row) };
}
