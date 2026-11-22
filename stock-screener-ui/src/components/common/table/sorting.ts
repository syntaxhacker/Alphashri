import { createEffect, createMemo, createSignal } from "solid-js";
import { getValue } from "./columns";
import type { SortEntry, TableColumnDef, TableProps } from "./types";

/**
 * Missing values and NaN are not zeros — they trail in both directions. A null
 * sorted as 0 read as "mid-pack" for signed metrics and "best" for negatives.
 */
export function compareSortValues(aVal: unknown, bVal: unknown, desc: boolean): number {
  const aMissing = aVal === null || aVal === undefined || aVal === "";
  const bMissing = bVal === null || bVal === undefined || bVal === "";
  if (aMissing || bMissing) {
    if (aMissing && bMissing) return 0;
    return aMissing ? 1 : -1;
  }
  if (typeof aVal === "string" && typeof bVal === "string") {
    return desc ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal);
  }
  const an = Number(aVal);
  const bn = Number(bVal);
  const aNaN = Number.isNaN(an);
  const bNaN = Number.isNaN(bn);
  if (aNaN || bNaN) {
    if (aNaN && bNaN) return 0;
    return aNaN ? 1 : -1;
  }
  return desc ? bn - an : an - bn;
}

export function useSorting<T>(props: TableProps<T>) {
  const [internalSorting, setInternalSorting] = createSignal<SortEntry[]>(
    props.initialState?.sorting ?? props.initialSorting ?? [],
  );
  const isSortControlled = () => props.sorting != null;
  const sorting = (): SortEntry[] => (isSortControlled() ? props.sorting! : internalSorting());
  const commitSorting = (next: SortEntry[]) => {
    if (!isSortControlled()) setInternalSorting(next);
    props.onSortingChange?.(next);
  };

  const enableSorting = () => props.enableSorting ?? true;
  const enableSortingRemoval = () => props.enableSortingRemoval ?? true;

  const sortedData = createMemo(() => {
    const rows = [...props.data];
    const sorters = sorting();
    if (!enableSorting() || sorters.length === 0) return rows;
    for (let i = sorters.length - 1; i >= 0; i--) {
      const { id, desc } = sorters[i];
      const col = props.columns.find((c) => c.id === id);
      if (!col) continue;
      rows.sort((a, b) => compareSortValues(getValue(a, col), getValue(b, col), desc));
    }
    return rows;
  });

  // TanStack's first-click contract: text columns sort A→Z first, numeric
  // columns biggest-first. Sample the first values; shared by both the "new
  // column" and "flip vs clear" paths so they can never disagree.
  const descFirst = (col: TableColumnDef<T> | undefined): boolean => {
    if (!col) return false;
    let seen = 0;
    let numeric = true;
    for (const row of props.data) {
      if (seen >= 5) break;
      const v = getValue(row, col);
      if (v === null || v === undefined || v === "") continue;
      seen++;
      if (typeof v !== "number") {
        numeric = false;
        break;
      }
    }
    return seen > 0 && numeric;
  };

  const toggleSort = (id: string) => {
    const prev = sorting();
    const found = prev.find((s) => s.id === id);
    const next = prev.filter((s) => s.id !== id);
    const col = props.columns.find((c) => c.id === id);
    // The clicked column becomes PRIMARY. Pushing it to the end left the
    // previous sorter dominant, so clicking a header could never reorder the
    // table — a header click always means "sort by this".
    if (found) {
      // First click descends for numbers / ascends for text. The second flips
      // the direction; only the third clears — flipping on desc was the bug
      // that made ascending unreachable on numeric columns.
      if (found.desc !== descFirst(col) && enableSortingRemoval()) {
        commitSorting(next);
        return;
      }
      next.unshift({ id, desc: !found.desc });
    } else {
      next.unshift({ id, desc: descFirst(col) });
    }
    commitSorting(next);
  };

  createEffect(() => {
    if (props.onSortedRowsChange) props.onSortedRowsChange(sortedData());
  });

  return { sorting, toggleSort, sortedData, enableSorting, enableSortingRemoval };
}
