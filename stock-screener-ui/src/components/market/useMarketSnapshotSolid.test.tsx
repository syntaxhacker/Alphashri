// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import type { MarketSnapshot, MarketUniverse } from "../../types/marketScreener";
import {
  isLiveUniverse,
  useMarketSnapshotSolid,
  MARKET_LIVE_POLL_MS,
  type UseMarketSnapshotResult,
} from "./useMarketSnapshotSolid";

const api = vi.hoisted(() => ({
  fetchMarketSnapshot: vi.fn(),
  readCachedMarketSnapshot: vi.fn(),
  writeCachedMarketSnapshot: vi.fn(),
}));

vi.mock("../../api/marketScreener", () => ({
  fetchMarketSnapshot: api.fetchMarketSnapshot,
  readCachedMarketSnapshot: api.readCachedMarketSnapshot,
  writeCachedMarketSnapshot: api.writeCachedMarketSnapshot,
}));

// Session clocks are the gate under test — never let the wall clock decide.
const clock = vi.hoisted(() => ({
  isMarketOpenNow: vi.fn(() => true),
  isUsMarketOpen: vi.fn(() => true),
}));

vi.mock("../../state/holidays", () => ({ isMarketOpenNow: clock.isMarketOpenNow }));
vi.mock("../../utils/marketClock", () => ({ isUsMarketOpen: clock.isUsMarketOpen }));

function snapshot(): MarketSnapshot {
  return {
    asOf: "2026-11-17T10:00:00Z",
    universe: "all_equity",
    total: 0,
    updateMode: "streaming",
    rows: [],
  };
}

/** Flush microtasks (promise continuations), never wall-clock timers. */
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.clearAllMocks();
  api.readCachedMarketSnapshot.mockReturnValue(null);
  api.fetchMarketSnapshot.mockResolvedValue(snapshot());
  clock.isMarketOpenNow.mockReturnValue(true);
  clock.isUsMarketOpen.mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useMarketSnapshotSolid — enabled gate", () => {
  test("disabled: no fetch and neither loading nor error is surfaced", async () => {
    const [enabled] = createSignal(false);
    let result!: UseMarketSnapshotResult;
    render(() => {
      result = useMarketSnapshotSolid(() => "all_equity", { enabled });
      return <div data-testid="hook-host" />;
    });
    await flush();

    expect(api.fetchMarketSnapshot).not.toHaveBeenCalled();
    expect(result.isLoading()).toBe(false);
    expect(result.error()).toBeNull();
  });

  test("disabled: keeps the cached snapshot for an instant paint", async () => {
    const cached = snapshot();
    api.readCachedMarketSnapshot.mockReturnValue(cached);
    const [enabled] = createSignal(false);
    let result!: UseMarketSnapshotResult;
    render(() => {
      result = useMarketSnapshotSolid(() => "all_equity", { enabled });
      return <div data-testid="hook-host" />;
    });
    await flush();

    expect(result.snapshot()).toBe(cached);
    expect(result.rows()).toBe(cached.rows);
    expect(api.fetchMarketSnapshot).not.toHaveBeenCalled();
  });

  test("deferCacheUntilEnabled: no default-universe cache paint before the gate opens", async () => {
    const cached = snapshot();
    api.readCachedMarketSnapshot.mockReturnValue(cached);
    const [enabled, setEnabled] = createSignal(false);
    let result!: UseMarketSnapshotResult;
    render(() => {
      result = useMarketSnapshotSolid(() => "all_equity", {
        enabled,
        deferCacheUntilEnabled: true,
      });
      return <div data-testid="hook-host" />;
    });
    await flush();

    expect(result.snapshot()).toBeNull();
    expect(api.fetchMarketSnapshot).not.toHaveBeenCalled();

    setEnabled(true);
    await flush();
    expect(result.snapshot()).toEqual(cached);
    expect(api.readCachedMarketSnapshot).toHaveBeenCalled();
    expect(api.fetchMarketSnapshot).toHaveBeenCalledTimes(1);
  });

  test("enabling fetches once; disabling stops further fetches; re-enabling fetches again", async () => {
    const [enabled, setEnabled] = createSignal(false);
    let result!: UseMarketSnapshotResult;
    render(() => {
      result = useMarketSnapshotSolid(() => "all_equity", { enabled });
      return <div data-testid="hook-host" />;
    });
    await flush();
    expect(api.fetchMarketSnapshot).not.toHaveBeenCalled();

    setEnabled(true);
    await flush();
    expect(api.fetchMarketSnapshot).toHaveBeenCalledTimes(1);
    expect(result.isLoading()).toBe(false);

    setEnabled(false);
    await flush();
    expect(api.fetchMarketSnapshot).toHaveBeenCalledTimes(1);

    setEnabled(true);
    await flush();
    expect(api.fetchMarketSnapshot).toHaveBeenCalledTimes(2);
  });

  test("default (no enabled option) still fetches on mount", async () => {
    let result!: UseMarketSnapshotResult;
    render(() => {
      result = useMarketSnapshotSolid(() => "all_equity");
      return <div data-testid="hook-host" />;
    });
    await flush();

    expect(api.fetchMarketSnapshot).toHaveBeenCalledTimes(1);
    expect(api.fetchMarketSnapshot.mock.calls[0][0]).toMatchObject({ universe: "all_equity" });
    expect(result.isLoading()).toBe(false);
  });
});

