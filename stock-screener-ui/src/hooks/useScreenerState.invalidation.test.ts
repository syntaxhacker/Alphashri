// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useScreenerState } from "./useScreenerState";
import * as state from "../state";
import { renderSolidHook } from "../test-utils/solidRenderHook";

vi.mock("../api", () => ({
  fetchData: vi.fn(),
  loadScreeners: vi.fn(() => Promise.resolve()),
  setupAutoRefresh: vi.fn(),
}));
vi.mock("@solidjs/router", () => ({
  useNavigate: vi.fn(() => vi.fn()),
  useSearchParams: vi.fn(() => [new URLSearchParams(), vi.fn()]),
}));

// NOTE: `../state` and `./useStoreSubscription` are NOT mocked here — the
// store's subscribe/notify must drive memo invalidation end to end. If the
// derived memos do not read the subscription version, they stay pinned to the
// first payload forever.

const base = { ...state.DEFAULT_SCREENER_DATA };

describe("useScreenerState store invalidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.setData({ ...base });
    state.setScreenerOptions([{ id: "trending", label: "Trending" }]);
    state.setActiveScreener("52w_high");
    state.setIsLoading(false);
    state.setError(null);
    state.setProfileMetaById({});
    state.setProfileFilters({});
  });

  afterEach(() => {
    vi.clearAllMocks();
    state.setData({ ...base });
    state.setScreenerOptions([]);
    state.setActiveScreener("52w_high");
    state.setIsLoading(false);
    state.setError(null);
    state.setProfileMetaById({});
    state.setProfileFilters({});
  });

  it("recomputes approachingStocks when the store publishes new data", () => {
    const { result } = renderSolidHook(() => useScreenerState());

    expect(result.current.approachingStocks).toEqual([]);

    state.setData({ ...base, approaching: [{ symbol: "RELIANCE" }] });
    expect(result.current.approachingStocks).toEqual([{ symbol: "RELIANCE" }]);
  });

  it("recomputes touchedStocks when the store publishes new data", () => {
    const { result } = renderSolidHook(() => useScreenerState());

    expect(result.current.touchedStocks).toEqual([]);

    state.setData({ ...base, touched: [{ symbol: "INFY", touched_52w: true }] });
    expect(result.current.touchedStocks).toEqual([{ symbol: "INFY", touched_52w: true }]);
  });
});
