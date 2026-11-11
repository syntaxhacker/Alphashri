// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useValueScan } from "./useValueScan";
import { valueScan } from "../api/valueScan";
import type { ValueFilters, ValueScanResponse } from "../api/valueScan";

vi.mock("../api/valueScan", () => ({
  valueScan: vi.fn(),
}));

const mockValueScan = vi.mocked(valueScan);

function makeResponse(overrides: Partial<ValueScanResponse> = {}): ValueScanResponse {
  return {
    market: "india",
    currency: "INR",
    as_of: "2026-10-21T10:00:00+05:30",
    scanned: 100,
    matched: 2,
    fields_complete: true,
    filters_applied: {},
    warnings: [],
    rows: [],
    sectors: [{ name: "Banks", count: 2, avg_score: 75 }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

async function settle(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(350);
  });
}

describe("useValueScan", () => {
  test("debounces filter changes by ~300ms", async () => {
    mockValueScan.mockResolvedValue(makeResponse());
    const { result, rerender } = renderHook(({ f }: { f: ValueFilters }) => useValueScan(f), {
      initialProps: { f: { market: "india" } as ValueFilters },
    });
    expect(result.current.isLoading).toBe(true);
    rerender({ f: { market: "usa" as const } });
    rerender({ f: { market: "global" as const } });
    expect(mockValueScan).not.toHaveBeenCalled();
    await settle();
    expect(mockValueScan).toHaveBeenCalledTimes(1);
    expect(mockValueScan).toHaveBeenCalledWith(
      { market: "global" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  test("exposes rows, sectors, meta, warnings, and lastUpdated", async () => {
    mockValueScan.mockResolvedValue(
      makeResponse({ warnings: ["partial"], matched: 5, scanned: 50 }),
    );
    const { result } = renderHook(() => useValueScan({ market: "india" }));
    await settle();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.sectors).toHaveLength(1);
    expect(result.current.meta?.scanned).toBe(50);
    expect(result.current.meta?.matched).toBe(5);
    expect(result.current.warnings).toEqual(["partial"]);
    expect(result.current.lastUpdated).toBe("2026-10-21T10:00:00+05:30");
  });

  test("aborts the superseded request when filters change", async () => {
    let resolveFirst!: (v: ValueScanResponse) => void;
    const first = new Promise<ValueScanResponse>((res) => {
      resolveFirst = res;
    });
    mockValueScan.mockReturnValueOnce(first);
    mockValueScan.mockResolvedValue(makeResponse({ market: "usa" }));
    const { rerender } = renderHook(({ f }: { f: ValueFilters }) => useValueScan(f), {
      initialProps: { f: { market: "india" } as ValueFilters },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    expect(mockValueScan).toHaveBeenCalledTimes(1);
    const firstSignal = mockValueScan.mock.calls[0][1]?.signal as AbortSignal;
    rerender({ f: { market: "usa" as const } });
    await settle();
    expect(firstSignal.aborted).toBe(true);
    expect(mockValueScan).toHaveBeenCalledTimes(2);
    resolveFirst(makeResponse());
  });

  test("aborts in-flight request on unmount", async () => {
    mockValueScan.mockReturnValue(new Promise(() => {}));
    const { unmount } = renderHook(() => useValueScan({ market: "india" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    expect(mockValueScan).toHaveBeenCalledTimes(1);
    const signal = mockValueScan.mock.calls[0][1]?.signal as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
  });

  test("serves the last successful response from cache", async () => {
    const indiaRes = makeResponse({ market: "india", matched: 7 });
    const usaRes = makeResponse({ market: "usa", matched: 3 });
    mockValueScan.mockImplementation((filters?: ValueFilters) =>
      Promise.resolve(filters?.market === "usa" ? usaRes : indiaRes),
    );
    const { result, rerender } = renderHook(({ f }: { f: ValueFilters }) => useValueScan(f), {
      initialProps: { f: { market: "india" } as ValueFilters },
    });
    await settle();
    expect(result.current.meta?.matched).toBe(7);
    rerender({ f: { market: "usa" as const } });
    await settle();
    expect(result.current.meta?.matched).toBe(3);
    // Back to a previously-seen key: cached rows appear synchronously.
    rerender({ f: { market: "india" as const } });
    expect(result.current.rows).toEqual(indiaRes.rows);
    expect(result.current.meta?.matched).toBe(7);
  });

  test("refresh() refetches immediately and is stable", async () => {
    mockValueScan.mockResolvedValue(makeResponse());
    const { result } = renderHook(() => useValueScan({ market: "india" }));
    await settle();
    expect(mockValueScan).toHaveBeenCalledTimes(1);
    const firstRefresh = result.current.refresh;
    mockValueScan.mockResolvedValueOnce(makeResponse({ matched: 9 }));
    act(() => {
      result.current.refresh();
    });
    expect(result.current.refresh).toBe(firstRefresh);
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockValueScan).toHaveBeenCalledTimes(2);
  });

  test("exposes error state on failure and keeps no stale loading", async () => {
    mockValueScan.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useValueScan({ market: "india" }));
    await settle();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error?.message).toBe("boom");
    expect(result.current.rows).toEqual([]);
  });
});