describe("useMarketSnapshotSolid — live auto-refresh", () => {
  function mount(universe: () => MarketUniverse = () => "all_equity") {
    let result!: UseMarketSnapshotResult;
    render(() => {
      result = useMarketSnapshotSolid(universe);
      return <div data-testid="hook-host" />;
    });
    return result;
  }

  test("live market: every 5s tick issues exactly one fetch", async () => {
    vi.useFakeTimers();
    const calls = api.fetchMarketSnapshot;
    mount();
    await flush();
    expect(calls).toHaveBeenCalledTimes(1); // mount fetch

    await vi.advanceTimersByTimeAsync(MARKET_LIVE_POLL_MS);
    expect(calls).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(MARKET_LIVE_POLL_MS);
    expect(calls).toHaveBeenCalledTimes(3);
    expect(MARKET_LIVE_POLL_MS).toBe(5_000);
    expect(clock.isMarketOpenNow).toHaveBeenCalled();
  });

  test("a still-running fetch is skipped, never queued", async () => {
    vi.useFakeTimers();
    let resolveHang!: (value: MarketSnapshot) => void;
    api.fetchMarketSnapshot
      .mockResolvedValueOnce(snapshot())
      .mockImplementationOnce(
        () => new Promise<MarketSnapshot>((resolve) => (resolveHang = resolve)),
      );
    mount();
    await flush();
    expect(api.fetchMarketSnapshot).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(MARKET_LIVE_POLL_MS);
    expect(api.fetchMarketSnapshot).toHaveBeenCalledTimes(2); // in flight now

    // Two more ticks inside the 15s timeout window: both skip instead of
    // stacking a second request behind the hung one.
    await vi.advanceTimersByTimeAsync(MARKET_LIVE_POLL_MS);
    await vi.advanceTimersByTimeAsync(MARKET_LIVE_POLL_MS);
    expect(api.fetchMarketSnapshot).toHaveBeenCalledTimes(2);

    resolveHang(snapshot());
    await flush();
    await vi.advanceTimersByTimeAsync(MARKET_LIVE_POLL_MS);
    expect(api.fetchMarketSnapshot).toHaveBeenCalledTimes(3);
  });

  test("closed market: ticks never fetch", async () => {
    vi.useFakeTimers();
    clock.isMarketOpenNow.mockReturnValue(false);
    mount();
    await flush();
    expect(api.fetchMarketSnapshot).toHaveBeenCalledTimes(1); // mount only

    await vi.advanceTimersByTimeAsync(30_000);
    expect(api.fetchMarketSnapshot).toHaveBeenCalledTimes(1);
  });

  test("closed market: one refresh per 60s server TTL, never a 5s poll", async () => {
    vi.useFakeTimers();
    clock.isMarketOpenNow.mockReturnValue(false);
    mount();
    await flush();
    expect(api.fetchMarketSnapshot).toHaveBeenCalledTimes(1); // mount snapshot

    // Two live-cadence windows: no request leaves while the session is closed.
    await vi.advanceTimersByTimeAsync(MARKET_LIVE_POLL_MS * 2);
    expect(api.fetchMarketSnapshot).toHaveBeenCalledTimes(1);

    // Just before the 60s cache TTL: still only the mount snapshot.
    await vi.advanceTimersByTimeAsync(60_000 - MARKET_LIVE_POLL_MS * 2 - 1);
    expect(api.fetchMarketSnapshot).toHaveBeenCalledTimes(1);

    // At the TTL the snapshot is refreshed once, then the next tick is another
    // minute away. This is the closed cadence; live stays at 5s.
    await vi.advanceTimersByTimeAsync(1);
    expect(api.fetchMarketSnapshot).toHaveBeenCalledTimes(2);
  });

  test("refresh(true) forces one fetch; the next auto tick is unforced", async () => {
    vi.useFakeTimers();
    const result = mount();
    await flush();
    expect(api.fetchMarketSnapshot.mock.calls[0][0]).toMatchObject({ force: false });

    result.refresh(true);
    await flush();
    expect(api.fetchMarketSnapshot).toHaveBeenCalledTimes(2);
    expect(api.fetchMarketSnapshot.mock.calls[1][0]).toMatchObject({ force: true });

    await vi.advanceTimersByTimeAsync(MARKET_LIVE_POLL_MS);
    expect(api.fetchMarketSnapshot).toHaveBeenCalledTimes(3);
    expect(api.fetchMarketSnapshot.mock.calls[2][0]).toMatchObject({ force: false });
  });

  test("switching universe re-evaluates the live predicate", async () => {
    vi.useFakeTimers();
    clock.isMarketOpenNow.mockReturnValue(true);
    clock.isUsMarketOpen.mockReturnValue(false);
    const [universe, setUniverse] = createSignal<MarketUniverse>("all_equity");
    mount(universe);
    await flush();
    expect(api.fetchMarketSnapshot).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(MARKET_LIVE_POLL_MS);
    expect(api.fetchMarketSnapshot).toHaveBeenCalledTimes(2); // India is live

    setUniverse("us");
    await flush();
    expect(api.fetchMarketSnapshot).toHaveBeenCalledTimes(3); // switch always fetches once

    await vi.advanceTimersByTimeAsync(MARKET_LIVE_POLL_MS * 3);
    expect(api.fetchMarketSnapshot).toHaveBeenCalledTimes(3); // US closed → no polls
    expect(clock.isUsMarketOpen).toHaveBeenCalled();

    clock.isUsMarketOpen.mockReturnValue(true);
    // The closed-cadence timer detects the reopening; from there polling is
    // live again at 5s. Advance only the remainder of the 60s window.
    await vi.advanceTimersByTimeAsync(60_000 - MARKET_LIVE_POLL_MS * 3);
    expect(api.fetchMarketSnapshot).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(MARKET_LIVE_POLL_MS);
    expect(api.fetchMarketSnapshot).toHaveBeenCalledTimes(5);
  });

  test("isLiveUniverse routes US to the ET clock and everything else to IST", () => {
    clock.isUsMarketOpen.mockReturnValue(true);
    clock.isMarketOpenNow.mockReturnValue(false);
    expect(isLiveUniverse("us")).toBe(true);
    expect(isLiveUniverse("nifty500")).toBe(false);
    expect(isLiveUniverse("all_equity")).toBe(false);

    clock.isUsMarketOpen.mockReturnValue(false);
    clock.isMarketOpenNow.mockReturnValue(true);
    expect(isLiveUniverse("us")).toBe(false);
    expect(isLiveUniverse("nifty50")).toBe(true);
    expect(isLiveUniverse("nse_fo")).toBe(true);
  });
});

