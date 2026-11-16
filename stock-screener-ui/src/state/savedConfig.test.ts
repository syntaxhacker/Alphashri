// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  createSavedConfigStore,
  NETWORK_RETRY_MS,
  SAVE_DEBOUNCE_MS,
  type SavedConfigScope,
  type SavedConfigTransport,
} from "./savedConfig";
import type { UserConfig } from "../api/userConfigs";

interface TestValue {
  universe: string;
  rsiMin: number | null;
  view: string;
}

const DEFAULTS: TestValue = { universe: "all_equity", rsiMin: null, view: "table" };

const spec: SavedConfigScope<TestValue> = {
  scope: "test.filters",
  version: 1,
  defaults: () => ({ ...DEFAULTS }),
  parse: (raw) => {
    if (typeof raw !== "object" || raw === null) return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.universe !== "string" || typeof r.view !== "string") return null;
    return {
      universe: r.universe,
      rsiMin: typeof r.rsiMin === "number" ? r.rsiMin : null,
      view: r.view,
    };
  },
  serialize: (value) => ({ universe: value.universe, rsiMin: value.rsiMin, view: value.view }),
};

function envelope(
  config: Record<string, unknown> | TestValue,
  overrides: Partial<UserConfig<Record<string, unknown>>> = {},
): UserConfig<Record<string, unknown>> {
  return {
    scope: "test.filters",
    version: 1,
    saved: true,
    updated_at: "2026-11-15T09:41:22.192Z",
    config: config as Record<string, unknown>,
    ...overrides,
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function httpError(status: number, code: string, payload?: unknown) {
  return Object.assign(new Error(code), { status, code, payload });
}

function makeTransport(overrides: Partial<SavedConfigTransport> = {}) {
  const get = vi.fn<SavedConfigTransport["get"]>();
  const put = vi.fn<SavedConfigTransport["put"]>();
  const del = vi.fn<SavedConfigTransport["del"]>();
  put.mockImplementation(async (_scope, config) =>
    envelope(config, { updated_at: `rev-${put.mock.calls.length}` }),
  );
  del.mockResolvedValue({ scope: "test.filters", deleted: true });
  return { transport: { get, put, del, ...overrides }, get, put, del };
}

const stores: { dispose(): void }[] = [];

function build(overrides: Partial<SavedConfigTransport> = {}) {
  const made = makeTransport(overrides);
  const store = createSavedConfigStore(spec, { transport: made.transport });
  stores.push(store);
  return { ...made, store };
}

/** Resolve the pending debounce and let the trailing PUT's promise chain settle. */
async function flushDebounce(): Promise<void> {
  await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
  await vi.runAllTimersAsync();
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  while (stores.length) stores.pop()!.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("hydrate — precedence", () => {
  test("no override: the saved value is applied", async () => {
    const { store, get } = build();
    get.mockResolvedValue(envelope({ universe: "nifty500", rsiMin: 50, view: "map" }));

    const applied: TestValue[] = [];
    store.hydrate({ apply: (v) => applied.push(v) });
    await vi.runAllTimersAsync();

    expect(applied.at(-1)).toEqual({ universe: "nifty500", rsiMin: 50, view: "map" });
    expect(store.getState().value).toEqual({ universe: "nifty500", rsiMin: 50, view: "map" });
    expect(store.getState().hydrated).toBe(true);
  });

  test("URL beats saved per field; the other saved fields still apply", async () => {
    const { store, get } = build();
    get.mockResolvedValue(envelope({ universe: "nifty500", rsiMin: 50, view: "table" }));

    store.hydrate({ override: { view: "map" } });
    await vi.runAllTimersAsync();

    // Saved view `table` loses to `?view=map`; saved universe/rsi still arrive.
    expect(store.getState().value).toEqual({ universe: "nifty500", rsiMin: 50, view: "map" });
  });

  test("nothing saved: defaults, and the default payload is not written back", async () => {
    const { store, get, put } = build();
    get.mockResolvedValue(envelope(DEFAULTS, { saved: false, updated_at: null }));

    store.hydrate();
    await vi.runAllTimersAsync();
    store.scheduleSave({ ...DEFAULTS });
    await flushDebounce();

    expect(store.getState().value).toEqual(DEFAULTS);
    expect(put).not.toHaveBeenCalled();
  });
});

describe("hydration latch", () => {
  test("no write before the GET settles; then exactly one PUT with the final state", async () => {
    const { store, get, put } = build();
    const pendingGet = deferred<UserConfig<Record<string, unknown>>>();
    get.mockReturnValue(pendingGet.promise);

    store.hydrate();
    store.scheduleSave({ universe: "nifty500", rsiMin: 40, view: "table" });
    store.scheduleSave({ universe: "nifty50", rsiMin: 45, view: "table" });
    store.scheduleSave({ universe: "nifty50", rsiMin: 50, view: "table" });
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 2);

    expect(put).not.toHaveBeenCalled();

    pendingGet.resolve(envelope(DEFAULTS, { saved: false, updated_at: null }));
    await vi.runAllTimersAsync();
    await flushDebounce();

    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0][1]).toEqual({
      universe: "nifty50",
      rsiMin: 50,
      view: "table",
    });
    // The saved (default) payload does not resurrect over the buffered change.
    expect(store.getState().value).toEqual({ universe: "nifty50", rsiMin: 50, view: "table" });
  });

  test("a click at t=200ms survives a GET that lands at t=400ms", async () => {
    const { store, get } = build();
    const pendingGet = deferred<UserConfig<Record<string, unknown>>>();
    get.mockReturnValue(pendingGet.promise);

    const applied: TestValue[] = [];
    store.hydrate({ apply: (v) => applied.push(v) });

    await vi.advanceTimersByTimeAsync(200);
    store.scheduleSave({ universe: "all_equity", rsiMin: null, view: "table" });
    await vi.advanceTimersByTimeAsync(200);

    // Saved value says rsi 50; the user cleared it before the response landed.
    pendingGet.resolve(envelope({ universe: "all_equity", rsiMin: 50, view: "table" }));
    await vi.runAllTimersAsync();

    expect(applied).toHaveLength(0);
    expect(store.getState().value).toEqual({ universe: "all_equity", rsiMin: null, view: "table" });
  });
});

