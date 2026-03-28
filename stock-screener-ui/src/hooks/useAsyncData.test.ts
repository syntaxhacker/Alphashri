// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAsyncData } from "./useAsyncData";

describe("useAsyncData", () => {
  it("fetches data on mount when autoFetch is true", async () => {
    const mockData = { items: [1, 2, 3] };
    const fetchFn = vi.fn().mockResolvedValue(mockData);

    const { result } = renderHook(() => useAsyncData({ fetchFn }));

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual(mockData);
    expect(result.current.error).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("does not fetch on mount when autoFetch is false", () => {
    const fetchFn = vi.fn();

    const { result } = renderHook(() => useAsyncData({ fetchFn, autoFetch: false }));

    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("handles fetch errors", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useAsyncData({ fetchFn }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Network error");
    expect(result.current.data).toBeNull();
  });

  it("uses custom error message for non-Error throws", async () => {
    const fetchFn = vi.fn().mockRejectedValue("unknown error");

    const { result } = renderHook(() => useAsyncData({ fetchFn, errorMessage: "Custom error" }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Custom error");
  });

  it("execute can be called manually", async () => {
    const mockData = "refreshed";
    const fetchFn = vi.fn().mockResolvedValue(mockData);

    const { result } = renderHook(() => useAsyncData({ fetchFn, autoFetch: false }));

    await act(async () => {
      await result.current.execute();
    });

    expect(result.current.data).toBe(mockData);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("setData and setError work", async () => {
    const fetchFn = vi.fn().mockResolvedValue("data");

    const { result } = renderHook(() => useAsyncData({ fetchFn }));

    act(() => {
      result.current.setData("manual data");
      result.current.setError("manual error");
    });

    expect(result.current.data).toBe("manual data");
    expect(result.current.error).toBe("manual error");
  });
});
