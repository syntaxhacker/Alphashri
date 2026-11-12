// @vitest-environment happy-dom
import { cleanup, renderHook } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { WallsPayload } from "@/api/reportNifty";
import { useReplayWalls } from "./useReplayWalls";
import type { ReplayWallsOptions } from "./useReplayWalls";

// The hook imports the real fetcher, but every case injects a fake one. Mocking
// the module keeps the suite network- and auth-store-free.
vi.mock("@/api/reportNifty", () => ({ fetchOptionsWalls: vi.fn() }));

function wallsAt(tag: string): WallsPayload {
  return { symbol: "NIFTY", read: tag } as unknown as WallsPayload;
}

function wallsWithLastT(tag: string, lastT: string): WallsPayload {
  return {
    symbol: "NIFTY",
    read: tag,
    freshness: { last_t: lastT, age_sec: 0, stale: false, rows: 0, gaps: [] },
  } as unknown as WallsPayload;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Flush the microtask queue (and any 0 ms timers) under fake timers. */
async function flush() {
  await vi.advanceTimersByTimeAsync(0);
}

interface HarnessState {
  enabled: boolean;
  symbol: string;
  date?: string;
  at?: string;
  includeMap: boolean;
}

function setupHook(fetcher: typeof vi.fn, over: Partial<HarnessState> = {}) {
  const [state, setState] = createSignal<HarnessState>({
    enabled: true,
    symbol: "NIFTY",
    date: "2026-10-10",
    at: "2026-10-10T09:15:00+05:30",
    includeMap: false,
    ...over,
  });
  const hookOpts: ReplayWallsOptions = {
    enabled: () => state().enabled,
    symbol: () => state().symbol,
    date: () => state().date,
    at: () => state().at,
    includeMap: () => state().includeMap,
    live: false,
    throttleMs: 150,
    fetcher: fetcher as unknown as ReplayWallsOptions["fetcher"],
  };
  const { result, cleanup } = renderHook(() => useReplayWalls(hookOpts));
  const setProps = (patch: Partial<HarnessState>) =>
    setState((s) => ({ ...s, ...patch }));
  return { result, setProps, cleanup };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useReplayWalls", () => {
  test("collapses rapid at changes into one trailing fetch with the latest cutoff", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValue(wallsAt("t1"));
    const { result, setProps } = setupHook(fetcher, { at: "2026-10-10T09:15:00+05:30" });

    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.walls()?.read).toBe("t1");
    expect(result.syncing()).toBe(false);

    // Four scrub ticks inside the 150 ms window.
          await vi.advanceTimersByTimeAsync(20);
    setProps({ at: "2026-10-10T09:16:00+05:30" });
          await vi.advanceTimersByTimeAsync(20);
    setProps({ at: "2026-10-10T09:17:00+05:30" });
          await vi.advanceTimersByTimeAsync(20);
    setProps({ at: "2026-10-10T09:18:00+05:30" });

    // Still one request: the ticks only moved the pending timer's target.
    expect(fetcher).toHaveBeenCalledTimes(1);

          await vi.advanceTimersByTimeAsync(150);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][2]).toBe("2026-10-10T09:18:00+05:30");
    expect(result.walls()?.read).toBe("t1");
  });

  test("a newer cutoff during an in-flight request triggers an immediate catch-up", async () => {
    vi.useFakeTimers();
    const first = deferred<WallsPayload | null>();
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(wallsAt("second"));
    const { result, setProps } = setupHook(fetcher, { at: "2026-10-10T09:15:00+05:30" });

    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.syncing()).toBe(true);

    setProps({ at: "2026-10-10T09:20:00+05:30" });
    await flush();
    // In flight: no second request yet, no timer either.
    expect(fetcher).toHaveBeenCalledTimes(1);

          first.resolve(wallsAt("first"));
      await vi.advanceTimersByTimeAsync(0);
    // Settle applied its payload, then immediately chased the newest cutoff.
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][2]).toBe("2026-10-10T09:20:00+05:30");

    await flush();
    expect(result.walls()?.read).toBe("second");
    expect(result.syncing()).toBe(false);
  });

  test("pipelines the newest cutoff once the throttle window elapses", async () => {
    vi.useFakeTimers();
    const older = deferred<WallsPayload | null>();
    const newer = deferred<WallsPayload | null>();
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    const { result, setProps } = setupHook(fetcher, { at: "2026-10-10T09:15:00+05:30" });

    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Still in flight, but the 150 ms window has elapsed: the new playhead
    // must start now instead of waiting for the first request to settle.
          await vi.advanceTimersByTimeAsync(200);
    setProps({ at: "2026-10-10T09:25:00+05:30" });
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][2]).toBe("2026-10-10T09:25:00+05:30");

    // The superseded response still paints: it is newer than the empty card,
    // so a fast drag shows intermediate minutes instead of freezing.
          older.resolve(wallsAt("older"));
      await vi.advanceTimersByTimeAsync(0);
    expect(result.walls()?.read).toBe("older");

          newer.resolve(wallsAt("newer"));
      await vi.advanceTimersByTimeAsync(0);
    expect(result.walls()?.read).toBe("newer");
    expect(result.syncing()).toBe(false);
  });

  test("an out-of-order older reply does not walk the card backwards", async () => {
    vi.useFakeTimers();
    const first = deferred<WallsPayload | null>();
    const second = deferred<WallsPayload | null>();
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result, setProps } = setupHook(fetcher, { at: "2026-10-10T09:15:00+05:30" });

    await flush();
          await vi.advanceTimersByTimeAsync(200);
    setProps({ at: "2026-10-10T09:25:00+05:30" });
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);

    // Newer reply lands first, then the older one arrives late.
          second.resolve(wallsAt("09:25"));
      await vi.advanceTimersByTimeAsync(0);
    expect(result.walls()?.read).toBe("09:25");

          first.resolve(wallsAt("09:15"));
      await vi.advanceTimersByTimeAsync(0);
    expect(result.walls()?.read).toBe("09:25");
  });

  test("a stale response never overwrites a newer payload", async () => {
    vi.useFakeTimers();
    const older = deferred<WallsPayload | null>();
    const newer = deferred<WallsPayload | null>();
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    const { result, setProps } = setupHook(fetcher, { enabled: true });

    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Disabling invalidates the in-flight response (a new sequence id).
    setProps({ enabled: false });
          await vi.advanceTimersByTimeAsync(200);

    // Re-enabling starts a fresh request with the newer id.
    setProps({ enabled: true });
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);

          newer.resolve(wallsAt("new"));
      await vi.advanceTimersByTimeAsync(0);
    expect(result.walls()?.read).toBe("new");

          older.resolve(wallsAt("old"));
      await vi.advanceTimersByTimeAsync(0);
    expect(result.walls()?.read).toBe("new");
  });

  test("includeMap bypasses the throttle", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValue(wallsAt("w"));
    const { setProps } = setupHook(fetcher, { includeMap: false });

    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);

          await vi.advanceTimersByTimeAsync(10);
    // The 10 ms elapsed < 150 ms throttle, but opening the map must not wait.
    setProps({ includeMap: true });
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][4]).toBe(true);
  });

  test("switching symbol/date clears the old walls and ignores its late response", async () => {
    vi.useFakeTimers();
    const dayOne = deferred<WallsPayload | null>();
    const dayTwo = deferred<WallsPayload | null>();
    const sensex = deferred<WallsPayload | null>();
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(dayOne.promise)
      .mockReturnValueOnce(dayTwo.promise)
      .mockReturnValueOnce(sensex.promise);
    const { result, setProps } = setupHook(fetcher, { symbol: "NIFTY", date: "2026-10-09" });

    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
          dayOne.resolve(wallsAt("2026-10-09"));
      await vi.advanceTimersByTimeAsync(0);
    expect(result.walls()?.read).toBe("2026-10-09");

    // Date change: the previous card must never paint on the new day.
    setProps({ symbol: "NIFTY", date: "2026-10-10" });
    await flush();
    expect(result.walls()).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][1]).toBe("2026-10-10");

    // Symbol change while that request is in flight: a fresh request starts.
    setProps({ symbol: "SENSEX", date: "2026-10-10" });
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[2][0]).toBe("SENSEX");

          sensex.resolve(wallsAt("sensex"));
      await vi.advanceTimersByTimeAsync(0);
    expect(result.walls()?.read).toBe("sensex");

    // The NIFTY request that belonged to the previous context settles late.
          dayTwo.resolve(wallsAt("nifty-late"));
      await vi.advanceTimersByTimeAsync(0);
    expect(result.walls()?.read).toBe("sensex");
  });

  test("paints the requested cutoff when scrubbing forward", async () => {
    vi.useFakeTimers();
    const first = deferred<WallsPayload | null>();
    const fetcher = vi.fn().mockReturnValue(first.promise);
    const { result, setProps } = setupHook(fetcher, { at: "2026-11-09T11:36:00+05:30" });

    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);

          first.resolve(wallsWithLastT("11:36", "2026-11-09T11:36:00+05:30"));
      await vi.advanceTimersByTimeAsync(0);
    expect(result.walls()?.freshness.last_t).toBe(
      "2026-11-09T11:36:00+05:30",
    );
    expect(result.syncing()).toBe(false);
  });

  test("paints an older cutoff when the playhead moves backwards", async () => {
    vi.useFakeTimers();
    const first = deferred<WallsPayload | null>();
    const second = deferred<WallsPayload | null>();
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result, setProps } = setupHook(fetcher, { at: "2026-11-09T11:36:00+05:30" });

    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);

          first.resolve(wallsWithLastT("11:36", "2026-11-09T11:36:00+05:30"));
      await vi.advanceTimersByTimeAsync(0);
    expect(result.walls()?.freshness.last_t).toBe(
      "2026-11-09T11:36:00+05:30",
    );

    // Scrub back to 11:33: the older frame must paint, not be discarded.
    setProps({ at: "2026-11-09T11:33:00+05:30" });
          await vi.advanceTimersByTimeAsync(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][2]).toBe("2026-11-09T11:33:00+05:30");

          second.resolve(wallsWithLastT("11:33", "2026-11-09T11:33:00+05:30"));
      await vi.advanceTimersByTimeAsync(0);
    expect(result.walls()?.freshness.last_t).toBe(
      "2026-11-09T11:33:00+05:30",
    );
  });

  test("a late future response does not overwrite an older playhead", async () => {
    vi.useFakeTimers();
    const late = deferred<WallsPayload | null>(); // 11:36, started first
    const now = deferred<WallsPayload | null>(); // 11:33, started second
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(late.promise)
      .mockReturnValueOnce(now.promise);
    const { result, setProps } = setupHook(fetcher, { at: "2026-11-09T11:36:00+05:30" });

    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Let the throttle window elapse while the 11:36 request is still in flight.
          await vi.advanceTimersByTimeAsync(200);

    // User scrubs back to 11:33: the window has elapsed, so the newest cutoff
    // starts now even though the 11:36 request is still in flight.
    setProps({ at: "2026-11-09T11:33:00+05:30" });
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][2]).toBe("2026-11-09T11:33:00+05:30");

    // The 11:33 response lands first and paints.
          now.resolve(wallsWithLastT("11:33", "2026-11-09T11:33:00+05:30"));
      await vi.advanceTimersByTimeAsync(0);
    expect(result.walls()?.freshness.last_t).toBe(
      "2026-11-09T11:33:00+05:30",
    );

    // The stale 11:36 response arrives late — it must be discarded.
          late.resolve(wallsWithLastT("11:36", "2026-11-09T11:36:00+05:30"));
      await vi.advanceTimersByTimeAsync(0);
    expect(result.walls()?.freshness.last_t).toBe(
      "2026-11-09T11:33:00+05:30",
    );
  });
});
