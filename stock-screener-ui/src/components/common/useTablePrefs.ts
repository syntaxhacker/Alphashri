/**
 * One store per `tableId` is shared by all mounts of that table (ref-counted),
 * so two tabs of the same screen hydrate once and cannot drift into separate
 * debounce writers. Different `tableId`s get different scopes and payloads.
 */

import { onCleanup, onMount, type Accessor } from "solid-js";
import {
  createSavedConfigStore,
  registerSavedConfigScope,
  type SavedConfigErrorCode,
  type SavedConfigScope,
  type SavedConfigStatus,
  type SavedConfigStore,
  type SavedConfigTransport,
} from "../../state/savedConfig";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import { isNonEmptyString, isRecord, parseStringList } from "../../utils/persistedConfig";

export const TABLE_PREFS_VERSION = 1;

export interface TableSort {
  id: string;
  desc: boolean;
}

export interface TablePrefs {
  sorting: TableSort[];
  /** Reserved for column order; the table owns the actual ordering. */
  order: string[];
  /** Reserved for column visibility. */
  hidden: string[];
}

export interface TablePrefsStoreDeps {
  transport?: SavedConfigTransport;
}

export interface UseTablePrefsOptions {
  deps?: TablePrefsStoreDeps;
}

export interface UseTablePrefsResult {
  prefs: Accessor<TablePrefs>;
  status: Accessor<SavedConfigStatus>;
  error: Accessor<SavedConfigErrorCode>;
  hydrated: Accessor<boolean>;
  setSorting(next: TableSort[]): void;
  setColumnPrefs(next: { order: string[]; hidden: string[] }): void;
  retry(): void;
}

export function defaultTablePrefs(): TablePrefs {
  return { sorting: [], order: [], hidden: [] };
}

function parseSorting(raw: unknown): TableSort[] {
  if (!Array.isArray(raw)) return [];
  // Map keeps the first position but the last value for a repeated id, so a
  // stale sort entry cannot resurrect itself from an earlier duplicate.
  const byId = new Map<string, TableSort>();
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const { id, desc } = item;
    if (!isNonEmptyString(id)) continue;
    if (typeof desc !== "boolean") continue;
    byId.set(id, { id, desc });
  }
  return [...byId.values()];
}

/** `null` only for a non-object payload; bad fields degrade to empty arrays. */
export function parseTablePrefs(raw: unknown): TablePrefs | null {
  if (!isRecord(raw)) return null;
  return {
    sorting: parseSorting(raw.sorting),
    order: parseStringList(raw.order),
    hidden: parseStringList(raw.hidden),
  };
}

export function serializeTablePrefs(value: TablePrefs): Record<string, unknown> {
  return {
    sorting: value.sorting.map((s) => ({ id: s.id, desc: s.desc })),
    order: [...value.order],
    hidden: [...value.hidden],
  };
}

export function createTablePrefsScope(tableId: string): SavedConfigScope<TablePrefs> {
  return {
    scope: `table.${tableId}`,
    version: TABLE_PREFS_VERSION,
    defaults: defaultTablePrefs,
    parse: parseTablePrefs,
    serialize: serializeTablePrefs,
  };
}

const registeredScopes = new Map<string, SavedConfigScope<TablePrefs>>();

/** Idempotent by tableId: two mounts always share one scope object. */
export function registerTablePrefsScope(tableId: string): SavedConfigScope<TablePrefs> {
  const existing = registeredScopes.get(tableId);
  if (existing) return existing;
  const scope = registerSavedConfigScope(createTablePrefsScope(tableId));
  registeredScopes.set(tableId, scope);
  return scope;
}

interface StoreEntry {
  store: SavedConfigStore<TablePrefs>;
  refs: number;
}

const stores = new Map<string, StoreEntry>();

export function useTablePrefs(
  tableId: string,
  options: UseTablePrefsOptions = {},
): UseTablePrefsResult {
  let entry = stores.get(tableId);
  if (!entry) {
    const scope = registerTablePrefsScope(tableId);
    entry = { store: createSavedConfigStore(scope, options.deps ?? {}), refs: 0 };
    stores.set(tableId, entry);
  }
  const { store } = entry;
  entry.refs += 1;

  const version = useStoreSubscription(store.subscribe);
  const read = () => {
    version();
    return store.getState();
  };

  onMount(() => {
    store.hydrate();
  });

  onCleanup(() => {
    const current = stores.get(tableId);
    if (!current || current.store !== store) return;
    current.refs -= 1;
    if (current.refs <= 0) {
      store.dispose();
      stores.delete(tableId);
    }
  });

  const prefs = (): TablePrefs => read().value ?? defaultTablePrefs();

  return {
    prefs,
    status: () => read().status,
    error: () => read().error,
    hydrated: () => read().hydrated,
    setSorting: (next) => {
      // Clone before handing off: callers reuse their TanStack array object, and
      // a later sort click must not mutate a payload already queued for PUT.
      const sorting = next.map((s) => ({ id: s.id, desc: s.desc }));
      store.scheduleSave({ ...prefs(), sorting });
    },
    setColumnPrefs: (next) => {
      store.scheduleSave({ ...prefs(), order: [...next.order], hidden: [...next.hidden] });
    },
    retry: () => {
      void store.retry();
    },
  };
}
