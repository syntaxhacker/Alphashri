import { createEffect, createMemo, createSignal, on, type Accessor } from "solid-js";
import { getValue } from "./columns";
import type {
  BodySlot,
  GroupFrame,
  GroupSlot,
  RowFrame,
  RowSlot,
  SortEntry,
  TableColumnDef,
  TableProps,
} from "./types";

export interface RowWindow<T> {
  bodyItems: Accessor<BodySlot<T>[]>;
  visibleItems: Accessor<BodySlot<T>[]>;
  hiddenCount: Accessor<number>;
  loadMore: () => void;
  isGroupExpanded: (value: unknown) => boolean;
  isRowExpanded: (row: T, index: number) => boolean;
  toggleGroup: (value: unknown) => void;
  toggleRow: (row: T, index: number) => void;
  rowKey: (row: T, index: number) => string;
}

/** Stable row/group slots plus the mounted-window bookkeeping. */
export function useRowWindow<T>(
  props: TableProps<T>,
  deps: {
    sortedData: Accessor<T[]>;
    visibleColumns: Accessor<TableColumnDef<T>[]>;
    sorting: Accessor<SortEntry[]>;
  },
): RowWindow<T> {
  const groups = createMemo(() => {
    if (!props.enableGrouping || !props.grouping?.length) return null;
    const col = props.columns.find((c) => c.id === props.grouping![0]);
    const result: GroupFrame<T>[] = [];
    let cur: GroupFrame<T> | null = null;
    let base = 0;
    for (const row of deps.sortedData()) {
      const v = col ? getValue(row, col) : (row as any)[props.grouping![0]];
      if (cur === null || String(cur.value) !== String(v)) {
        cur = { value: v, rows: [], baseIndex: base };
        result.push(cur);
      }
      cur.rows.push(row);
      base++;
    }
    return result;
  });

  const rowKey = (row: T, index: number) => {
    const testId = props.getRowTestId?.(row, index);
    return testId != null ? testId : String(index);
  };

  // expanded map keys are `columnId:value` (same shape as TanStack's grouping state)
  const groupKey = (value: unknown) =>
    `${props.grouping?.[0] ?? ""}:${String(value)}`;

  // TanStack rebuilds every row object on each data change, and `<For>` keys by
  // reference — so one filter click disposed and re-created all mounted rows
  // (~450 ms at 80 rows x 14 columns, dominated by mergeProps/splitProps/
  // cleanNode). A slot is the stable identity `<For>` keys on: it owns the
  // current frame and its cells read it reactively, so an unchanged key keeps
  // its `<tr>` and only cells that read a changed field update.
  const rowSlots = new Map<string, RowSlot<T>>();
  const groupSlots = new Map<string, GroupSlot<T>>();

  const sameRowFrame = (a: RowFrame<T>, b: RowFrame<T>) => a.row === b.row && a.index === b.index;
  const sameGroupFrame = (a: GroupFrame<T>, b: GroupFrame<T>) =>
    a.value === b.value && a.rows === b.rows && a.baseIndex === b.baseIndex;

  const ensureRowSlot = (row: T, index: number, seen: Set<string>): RowSlot<T> => {
    const base = rowKey(row, index);
    // A consumer that returns one test id for many rows must not collapse them
    // into a single slot (the OI table did: "nifty-strike-row" for every strike).
    const key = seen.has(base) ? `${base}#${index}` : base;
    seen.add(key);
    const existing = rowSlots.get(key);
    if (existing) {
      existing.set({ row, index });
      return existing;
    }
    const [frame, set] = createSignal<RowFrame<T>>({ row, index }, { equals: sameRowFrame });
    const slot: RowSlot<T> = { kind: "row", key, frame, set };
    rowSlots.set(key, slot);
    return slot;
  };

  const ensureGroupSlot = (value: unknown, rows: T[], baseIndex: number): GroupSlot<T> => {
    const key = groupKey(value);
    const existing = groupSlots.get(key);
    if (existing) {
      existing.set({ value, rows, baseIndex });
      return existing;
    }
    const [frame, set] = createSignal<GroupFrame<T>>({ value, rows, baseIndex }, { equals: sameGroupFrame });
    const slot: GroupSlot<T> = { kind: "group", key, frame, set };
    groupSlots.set(key, slot);
    return slot;
  };

  // Keeps the registry bounded by the live row set. Deleting a slot only costs a
  // re-mount for a row that is about to unmount anyway.
  const pruneSlots = (items: BodySlot<T>[]) => {
    if (rowSlots.size > items.length * 2 + 64) {
      const live = new Set(items.map((item) => `${item.kind}:${item.key}`));
      for (const key of rowSlots.keys()) if (!live.has(`row:${key}`)) rowSlots.delete(key);
      for (const key of groupSlots.keys()) if (!live.has(`group:${key}`)) groupSlots.delete(key);
    }
  };

  const [expandedGroups, setExpandedGroups] = createSignal<Record<string, boolean>>({});
  const [expandedRows, setExpandedRows] = createSignal<Record<string, boolean>>({});

  const isGroupExpanded = (value: unknown) => {
    const map = expandedGroups();
    const k = groupKey(value);
    if (k in map) return map[k];
    return props.initialState?.expanded?.[k] ?? false;
  };

  const isRowExpanded = (row: T, index: number) => {
    const map = expandedRows();
    const k = rowKey(row, index);
    if (k in map) return map[k];
    return props.initialState?.expanded?.[k] ?? false;
  };

  const toggleGroup = (value: unknown) => {
    const k = groupKey(value);
    setExpandedGroups((prev) => ({ ...prev, [k]: !isGroupExpanded(value) }));
  };

  const toggleRow = (row: T, index: number) => {
    const k = rowKey(row, index);
    setExpandedRows((prev) => ({ ...prev, [k]: !isRowExpanded(row, index) }));
  };

  const bodyItems = createMemo(() => {
    const items: BodySlot<T>[] = [];
    const seen = new Set<string>();
    const grps = groups();
    if (grps) {
      for (const g of grps) {
        items.push(ensureGroupSlot(g.value, g.rows, g.baseIndex));
        if (isGroupExpanded(g.value)) {
          for (let i = 0; i < g.rows.length; i++) {
            items.push(ensureRowSlot(g.rows[i], g.baseIndex + i, seen));
          }
        }
      }
    } else {
      const rows = deps.sortedData();
      for (let i = 0; i < rows.length; i++) items.push(ensureRowSlot(rows[i], i, seen));
    }
    pruneSlots(items);
    return items;
  });

  const windowBase = () => {
    const size = props.rowWindowSize;
    return typeof size === "number" && Number.isFinite(size) && size > 0 ? size : Number.POSITIVE_INFINITY;
  };
  // `rowWindowSize` seeds the window; it is not a hard cap. `Load more` grows
  // this signal by one page until the whole set is mounted.
  const [visibleCount, setVisibleCount] = createSignal(windowBase());

  // Collapse back to one page only when the *row set* is reshaped. A live
  // table hands us a fresh `data` array on every snapshot poll with the same
  // rows; reacting to that identity would yank a "Load more" window back to
  // one page. The memo turns the set-shaping inputs into a stable string so a
  // same-length replacement is deduped (Solid memos compare with `===`) and
  // `on(..., { defer: true })` preserves the lazy initial window.
  const windowResetKey = createMemo(() =>
    JSON.stringify([
      props.data.length,
      deps.sorting().map((s) => [s.id, s.desc]),
      deps.visibleColumns().map((c) => c.id),
      windowBase(),
    ]),
  );
  createEffect(on(windowResetKey, () => setVisibleCount(windowBase()), { defer: true }));

  const visibleItems = createMemo(() => {
    const items = bodyItems();
    return items.slice(0, Math.min(visibleCount(), items.length));
  });

  // One callback per window change, never per row — a single effect that
  // compares the mounted row identities. The snapshot's row objects are stable
  // references, so a re-sort or filter fires exactly once while a cell update
  // on an unchanged window fires nothing. Edges-only comparison would miss a
  // window whose middle rows changed and silently starve a symbol-keyed
  // consumer; the full sequence is ~80 reference compares, not 80 effects.
  let lastVisible: T[] = [];
  createEffect(() => {
    if (!props.onVisibleRowsChange) return;
    const rows: T[] = [];
    for (const item of visibleItems()) {
      if (item.kind === "row") rows.push(item.frame().row);
    }
    const same =
      rows.length === lastVisible.length && rows.every((row, i) => row === lastVisible[i]);
    if (same) return;
    lastVisible = rows;
    props.onVisibleRowsChange(rows);
  });

  const loadMore = () => {
    const total = bodyItems().length;
    const step = Number.isFinite(windowBase()) ? windowBase() : total;
    setVisibleCount((n) => Math.min(n + step, total));
  };

  const hiddenCount = createMemo(() => {
    const total = bodyItems().length;
    const shown = visibleItems().length;
    return total > shown ? total - shown : 0;
  });

  return {
    bodyItems,
    visibleItems,
    hiddenCount,
    loadMore,
    isGroupExpanded,
    isRowExpanded,
    toggleGroup,
    toggleRow,
    rowKey,
  };
}
