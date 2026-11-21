// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, renderHook } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { usePatternSummary, PATTERN_SUMMARY_DEBOUNCE_MS } from "./usePatternSummary";
import { lookupPatterns } from "../../api/patternLookup";

vi.mock("../../api/patternLookup", () => ({
  PATTERN_LOOKUP_MAX_SYMBOLS: 500,
  lookupPatterns: vi.fn(),
}));

const mockedLookup = vi.mocked(lookupPatterns);

function stored(symbols: string[], session = "2026-11-16") {
  return {
    timeframe: "1D",
    session,
    source: "stored",
    data_through: "2026-11-14",
    items: symbols.map((symbol) => ({
      symbol,
      count: 1,
      patterns: [
        {
          pattern_id: "bull_flag",
          name: "Bull Flag",
          direction: "bullish",
          status: "confirmed",
          quality: "strong",
          confidence: 80,
          bars_ago: 2,
        },
      ],
    })),
  };
}

function empty(session = "2026-11-16") {
  return {
    timeframe: "1D",
    session,
    source: "stored",
    data_through: null,
    items: [],
  };
}

const resolveAll = () => vi.advanceTimersByTimeAsync(PATTERN_SUMMARY_DEBOUNCE_MS);

beforeEach(() => {
  vi.useFakeTimers();
  mockedLookup.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("usePatternSummary", () => {
  test("a scroll burst of three windows costs one request, for the last window", async () => {
    mockedLookup.mockResolvedValue(stored(["A", "B"]) as never);
    const [symbols, setSymbols] = createSignal(["A"]);

    const { result } = renderHook(() => usePatternSummary(symbols, () => "all_equity"));

    setSymbols(["A", "B"]);
    await vi.advanceTimersByTimeAsync(50);
    setSymbols(["A", "B", "C"]);
    await vi.advanceTimersByTimeAsync(50);
    setSymbols(["A", "B"]);
    await resolveAll();

    expect(mockedLookup).toHaveBeenCalledTimes(1);
    expect(mockedLookup.mock.calls[0][0].symbols).toEqual(["A", "B"]);
    await vi.waitFor(() => expect(result.summary().size).toBe(2));
  });

  test("the same window twice costs one request (cache, not a second call)", async () => {
    mockedLookup.mockResolvedValue(stored(["A", "B"]) as never);
    const [symbols, setSymbols] = createSignal(["A", "B"]);

    renderHook(() => usePatternSummary(symbols, () => "all_equity"));
    await resolveAll();
    expect(mockedLookup).toHaveBeenCalledTimes(1);

    // Same membership in a different order — a re-sort must be free.
    setSymbols(["B", "A"]);
    await resolveAll();
    expect(mockedLookup).toHaveBeenCalledTimes(1);

    // Leaving and returning: every symbol is already cached.
    setSymbols(["A"]);
    await resolveAll();
    setSymbols(["A", "B"]);
    await resolveAll();
    expect(mockedLookup).toHaveBeenCalledTimes(1);
  });

  test("a new window only asks for the symbols it does not have yet", async () => {
    mockedLookup
      .mockResolvedValueOnce(stored(["A", "B"]) as never)
      .mockResolvedValueOnce(stored(["C"]) as never);
    const [symbols, setSymbols] = createSignal(["A", "B"]);

    renderHook(() => usePatternSummary(symbols, () => "all_equity"));
    await resolveAll();

    setSymbols(["A", "B", "C"]);
    await resolveAll();

    expect(mockedLookup).toHaveBeenCalledTimes(2);
    expect(mockedLookup.mock.calls[1][0].symbols).toEqual(["C"]);
  });

  test("a window change aborts the request it supersedes", async () => {
    let signal: AbortSignal | undefined;
    mockedLookup.mockImplementation((body, init) => {
      signal = init?.signal ?? undefined;
      // Never settles: the test only cares that the next window cancels it.
      return new Promise(() => {}) as never;
    });
    const [symbols, setSymbols] = createSignal(["A"]);

    renderHook(() => usePatternSummary(symbols, () => "all_equity"));
    await resolveAll();
    expect(signal?.aborted).toBe(false);

    mockedLookup.mockResolvedValue(empty() as never);
    setSymbols(["B"]);
    await resolveAll();
    expect(signal?.aborted).toBe(true);
  });

  test("unmount aborts the pending request", async () => {
    let signal: AbortSignal | undefined;
    mockedLookup.mockImplementation((body, init) => {
      signal = init?.signal ?? undefined;
      return new Promise(() => {}) as never;
    });

    const { cleanup: dispose } = renderHook(() =>
      usePatternSummary(() => ["A"], () => "all_equity"),
    );
    await resolveAll();
    expect(signal?.aborted).toBe(false);

    dispose();
    expect(signal?.aborted).toBe(true);
  });

  test("empty items mean the 1D scan has not run: the map stays empty", async () => {
    mockedLookup.mockResolvedValue(empty() as never);
    const [symbols, setSymbols] = createSignal(["A", "B"]);

    const { result } = renderHook(() => usePatternSummary(symbols, () => "all_equity"));
    await resolveAll();

    expect(result.summary().size).toBe(0);
    // A known miss stays cached: scrolling back must not re-ask.
    setSymbols(["A"]);
    await resolveAll();
    setSymbols(["A", "B"]);
    await resolveAll();
    expect(mockedLookup).toHaveBeenCalledTimes(1);
  });

  test("a failing lookup is silent: empty map, one retry, then no more requests", async () => {
    mockedLookup.mockRejectedValue(new Error("HTTP 503"));
    const [symbols] = createSignal(["A"]);

    const { result } = renderHook(() => usePatternSummary(symbols, () => "all_equity"));
    await resolveAll();
    await vi.advanceTimersByTimeAsync(0);

    expect(mockedLookup).toHaveBeenCalledTimes(2);
    expect(result.summary().size).toBe(0);
    expect(result.loading()).toBe(false);
  });

  test("a new session invalidates the cached answers", async () => {
    mockedLookup
      .mockResolvedValueOnce(stored(["A"], "2026-11-16") as never)
      .mockResolvedValueOnce(stored(["B"], "2026-11-17") as never);
    const [symbols, setSymbols] = createSignal(["A"]);

    const { result } = renderHook(() => usePatternSummary(symbols, () => "all_equity"));
    await resolveAll();
    expect([...result.summary().keys()]).toEqual(["A"]);

    setSymbols(["B"]);
    await resolveAll();

    // Yesterday's A must not survive beside today's B.
    expect([...result.summary().keys()]).toEqual(["B"]);
  });

  test("switching universe re-scopes the read instead of reusing the old cache", async () => {
    mockedLookup
      .mockResolvedValueOnce(stored(["A"]) as never)
      .mockResolvedValueOnce(stored(["A"]) as never);
    const [scope, setScope] = createSignal("all_equity");

    renderHook(() => usePatternSummary(() => ["A"], scope));
    await resolveAll();
    expect(mockedLookup.mock.calls[0][0].universe).toBe("all_equity");

    setScope("nifty500");
    await resolveAll();

    expect(mockedLookup).toHaveBeenCalledTimes(2);
    expect(mockedLookup.mock.calls[1][0].universe).toBe("nifty500");
    expect(mockedLookup.mock.calls[1][0].symbols).toEqual(["A"]);
  });

  test("normalizes case and drops duplicates before asking", async () => {
    mockedLookup.mockResolvedValue(empty() as never);

    renderHook(() =>
      usePatternSummary(() => [" reliance ", "RELIANCE", "tcs", ""], () => "all_equity"),
    );
    await resolveAll();

    expect(mockedLookup.mock.calls[0][0].symbols).toEqual(["RELIANCE", "TCS"]);
  });

  test("an empty window never asks", async () => {
    renderHook(() => usePatternSummary(() => [], () => "all_equity"));
    await resolveAll();

    expect(mockedLookup).not.toHaveBeenCalled();
  });
});
