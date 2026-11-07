// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { usePatternMatrix } from "./usePatternMatrix";
import { fetchPatternMatrix } from "../api/chartPatterns";
import type { PatternMatrixResponse } from "../types/chartPatterns";

vi.mock("../api/chartPatterns", () => ({
  fetchPatternMatrix: vi.fn(),
}));

const mockFetchMatrix = vi.mocked(fetchPatternMatrix);

function makeResponse(
  overrides: Partial<PatternMatrixResponse> = {},
): PatternMatrixResponse {
  return {
    universe: "NIFTY",
    timeframes: [],
    rows: [],
    data_through: null,
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
    await vi.advanceTimersByTimeAsync(150);
  });
}

describe("usePatternMatrix", () => {
  test("fetches once on mount", async () => {
    mockFetchMatrix.mockResolvedValue(makeResponse());
    const { result } = renderHook(() =>
      usePatternMatrix("NIFTY", true, null, ["1D"]),
    );
    expect(result.current.loading).toBe(true);
    await settle();
    expect(mockFetchMatrix).toHaveBeenCalledTimes(1);
    expect(mockFetchMatrix).toHaveBeenCalledWith("NIFTY", {
      limit: 1000,
      timeframes: ["1D"],
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.data).toEqual(makeResponse());
  });

  test("does not refetch when refreshKey stays the same across rerenders", async () => {
    mockFetchMatrix.mockResolvedValue(makeResponse());
    const { result, rerender } = renderHook(
      ({ key }: { key: string | null }) =>
        usePatternMatrix("NIFTY", true, key, ["1D"]),
      { initialProps: { key: "job-1" } },
    );
    await settle();
    expect(mockFetchMatrix).toHaveBeenCalledTimes(1);
    rerender({ key: "job-1" });
    rerender({ key: "job-1" });
    await settle();
    expect(mockFetchMatrix).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(false);
  });

  test("refetches once when refreshKey changes", async () => {
    mockFetchMatrix.mockResolvedValue(makeResponse());
    const { result, rerender } = renderHook(
      ({ key }: { key: string | null }) =>
        usePatternMatrix("NIFTY", true, key, ["1D"]),
      { initialProps: { key: null } },
    );
    await settle();
    expect(mockFetchMatrix).toHaveBeenCalledTimes(1); // initial mount load allowed
    rerender({ key: "job-1" });
    await settle();
    expect(mockFetchMatrix).toHaveBeenCalledTimes(2); // exactly one refetch, no double-fire
    expect(result.current.loading).toBe(false);
  });

  test("does not fetch while enabled=false, and fetches when it flips true", async () => {
    mockFetchMatrix.mockResolvedValue(makeResponse());
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        usePatternMatrix("NIFTY", enabled, null, ["1D"]),
      { initialProps: { enabled: false } },
    );
    await settle();
    expect(mockFetchMatrix).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    rerender({ enabled: true });
    await settle();
    expect(mockFetchMatrix).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(false);
  });
});
