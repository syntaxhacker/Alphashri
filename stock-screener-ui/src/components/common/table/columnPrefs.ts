import { createMemo } from "solid-js";
import type { ColumnPickerItem } from "../ColumnPicker";
import { getColumnWidth } from "./columns";
import type {
  ColumnPrefs,
  ResolvedColumnPrefs,
  TableColumnDef,
  TableProps,
} from "./types";

/**
 * Merge saved prefs onto the live column declarations.
 *
 * `order` is advisory: unknown ids are dropped, known ids keep their saved
 * position and columns added since the config was saved are appended in their
 * declared order — so a new column can never be hidden by an older config.
 * `hidden` is intersected with known ids and with the lockable set.
 *
 * The last step is the reachability guard: if a config hides every column, the
 * locked column (or else the first in display order) is forced visible rather
 * than rendering a table with no columns.
 */
export function resolveColumnPrefs(
  columnIds: string[],
  prefs: ColumnPrefs | undefined,
  lockVisible: string[] = [],
): ResolvedColumnPrefs {
  const known = new Set(columnIds);
  const order: string[] = [];
  const placed = new Set<string>();
  for (const id of prefs?.order ?? []) {
    if (!known.has(id) || placed.has(id)) continue;
    placed.add(id);
    order.push(id);
  }
  for (const id of columnIds) {
    if (placed.has(id)) continue;
    placed.add(id);
    order.push(id);
  }

  const locked = new Set(lockVisible.filter((id) => known.has(id)));
  const hiddenSet = new Set<string>();
  for (const id of prefs?.hidden ?? []) {
    if (!known.has(id) || locked.has(id)) continue;
    hiddenSet.add(id);
  }

  let visible = order.filter((id) => !hiddenSet.has(id));
  if (visible.length === 0 && order.length > 0) {
    // A table with no columns is not a table. Prefer the identity column; fall
    // back to the first column in display order when no lock was declared.
    const keeper = order.find((id) => locked.has(id)) ?? order[0];
    hiddenSet.delete(keeper);
    visible = order.filter((id) => !hiddenSet.has(id));
  }

  return { order, hidden: order.filter((id) => hiddenSet.has(id)), visible };
}

/** The picker needs text; a JSX/function header has none. */
function columnLabel<T>(column: TableColumnDef<T>): string {
  const header = column.header;
  return typeof header === "string" && header.trim() !== "" ? header : column.id;
}

export function useColumnPrefs<T>(props: TableProps<T>) {
  /** Declared columns that are not visibility-spacers (`size: 0`). */
  const declaredColumns = createMemo(() => props.columns.filter((col) => getColumnWidth(col) !== 0));
  const declaredIds = createMemo(() => declaredColumns().map((col) => col.id));

  // One pass per prefs/columns change — never per row. Cell rendering reads
  // `visibleColumns()` inside `<For>`, which only re-runs when this memo's
  // identity changes.
  const columnPrefsResolved = createMemo(() =>
    resolveColumnPrefs(
      declaredIds(),
      // Inert unless the table opted in: a caller that passes prefs but leaves
      // `enableColumnControls` off keeps the historical declared layout.
      props.enableColumnControls ? props.columnPrefs : undefined,
      props.enableColumnControls ? props.lockVisible : undefined,
    ),
  );

  const columnsById = createMemo(() => new Map(declaredColumns().map((col) => [col.id, col])));

  const visibleColumns = createMemo(() => {
    const byId = columnsById();
    const out: TableColumnDef<T>[] = [];
    for (const id of columnPrefsResolved().visible) {
      const col = byId.get(id);
      if (col) out.push(col);
    }
    return out;
  });

  const emitPrefs = (next: ColumnPrefs) => props.onColumnPrefsChange?.(next);

  /**
   * Emits `order: []` when the layout still matches the declared order. Storing
   * an explicit copy of today's order would freeze it: a later redesign that
   * reorders the default columns would be silently overridden by a config the
   * user never consciously set. `[]` means "no opinion", which is the truth.
   */
  const prefsForEmit = (order: string[], hiddenIds: string[]): ColumnPrefs => {
    const declared = declaredIds();
    const sameOrder = order.length === declared.length && order.every((id, i) => id === declared[i]);
    return { order: sameOrder ? [] : order, hidden: hiddenIds };
  };

  const toggleColumnPref = (id: string, visible: boolean) => {
    const current = columnPrefsResolved();
    const hidden = new Set(current.hidden);
    if (visible) hidden.delete(id);
    else hidden.add(id);
    emitPrefs(
      prefsForEmit(
        current.order,
        current.order.filter((cid) => hidden.has(cid)),
      ),
    );
  };

  const moveColumnPref = (from: number, to: number) => {
    const order = [...columnPrefsResolved().order];
    if (from === to || from < 0 || to < 0 || from >= order.length || to >= order.length) return;
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
    emitPrefs(prefsForEmit(order, [...columnPrefsResolved().hidden]));
  };

  const resetColumnPrefs = () => emitPrefs({ order: [], hidden: [] });

  const columnPickerItems = createMemo<ColumnPickerItem[]>(() => {
    const resolved = columnPrefsResolved();
    const byId = columnsById();
    const hidden = new Set(resolved.hidden);
    const locked = new Set(props.lockVisible ?? []);
    return resolved.order.map((id) => {
      const col = byId.get(id);
      return {
        id,
        label: col ? columnLabel(col) : id,
        visible: !hidden.has(id),
        locked: locked.has(id),
      };
    });
  });

  return { columnPrefsResolved, visibleColumns, columnPickerItems, toggleColumnPref, moveColumnPref, resetColumnPrefs };
}
