import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../state", () => ({
  setIsLoading: vi.fn(),
  setError: vi.fn(),
  setData: vi.fn(),
  setActiveScreener: vi.fn(),
  setSortColumn: vi.fn(),
  setSortDirection: vi.fn(),
  setScreenerOptions: vi.fn(),
  setProfileMetaById: vi.fn(),
  setProfileFilters: vi.fn(),
  setAutoRefreshInterval: vi.fn(),
  autoRefreshInterval: null,
  autoRefreshSeconds: 60,
  activeScreener: "trending",
  data: null,
  isLoading: false,
  screenerOptions: [],
  profileFilters: {},
  DEFAULT_SCREENER_DATA: { screener: null, symbols: [] },
}));

vi.mock("../state/backtest", () => ({
  getBacktestState: vi.fn(() => ({ currentView: "screener" })),
}));

vi.mock("../hooks/useFetch", () => ({
  abortPendingRequest: vi.fn(() => new AbortController()),
  isAbortError: vi.fn((e: unknown) => e instanceof DOMException && e.name === "AbortError"),
}));

vi.mock("../utils/runtime_utils", () => ({
  detectAddedSymbols: vi.fn(() => ({ addedPrimary: [], addedSecondary: [] })),
}));

vi.mock("../utils/notifications", () => ({
  pushNotification: vi.fn(),
  markNewSymbols: vi.fn(),
}));

vi.mock("../state/auth", () => ({
  fetchWithAuth: vi.fn(),
}));

import { fetchWithAuth } from "../state/auth";
import { fetchData, resetLoadingState, detectAutoRefreshChanges, setRenderCallback } from "./index";
import * as state from "../state";
import { isAbortError } from "../hooks/useFetch";
import { detectAddedSymbols } from "../utils/runtime_utils";
import { pushNotification, markNewSymbols } from "../utils/notifications";

const mockedFetch = vi.mocked(fetchWithAuth);
const mockedIsAbortError = vi.mocked(isAbortError);

beforeEach(() => {
  vi.clearAllMocks();
  setRenderCallback(() => {});
});

describe("fetchData", () => {
  it("builds URL with provider, mode, screener params", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ screener: "trending", symbols: [] }),
    } as Response);

    await fetchData("upstox", "intraday", "trending", "manual");

    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("provider=upstox");
    expect(calledUrl).toContain("mode=intraday");
    expect(calledUrl).toContain("screener=trending");
  });

  it("sets loading true and then false on success", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ screener: "trending", symbols: [] }),
    } as Response);

    await fetchData();

    expect(state.setIsLoading).toHaveBeenCalledWith(true);
    expect(state.setIsLoading).toHaveBeenLastCalledWith(false);
  });

  it("clears error before fetching", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ screener: "trending" }),
    } as Response);

    await fetchData();

    expect(state.setError).toHaveBeenCalledWith(null);
  });

  it("sets error on non-ok response", async () => {
    mockedFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    } as Response);

    await fetchData();

    expect(state.setError).toHaveBeenCalledWith("HTTP 500");
    expect(state.setIsLoading).toHaveBeenLastCalledWith(false);
  });

  it("sets error with message on thrown Error", async () => {
    mockedFetch.mockRejectedValue(new Error("Custom error"));

    await fetchData();

    expect(state.setError).toHaveBeenCalledWith("Custom error");
  });

  it("sets generic error on non-Error thrown", async () => {
    mockedFetch.mockRejectedValue("string error");

    await fetchData();

    expect(state.setError).toHaveBeenCalledWith("Failed to fetch");
  });

  it("does not set error when request is aborted", async () => {
    const abortError = new DOMException("The user aborted a request.", "AbortError");
    mockedFetch.mockRejectedValue(abortError);
    mockedIsAbortError.mockReturnValue(true);

    await fetchData();

    expect(state.setError).not.toHaveBeenCalledWith(expect.anything());
  });

  it("does not reset loading when request is aborted", async () => {
    const abortError = new DOMException("The user aborted a request.", "AbortError");
    mockedFetch.mockRejectedValue(abortError);
    mockedIsAbortError.mockReturnValue(true);

    await fetchData();

    expect(state.setIsLoading).toHaveBeenCalledWith(true);
    expect(state.setIsLoading).toHaveBeenCalledTimes(1);
  });

  it("calls renderCallback", async () => {
    const renderCb = vi.fn();
    setRenderCallback(renderCb);
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ screener: "trending" }),
    } as Response);

    await fetchData();

    expect(renderCb).toHaveBeenCalled();
  });

  it("applies default_sort from profile_meta when present", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        screener: "trending",
        profile_meta: { default_sort: { column: "change_pct", direction: "asc" } },
      }),
    } as Response);

    await fetchData();

    expect(state.setSortColumn).toHaveBeenCalledWith("change_pct");
    expect(state.setSortDirection).toHaveBeenCalledWith("asc");
  });

  it("does not call sort setters when no default_sort", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ screener: "trending" }),
    } as Response);

    await fetchData();

    expect(state.setSortColumn).not.toHaveBeenCalled();
    expect(state.setSortDirection).not.toHaveBeenCalled();
  });
});

describe("resetLoadingState", () => {
  it("sets loading to false and calls renderCallback", () => {
    const renderCb = vi.fn();
    setRenderCallback(renderCb);

    resetLoadingState();

    expect(state.setIsLoading).toHaveBeenCalledWith(false);
    expect(renderCb).toHaveBeenCalled();
  });
});

describe("detectAutoRefreshChanges", () => {
  it("does nothing when no symbols are added", () => {
    vi.mocked(detectAddedSymbols).mockReturnValue({ addedPrimary: [], addedSecondary: [] });

    detectAutoRefreshChanges(null, null);

    expect(pushNotification).not.toHaveBeenCalled();
  });

  it("detects primary and secondary added symbols", () => {
    vi.mocked(detectAddedSymbols).mockReturnValue({
      addedPrimary: ["TATASTEEL", "INFY"],
      addedSecondary: ["WIPRO"],
    });

    (state as any).screenerOptions = [{ id: "trending", label: "Trending" }];

    detectAutoRefreshChanges(null, { screener: "trending" } as any);

    expect(markNewSymbols).toHaveBeenCalled();
    expect(pushNotification).toHaveBeenCalled();
  });
});
