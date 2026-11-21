import { describe, it, expect } from "vitest";
import { API_BASE, API_ENDPOINTS } from "./config";

describe("config", () => {
  // NOTE: API_BASE/WS_BASE are env-derived constants; "is defined / non-empty
  // string" checks are tautological (they only prove the module loaded). The
  // exact path-suffix assertion below is the real contract.

  it("each endpoint has the correct path suffix", () => {
    expect(API_ENDPOINTS.SCREENER).toBe(`${API_BASE}/api/screener`);
    expect(API_ENDPOINTS.BACKTEST).toBe(`${API_BASE}/api/backtest`);
    expect(API_ENDPOINTS.PAPER).toBe(`${API_BASE}/api/paper`);
    expect(API_ENDPOINTS.AUTH).toBe(`${API_BASE}/api/auth`);
    expect(API_ENDPOINTS.SECTOR).toBe(`${API_BASE}/api/sector`);
    expect(API_ENDPOINTS.NEWS).toBe(`${API_BASE}/api/news`);
    expect(API_ENDPOINTS.SYMBOLS).toBe(`${API_BASE}/api/symbols`);
    expect(API_ENDPOINTS.MARKET_TICKER).toBe(`${API_BASE}/api/market-ticker`);
    expect(API_ENDPOINTS.CHART_PREVIEW).toBe(`${API_BASE}/api/chart/preview`);
  });
});