describe("autosave", () => {
  test("three rapid changes collapse into one PUT carrying the last value", async () => {
    const { store, get, put } = build();
    get.mockResolvedValue(envelope(DEFAULTS, { saved: false, updated_at: null }));
    store.hydrate();
    await vi.runAllTimersAsync();

    store.scheduleSave({ universe: "nifty500", rsiMin: 40, view: "table" });
    await vi.advanceTimersByTimeAsync(200);
    store.scheduleSave({ universe: "nifty500", rsiMin: 45, view: "table" });
    await vi.advanceTimersByTimeAsync(200);
    store.scheduleSave({ universe: "nifty500", rsiMin: 50, view: "table" });
    await flushDebounce();

    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0][1]).toMatchObject({ rsiMin: 50 });
  });

  test("a change during an in-flight PUT leaves one follow-up save", async () => {
    const { store, get, put } = build();
    get.mockResolvedValue(envelope(DEFAULTS, { saved: false, updated_at: null }));
    store.hydrate();
    await vi.runAllTimersAsync();

    const inFlight = deferred<UserConfig<Record<string, unknown>>>();
    put.mockReturnValueOnce(inFlight.promise);

    store.scheduleSave({ universe: "nifty500", rsiMin: 40, view: "table" });
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(put).toHaveBeenCalledTimes(1);

    store.scheduleSave({ universe: "nifty500", rsiMin: 60, view: "table" });
    inFlight.resolve(envelope({ universe: "nifty500", rsiMin: 40, view: "table" }));
    await vi.runAllTimersAsync();
    await flushDebounce();

    expect(put).toHaveBeenCalledTimes(2);
    expect(put.mock.calls[1][1]).toMatchObject({ rsiMin: 60 });
  });
});

