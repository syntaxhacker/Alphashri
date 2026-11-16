// @vitest-environment happy-dom
import { createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  SAVE_DEBOUNCE_MS,
  type SavedConfigTransport,
} from "../../state/savedConfig";
import type { UserConfig } from "../../api/userConfigs";
import {
  createTablePrefsScope,
  defaultTablePrefs,
  parseTablePrefs,
  registerTablePrefsScope,
  serializeTablePrefs,
  useTablePrefs,
  type TablePrefs,
  type UseTablePrefsResult,
} from "./useTablePrefs";
import { SCOPES } from "../../state/savedConfig";

function envelope(
  scope: string,
  config: Record<string, unknown>,
  overrides: Partial<UserConfig<Record<string, unknown>>> = {},
): UserConfig<Record<string, unknown>> {
  return {
    scope,
    version: 1,
    saved: true,
    updated_at: "2026-11-15T09:41:22.192Z",
    config,
    ...overrides,
  };
}

function makeTransport() {
  const get = vi.fn<SavedConfigTransport["get"]>();
  const put = vi.fn<SavedConfigTransport["put"]>();
  const del = vi.fn<SavedConfigTransport["del"]>();
  put.mockImplementation(async (scope, config) =>
    envelope(scope, config as Record<string, unknown>, {
      updated_at: `rev-${put.mock.calls.length}`,
    }),
  );
  del.mockResolvedValue({ scope: "table.test", deleted: true });
  return { transport: { get, put, del }, get, put, del };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const roots: Array<() => void> = [];

function mount(tableId: string, transport: SavedConfigTransport) {
  let api!: UseTablePrefsResult;
  let disposeRoot!: () => void;
  createRoot((d) => {
    disposeRoot = d;
    api = useTablePrefs(tableId, { deps: { transport } });
  });
  const dispose = () => {
    const i = roots.indexOf(dispose);
    if (i >= 0) roots.splice(i, 1);
    disposeRoot();
  };
  roots.push(dispose);
  return { api, dispose };
}

async function settle(): Promise<void> {
  await vi.runAllTimersAsync();
}

async function flushDebounce(): Promise<void> {
  await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
  await vi.runAllTimersAsync();
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  while (roots.length) roots.pop()!();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("parseTablePrefs", () => {
  test("a non-object payload (including an array) returns null", () => {
    expect(parseTablePrefs(null)).toBeNull();
    expect(parseTablePrefs("{}")).toBeNull();
    expect(parseTablePrefs(42)).toBeNull();
    expect(parseTablePrefs([])).toBeNull();
  });

  test("drops malformed sorting entries and keeps only well-formed ones", () => {
    const parsed = parseTablePrefs({
      sorting: [
        { id: "mcap", desc: true },
        null,
        7,
        ["not", "a", "record"],
        { id: "", desc: true },
        { id: "   ", desc: false },
        { id: "relvol", desc: "yes" },
        { desc: true },
        { id: "name" },
        { id: "price", desc: false },
      ],
    });
    expect(parsed?.sorting).toEqual([
      { id: "mcap", desc: true },
      { id: "price", desc: false },
    ]);
  });

  test("duplicate sort ids are deduped with the last entry winning", () => {
    const parsed = parseTablePrefs({
      sorting: [
        { id: "a", desc: true },
        { id: "b", desc: false },
        { id: "a", desc: false },
      ],
    });
    expect(parsed?.sorting).toEqual([
      { id: "a", desc: false },
      { id: "b", desc: false },
    ]);
  });

  test("missing or malformed keys degrade to empty arrays", () => {
    expect(parseTablePrefs({})).toEqual({ sorting: [], order: [], hidden: [] });
    expect(parseTablePrefs({ sorting: "nope", order: {}, hidden: [1, null] })).toEqual({
      sorting: [],
      order: [],
      hidden: [],
    });
  });

  test("unknown extra keys are ignored", () => {
    const parsed = parseTablePrefs({
      sorting: [{ id: "a", desc: true, extra: 1 }],
      order: ["a", "a", "", "b"],
      hidden: ["c"],
      totallyUnknown: 123,
    });
    expect(Object.keys(parsed!).sort()).toEqual(["hidden", "order", "sorting"]);
    expect(parsed!.sorting).toEqual([{ id: "a", desc: true }]);
    expect(parsed!.order).toEqual(["a", "b"]);
    expect(parsed!.hidden).toEqual(["c"]);
  });
});

describe("serializeTablePrefs", () => {
  test("emits exactly the three keys and survives a round-trip", () => {
    const value: TablePrefs = {
      sorting: [
        { id: "mcap", desc: true },
        { id: "name", desc: false },
      ],
      order: ["name", "mcap"],
      hidden: ["volume"],
    };
    const wire = serializeTablePrefs(value);
    expect(Object.keys(wire).sort()).toEqual(["hidden", "order", "sorting"]);
    expect(JSON.parse(JSON.stringify(wire))).toEqual(wire);
    expect(parseTablePrefs(JSON.parse(JSON.stringify(wire)))).toEqual(value);
  });

  test("defaults serialize to three empty arrays", () => {
    expect(serializeTablePrefs(defaultTablePrefs())).toEqual({
      sorting: [],
      order: [],
      hidden: [],
    });
  });
});

describe("registerTablePrefsScope", () => {
  test("returns the same scope object on every call for a tableId", () => {
    const a = registerTablePrefsScope("dup-check");
    const b = registerTablePrefsScope("dup-check");
    expect(a).toBe(b);
    expect(SCOPES["table.dup-check"]).toBe(a);
    expect(a.scope).toBe("table.dup-check");
    expect(a.version).toBe(1);
    expect(a.defaults()).toEqual({ sorting: [], order: [], hidden: [] });
  });

  test("different table ids get different scopes", () => {
    const market = registerTablePrefsScope("scope-market");
    const screener = registerTablePrefsScope("scope-screener.52w_high");
    expect(market).not.toBe(screener);
    expect(market.scope).toBe("table.scope-market");
    expect(screener.scope).toBe("table.scope-screener.52w_high");
    expect(createTablePrefsScope("other").scope).toBe("table.other");
  });
});

describe("useTablePrefs store", () => {
  test("hydrate from a GET applies the saved sort", async () => {
    const made = makeTransport();
    made.get.mockResolvedValue(
      envelope("table.hydrate-sort", {
        sorting: [{ id: "mcap", desc: true }],
        order: [],
        hidden: [],
      }),
    );
    const { api } = mount("hydrate-sort", made.transport);
    await settle();

    expect(api.hydrated()).toBe(true);
    expect(api.prefs()).toEqual({
      sorting: [{ id: "mcap", desc: true }],
      order: [],
      hidden: [],
    });
    expect(made.get).toHaveBeenCalledWith("table.hydrate-sort");
    expect(made.put).not.toHaveBeenCalled();
  });

  test("setSorting PUTs after the debounce with the full prefs payload", async () => {
    const made = makeTransport();
    made.get.mockResolvedValue(
      envelope("table.put-sort", {
        sorting: [{ id: "x", desc: false }],
        order: ["a", "b"],
        hidden: ["c"],
      }),
    );
    const { api } = mount("put-sort", made.transport);
    await settle();

    api.setSorting([{ id: "y", desc: true }]);
    expect(made.put).not.toHaveBeenCalled();
    await flushDebounce();

    expect(made.put).toHaveBeenCalledTimes(1);
    expect(made.put.mock.calls[0][0]).toBe("table.put-sort");
    expect(made.put.mock.calls[0][1]).toEqual({
      sorting: [{ id: "y", desc: true }],
      order: ["a", "b"],
      hidden: ["c"],
    });
    expect(made.put.mock.calls[0][2]).toMatchObject({ version: 1 });
  });

  test("setColumnPrefs merges order/hidden into the saved payload", async () => {
    const made = makeTransport();
    made.get.mockResolvedValue(
      envelope("table.put-cols", { sorting: [{ id: "z", desc: true }], order: [], hidden: [] }),
    );
    const { api } = mount("put-cols", made.transport);
    await settle();

    api.setColumnPrefs({ order: ["z", "a"], hidden: ["b"] });
    await flushDebounce();

    expect(made.put.mock.calls[0][1]).toEqual({
      sorting: [{ id: "z", desc: true }],
      order: ["z", "a"],
      hidden: ["b"],
    });
  });

  test("no PUT before the GET settles; one PUT with the final value after", async () => {
    const made = makeTransport();
    const pendingGet = deferred<UserConfig<Record<string, unknown>>>();
    made.get.mockReturnValue(pendingGet.promise);
    const { api } = mount("latch-sort", made.transport);
    await settle();

    api.setSorting([{ id: "a", desc: true }]);
    api.setSorting([{ id: "a", desc: false }]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 2);
    expect(made.put).not.toHaveBeenCalled();

    pendingGet.resolve(
      envelope("table.latch-sort", { sorting: [], order: [], hidden: [] }, { saved: false }),
    );
    await flushDebounce();

    expect(made.put).toHaveBeenCalledTimes(1);
    expect(made.put.mock.calls[0][1]).toEqual({
      sorting: [{ id: "a", desc: false }],
      order: [],
      hidden: [],
    });
  });

  test("a remount with a pending sort does not let its GET revert the click", async () => {
    const OLD = { sorting: [{ id: "mcap", desc: true }], order: [], hidden: [] };
    const NEW = { sorting: [{ id: "rsi", desc: false }], order: [], hidden: [] };
    const made = makeTransport();
    made.get.mockResolvedValueOnce(envelope("table.remount", OLD));
    const first = mount("remount", made.transport);
    await settle();
    expect(first.api.prefs().sorting).toEqual(OLD.sorting);

    // The user clicks a new sort; the PUT is armed but has not landed.
    first.api.setSorting(NEW.sorting);
    expect(first.api.prefs().sorting).toEqual(NEW.sorting);

    // A second consumer mounts inside the debounce and re-hydrates the same
    // store with the stale saved sort.
    const remountGet = deferred<UserConfig<Record<string, unknown>>>();
    made.get.mockReturnValueOnce(remountGet.promise);
    const second = mount("remount", made.transport);
    await settle();

    remountGet.resolve(envelope("table.remount", OLD));
    await settle();

    // Both consumers keep the user's sort; the stale GET never wins.
    expect(first.api.prefs().sorting).toEqual(NEW.sorting);
    expect(second.api.prefs().sorting).toEqual(NEW.sorting);

    await flushDebounce();
    expect(made.put).toHaveBeenCalledTimes(1);
    expect(made.put.mock.calls[0][1].sorting).toEqual(NEW.sorting);
  });

  test("two table ids get separate scopes and separate payloads", async () => {
    const market = makeTransport();
    const screener = makeTransport();
    market.get.mockResolvedValue(
      envelope("table.iso-market", {
        sorting: [{ id: "mcap", desc: true }],
        order: [],
        hidden: [],
      }),
    );
    screener.get.mockResolvedValue(
      envelope("table.iso-screener.52w_high", {
        sorting: [{ id: "score", desc: false }],
        order: [],
        hidden: [],
      }),
    );

    const a = mount("iso-market", market.transport);
    const b = mount("iso-screener.52w_high", screener.transport);
    await settle();

    expect(a.api.prefs().sorting).toEqual([{ id: "mcap", desc: true }]);
    expect(b.api.prefs().sorting).toEqual([{ id: "score", desc: false }]);

    a.api.setSorting([{ id: "mcap", desc: false }]);
    b.api.setSorting([{ id: "score", desc: true }]);
    await flushDebounce();

    expect(market.put).toHaveBeenCalledTimes(1);
    expect(screener.put).toHaveBeenCalledTimes(1);
    expect(market.put.mock.calls[0][0]).toBe("table.iso-market");
    expect(market.put.mock.calls[0][1]).toMatchObject({
      sorting: [{ id: "mcap", desc: false }],
    });
    expect(screener.put.mock.calls[0][0]).toBe("table.iso-screener.52w_high");
    expect(screener.put.mock.calls[0][1]).toMatchObject({
      sorting: [{ id: "score", desc: true }],
    });
    expect(a.api.prefs()).not.toEqual(b.api.prefs());
  });

  test("mounts of one table share a store; it is released when the last unmounts", async () => {
    const made = makeTransport();
    made.get.mockResolvedValue(
      envelope("table.shared", { sorting: [], order: [], hidden: [] }, { saved: false }),
    );
    const a = mount("shared", made.transport);
    await settle();
    const b = mount("shared", made.transport);
    await settle();

    // Same store: two consumers writing the identical value dedupe to one PUT.
    a.api.setSorting([{ id: "x", desc: true }]);
    b.api.setSorting([{ id: "x", desc: true }]);
    await flushDebounce();
    expect(made.put).toHaveBeenCalledTimes(1);

    // Releasing one consumer leaves the store alive for the other.
    a.dispose();
    b.api.setSorting([{ id: "y", desc: true }]);
    await flushDebounce();
    expect(made.put).toHaveBeenCalledTimes(2);
    b.dispose();

    // Last unmount released it: a fresh mount re-hydrates a new store.
    const c = mount("shared", made.transport);
    await settle();
    c.api.setSorting([{ id: "z", desc: true }]);
    await flushDebounce();
    expect(made.put).toHaveBeenCalledTimes(3);
  });
});
