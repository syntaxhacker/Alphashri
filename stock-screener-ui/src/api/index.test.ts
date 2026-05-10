import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../state", () => ({
  setIsLoading: vi.fn(),
  setError: vi.fn(),
  setData: vi.fn(),
  setActiveScreener: vi.fn(),
  setActiveProvider: vi.fn(),
  setActiveMode: vi.fn(),
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
import {
  fetchData,
  resetLoadingState,
  detectAutoRefreshChanges,
  setRenderCallback,
  loadScreeners,
  setupAutoRefresh,
} from "./index";
import { getBacktestState } from "../state/backtest";
import * as state from "../state";
import { isAbortError } from "../hooks/useFetch";
import { detectAddedSymbols } from "../utils/runtime_utils";
import { pushNotification, markNewSymbols } from "../utils/notifications";

const mockedFetch = vi.mocked(fetchWithAuth);
const mockedIsAbortError = vi.mocked(isAbortError);

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
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

  it("uses param screener value not stripped response value for activeScreener", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ screener: "trending" }),
    } as Response);

    await fetchData("upstox", "intraday", "builtin:trending", "manual");

    expect(state.setActiveScreener).toHaveBeenCalledWith("builtin:trending");
    expect(state.setActiveScreener).not.toHaveBeenCalledWith("trending");
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

describe("fetchData with profile filters", () => {
  it("appends profile filter params to URL", async () => {
    (state as any).profileFilters = { min_price: 100, max_price: 500 };
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ screener: "trending" }),
    } as Response);

    await fetchData("upstox", "intraday", "trending", "manual");

    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("min_price=100");
    expect(calledUrl).toContain("max_price=500");
  });

  it("clears data only on manual screener switch", async () => {
    (state as any).data = { screener: "52w-high", symbols: ["OLD"] };
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ screener: "trending", symbols: ["NEW"] }),
    } as Response);

    await fetchData("upstox", "intraday", "trending", "manual");

    expect(state.setData).toHaveBeenCalledWith({ screener: null, symbols: [] });
  });

  it("does not clear data on auto-refresh", async () => {
    (state as any).data = { screener: "trending", symbols: ["EXISTING"] };
    (state as any).DEFAULT_SCREENER_DATA = { screener: null, symbols: [] };
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ screener: "trending", symbols: ["NEW"] }),
    } as Response);

    await fetchData("upstox", "intraday", "trending", "auto");

    expect(state.setData).not.toHaveBeenCalledWith({ screener: null, symbols: [] });
  });
});

describe("loadScreeners", () => {
  it("fetches screener options and meta", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        screeners: [{ id: "custom", label: "Custom" }],
        meta_by_id: { CUSTOM: { name: "Custom" } },
        default: "custom",
      }),
    } as Response);

    await loadScreeners(true);

    expect(state.setScreenerOptions).toHaveBeenCalledWith([{ id: "custom", label: "Custom" }]);
    expect(state.setProfileMetaById).toHaveBeenCalledWith({ CUSTOM: { name: "Custom" } });
  });

  it("resets active screener when resetActive=true", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        screeners: [],
        meta_by_id: {},
        default: "high_momentum",
      }),
    } as Response);

    await loadScreeners(true);

    expect(state.setActiveScreener).toHaveBeenCalledWith("high_momentum");
    expect(state.setActiveProvider).toHaveBeenCalledWith("upstox");
    expect(state.setActiveMode).toHaveBeenCalledWith("intraday");
  });

  it("falls back to DEFAULT_SCREENER_OPTIONS on error", async () => {
    mockedFetch.mockRejectedValue(new Error("Network error"));

    await loadScreeners(true);

    expect(state.setScreenerOptions).toHaveBeenCalled();
    expect(state.setActiveScreener).toHaveBeenCalledWith("trending");
  });
});

describe("setupAutoRefresh", () => {
  beforeEach(() => {
    (state as any).autoRefreshInterval = null;
    (state as any).autoRefreshSeconds = 30;
  });

  it("clears existing interval", () => {
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    const existingInterval = setInterval(() => {}, 1000);
    (state as any).autoRefreshInterval = existingInterval;

    setupAutoRefresh();

    expect(clearSpy).toHaveBeenCalledWith(existingInterval);
    clearInterval(existingInterval);
    clearSpy.mockRestore();
  });

  it("does not set interval when autoRefreshSeconds <= 0", () => {
    const setSpy = vi.spyOn(globalThis, "setInterval");
    (state as any).autoRefreshSeconds = 0;

    setupAutoRefresh();

    expect(setSpy).not.toHaveBeenCalled();
    setSpy.mockRestore();
  });

  it("skips auto-refresh on backtest view", () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { location: { search: "" } });
    (state as any).autoRefreshSeconds = 10;
    (state as any).data = { screener: "trending" };
    (state as any).isLoading = false;
    vi.mocked(getBacktestState).mockReturnValue({ currentView: "backtest" });

    setupAutoRefresh();
    vi.advanceTimersByTime(15000);

    expect(mockedFetch).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("calls fetchData with auto source", () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { location: { search: "" } });
    (state as any).autoRefreshSeconds = 5;
    (state as any).data = { provider: "upstox", mode: "intraday" };
    (state as any).activeScreener = "trending";
    (state as any).isLoading = false;
    vi.mocked(getBacktestState).mockReturnValue({ currentView: "screener" });

    setupAutoRefresh();
    vi.advanceTimersByTime(6000);

    expect(mockedFetch).toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.useRealTimers();
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