describe("failure handling", () => {
  test("PUT failure keeps the live value, sets `not_saved`, and retry clears it", async () => {
    const { store, get, put } = build();
    get.mockResolvedValue(envelope(DEFAULTS, { saved: false, updated_at: null }));
    store.hydrate();
    await vi.runAllTimersAsync();

    put.mockRejectedValueOnce(httpError(500, "internal"));
    store.scheduleSave({ universe: "nifty500", rsiMin: 50, view: "table" });
    await flushDebounce();

    expect(store.getState().error).toBe("not_saved");
    // No rollback: the user's value is still on screen.
    expect(store.getState().value).toEqual({ universe: "nifty500", rsiMin: 50, view: "table" });

    await store.retry();
    expect(store.getState().error).toBeNull();
    expect(put).toHaveBeenCalledTimes(2);
  });

  test("401 disables the scope: no PUT on later changes", async () => {
    const { store, get, put } = build();
    get.mockRejectedValue(httpError(401, "unauthorized"));

    store.hydrate();
    await vi.runAllTimersAsync();

    expect(store.getState().status).toBe("disabled");
    store.scheduleSave({ universe: "nifty500", rsiMin: 50, view: "table" });
    await flushDebounce();

    expect(put).not.toHaveBeenCalled();
  });

  test("409 adopts the other tab's envelope and stops the pending write", async () => {
    const { store, get, put } = build();
    get.mockResolvedValue(envelope(DEFAULTS, { saved: false, updated_at: "rev-1" }));
    store.hydrate();
    await vi.runAllTimersAsync();

    const applied: TestValue[] = [];
    const other = { universe: "nifty50", rsiMin: 30, view: "map" };
    put.mockRejectedValueOnce(
      httpError(409, "conflict", { detail: "conflict", current: envelope(other) }),
    );
    // A second hydrate re-registers the apply callback for this assertion.
    store.hydrate({ apply: (v) => applied.push(v) });
    await vi.runAllTimersAsync();

    store.scheduleSave({ universe: "nifty500", rsiMin: 50, view: "table" });
    await flushDebounce();

    expect(store.getState().error).toBe("conflict");
    expect(store.getState().value).toEqual(other);
    expect(applied.at(-1)).toEqual(other);
  });

  test("an unparseable payload falls back to defaults with a warning and never DELETEs", async () => {
    const { store, get, del } = build();
    get.mockResolvedValue(envelope({ universe: 42, view: null }));

    store.hydrate();
    await vi.runAllTimersAsync();

    expect(store.getState().value).toEqual(DEFAULTS);
    expect(store.getState().warning).toBe("invalid_saved_config");
    expect(del).not.toHaveBeenCalled();
  });

  test("an offline PUT retries once silently, then surfaces the chip", async () => {
    const { store, get, put } = build();
    get.mockResolvedValue(envelope(DEFAULTS, { saved: false, updated_at: null }));
    store.hydrate();
    await vi.runAllTimersAsync();

    put.mockRejectedValue(new TypeError("Failed to fetch"));
    store.scheduleSave({ universe: "nifty500", rsiMin: 50, view: "table" });

    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(put).toHaveBeenCalledTimes(1);
    // The first transport failure is silent — one retry is still owed.
    expect(store.getState().error).toBeNull();

    await vi.advanceTimersByTimeAsync(NETWORK_RETRY_MS);
    expect(put).toHaveBeenCalledTimes(2);
    expect(store.getState().error).toBe("not_saved");

    // No further automatic attempt: the user must ask for it.
    await vi.advanceTimersByTimeAsync(NETWORK_RETRY_MS * 3);
    expect(put).toHaveBeenCalledTimes(2);
  });
});

describe("request races", () => {
  test("only the newest hydrate generation is applied", async () => {
    const { store, get } = build();
    const first = deferred<UserConfig<Record<string, unknown>>>();
    const second = deferred<UserConfig<Record<string, unknown>>>();
    get.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    store.hydrate();
    store.hydrate();

    second.resolve(envelope({ universe: "nifty500", rsiMin: 50, view: "table" }));
    await vi.runAllTimersAsync();
    first.resolve(envelope({ universe: "nifty50", rsiMin: 10, view: "map" }));
    await vi.runAllTimersAsync();

    expect(store.getState().value).toEqual({ universe: "nifty500", rsiMin: 50, view: "table" });
  });
});