describe("useMarketSnapshotSolid — wire format opt-in", () => {
  function mountWithOptions(options: Parameters<typeof useMarketSnapshotSolid>[1]) {
    let result!: UseMarketSnapshotResult;
    render(() => {
      result = useMarketSnapshotSolid(() => "all_equity", options);
      return <div data-testid="hook-host" />;
    });
    return result;
  }

  test("wireFormat: 'columns' reaches every fetch — mount, refresh and auto tick", async () => {
    vi.useFakeTimers();
    const result = mountWithOptions({ wireFormat: "columns" });
    await flush();
    expect(api.fetchMarketSnapshot).toHaveBeenCalledTimes(1);
    expect(api.fetchMarketSnapshot.mock.calls[0][0]).toMatchObject({
      universe: "all_equity",
      format: "columns",
    });

    result.refresh(true);
    await flush();
    expect(api.fetchMarketSnapshot.mock.calls[1][0]).toMatchObject({
      format: "columns",
      force: true,
    });

    await vi.advanceTimersByTimeAsync(MARKET_LIVE_POLL_MS);
    expect(api.fetchMarketSnapshot).toHaveBeenCalledTimes(3);
    expect(api.fetchMarketSnapshot.mock.calls[2][0]).toMatchObject({
      format: "columns",
      force: false,
    });
  });

  test("default (no wireFormat) sends no format param at all", async () => {
    mountWithOptions({});
    await flush();
    expect(api.fetchMarketSnapshot).toHaveBeenCalledTimes(1);
    expect(api.fetchMarketSnapshot.mock.calls[0][0]).toMatchObject({ universe: "all_equity" });
    expect(api.fetchMarketSnapshot.mock.calls[0][0]).not.toHaveProperty("format");
  });
});
