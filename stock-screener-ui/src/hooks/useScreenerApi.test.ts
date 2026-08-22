// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const mockExecute = vi.fn();
const mockAbort = vi.fn();
const mockState = {
  data: null as any,
  error: null,
  isLoading: false,
  isAborted: false,
  execute: mockExecute,
  abort: mockAbort,
} as any;

vi.mock("./useApi", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    useApi: vi.fn(() => mockState),
  };
});

import { useScreenerApi, useScreenerPreview } from "./useScreenerApi";
import { useApi } from "./useApi";

const mockedUseApi = vi.mocked(useApi);

beforeEach(() => {
  vi.clearAllMocks();
  mockedUseApi.mockReturnValue({ ...mockState });
});

describe("useScreenerApi", () => {
  it("builds URL with screener, provider, mode, filters", () => {
    renderHook(() => useScreenerApi({ screener: "builtin:top_gainers", provider: "upstox", mode: "intraday", filters: { min_price: 100, empty: "" } }));
    const opts = mockedUseApi.mock.calls[0][0] as any;
    const url = typeof opts.url === "string" ? opts.url : opts.url();
    expect(url).toContain("/api/screener?");
    expect(url).toContain("screener=builtin%3Atop_gainers");
    expect(url).toContain("provider=upstox");
    expect(url).toContain("mode=intraday");
    expect(url).toContain("min_price=100");
    expect(url).not.toContain("empty=");
  });

  it("uses defaults when provider/mode omitted", () => {
    renderHook(() => useScreenerApi({ screener: "builtin:52w_high" }));
    const opts = mockedUseApi.mock.calls[0][0] as any;
    const url: string = typeof opts.url === "string" ? opts.url : opts.url();
    expect(url).toContain("provider=upstox");
    expect(url).toContain("mode=intraday");
  });

  it("passes immediate false and returns state", () => {
    const { result } = renderHook(() => useScreenerApi({ screener: "builtin:test" }));
    expect(mockedUseApi).toHaveBeenCalledWith(expect.objectContaining({ immediate: false }));
    expect(result.current).toStrictEqual(mockState);
  });

  it("omits undefined filter values", () => {
    renderHook(() => useScreenerApi({ screener: "s", filters: { a: undefined, b: null as any, c: "ok" } }));
    const url = (mockedUseApi.mock.calls[0][0] as any).url as string;
    expect(url).toContain("c=ok");
    expect(url).not.toContain("a=");
    expect(url).not.toContain("b=");
  });
});

describe("useScreenerPreview", () => {
  it("builds preview URL stripping builtin: prefix and joining columns", () => {
    renderHook(() => useScreenerPreview("builtin:top_gainers", ["price", "volume"], []));
    const opts = mockedUseApi.mock.calls[mockedUseApi.mock.calls.length - 1][0] as any;
    const url = opts.url();
    expect(url).toContain("screener=top_gainers");
    expect(url).toContain("columns=price%2Cvolume");
    expect(url).not.toContain("builtin%3A");
  });

  it("adds filter defaults to URL", () => {
    const filters = [{ key: "min_price", default: 50 }, { key: "empty", default: undefined }];
    renderHook(() => useScreenerPreview("builtin:x", undefined, filters as any));
    const opts = mockedUseApi.mock.calls[mockedUseApi.mock.calls.length - 1][0] as any;
    const url = opts.url();
    expect(url).toContain("min_price=50");
    expect(url).not.toContain("empty=");
  });

  it("returns stocks, loading, error, refresh, abort", () => {
    mockedUseApi.mockReturnValue({ data: { approaching: [{ symbol: "INFY" }], touched: [] }, isLoading: true, error: new Error("oops"), execute: mockExecute, abort: mockAbort } as any);
    const { result } = renderHook(() => useScreenerPreview("builtin:top_gainers"));
    // After effect, stocks derived from data
    expect(result.current.stocks).toEqual([{ symbol: "INFY" }]);
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.refresh).toBe(mockExecute);
    expect(result.current.abort).toBe(mockAbort);
  });

  it("handles abort signal propagation", () => {
    const { result } = renderHook(() => useScreenerPreview("builtin:test"));
    act(() => {
      result.current.abort();
    });
    expect(mockAbort).toHaveBeenCalled();
  });

  it("handles 401 error from useApi without crashing", () => {
    mockedUseApi.mockReturnValue({ data: null, isLoading: false, error: new Error("API 401: Unauthorized"), execute: mockExecute, abort: mockAbort } as any);
    const { result } = renderHook(() => useScreenerPreview("builtin:test"));
    expect(result.current.error?.message).toContain("401");
    expect(result.current.stocks).toEqual([]);
  });
});