describe("lifecycle", () => {
  test("dispose flushes the pending change with keepalive", async () => {
    const { store, get, put } = build();
    get.mockResolvedValue(envelope(DEFAULTS, { saved: false, updated_at: null }));
    store.hydrate();
    await vi.runAllTimersAsync();

    store.scheduleSave({ universe: "nifty500", rsiMin: 50, view: "table" });
    store.dispose();
    await vi.runAllTimersAsync();

    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0][2]).toMatchObject({ keepalive: true });
    expect(put.mock.calls[0][1]).toMatchObject({ universe: "nifty500" });
  });

  test("pagehide flushes with keepalive", async () => {
    const { store, get, put } = build();
    get.mockResolvedValue(envelope(DEFAULTS, { saved: false, updated_at: null }));
    store.hydrate();
    await vi.runAllTimersAsync();

    store.scheduleSave({ universe: "nifty50", rsiMin: 20, view: "table" });
    window.dispatchEvent(new Event("pagehide"));
    await vi.runAllTimersAsync();

    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0][2]).toMatchObject({ keepalive: true });
  });

  test("an unreadable payload is repaired by the next write (no baseline key)", async () => {
    const { store, get, put } = build();
    get.mockResolvedValue(envelope({ universe: 42 }));
    store.hydrate();
    await vi.runAllTimersAsync();

    // Defaults are what is on screen; writing them is a repair, not an echo.
    store.scheduleSave({ ...DEFAULTS });
    await flushDebounce();

    expect(put).toHaveBeenCalledTimes(1);
    expect(store.getState().warning).toBe("invalid_saved_config");
  });

  test("returning to the tab adopts another tab's write (decision 8)", async () => {
    const { store, get } = build();
    get.mockResolvedValueOnce(envelope(DEFAULTS, { saved: false, updated_at: null }));
    store.hydrate();
    await vi.runAllTimersAsync();
    expect(store.getState().value).toEqual(DEFAULTS);

    // The other tab wrote while we were away.
    get.mockResolvedValue(envelope({ universe: "nifty50", rsiMin: 20, view: "map" }));
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.runAllTimersAsync();

    expect(store.getState().value).toEqual({ universe: "nifty50", rsiMin: 20, view: "map" });
  });

  test("a refocus read is skipped while a local change is unsaved", async () => {
    const { store, get } = build();
    get.mockResolvedValue(envelope(DEFAULTS, { saved: false, updated_at: null }));
    store.hydrate();
    await vi.runAllTimersAsync();

    store.scheduleSave({ universe: "nifty500", rsiMin: 50, view: "table" });
    const callsBefore = get.mock.calls.length;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.runAllTimersAsync();

    // Local state is strictly newer than the server's; a refetch would undo it.
    expect(get.mock.calls.length).toBe(callsBefore);
    expect(store.getState().value).toEqual({ universe: "nifty500", rsiMin: 50, view: "table" });
  });
});

describe("scheduleSave — synchronous publish", () => {
  const next: TestValue = { universe: "nifty500", rsiMin: 50, view: "table" };

  test("ready: a subscriber sees the new value on the same tick", async () => {
    const { store, get, put } = build();
    get.mockResolvedValue(envelope(DEFAULTS, { saved: false, updated_at: null }));
    store.hydrate();
    await vi.runAllTimersAsync();
    expect(store.getState().status).toBe("ready");

    const seen: Array<TestValue | null> = [];
    const unsubscribe = store.subscribe(() => seen.push(store.getState().value));

    store.scheduleSave(next);
    // No await between the call and these assertions: the notification must be
    // synchronous, otherwise a controlled consumer keeps rendering old state.
    expect(store.getState().value).toEqual(next);
    expect(seen).toEqual([next]);
    expect(put).not.toHaveBeenCalled();

    unsubscribe();
  });

  test("disabled: a subscriber still sees the new value synchronously and nothing is written", async () => {
    const { store, get, put } = build();
    get.mockRejectedValue(httpError(404, "not_found"));
    store.hydrate();
    await vi.runAllTimersAsync();
    expect(store.getState().status).toBe("disabled");

    const seen: Array<TestValue | null> = [];
    const unsubscribe = store.subscribe(() => seen.push(store.getState().value));

    store.scheduleSave(next);
    expect(store.getState().value).toEqual(next);
    expect(seen).toEqual([next]);
    await flushDebounce();
    expect(put).not.toHaveBeenCalled();

    unsubscribe();
  });

  test("before hydration: a subscriber still sees the new value synchronously and nothing is written", async () => {
    const { store, get, put } = build();
    const pendingGet = deferred<UserConfig<Record<string, unknown>>>();
    get.mockReturnValue(pendingGet.promise);
    store.hydrate();
    await vi.runAllTimersAsync();
    expect(store.getState().hydrated).toBe(false);

    const seen: Array<TestValue | null> = [];
    const unsubscribe = store.subscribe(() => seen.push(store.getState().value));

    store.scheduleSave(next);
    expect(store.getState().value).toEqual(next);
    expect(seen).toEqual([next]);
    expect(put).not.toHaveBeenCalled();

    unsubscribe();
  });
});
