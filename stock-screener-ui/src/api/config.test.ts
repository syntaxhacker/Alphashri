import { describe, it, expect } from "vitest";
import { API_BASE, WS_BASE, API_ENDPOINTS } from "./config";

describe("config", () => {
  it("API_BASE is defined and is a non-empty string", () => {
    expect(API_BASE).toBeDefined();
    expect(typeof API_BASE).toBe("string");
    expect(API_BASE.length).toBeGreaterThan(0);
  });

  it("WS_BASE is defined and is a non-empty string", () => {
    expect(WS_BASE).toBeDefined();
    expect(typeof WS_BASE).toBe("string");
    expect(WS_BASE.length).toBeGreaterThan(0);
  });

  it("API_ENDPOINTS contains all required keys", () => {
    const requiredKeys = [
      "SCREENER",
      "BACKTEST",
      "PAPER",
      "AUTH",
      "SECTOR",
      "NEWS",
      "SYMBOLS",
      "MARKET_TICKER",
      "CHART_PREVIEW",
    ];
    requiredKeys.forEach((key) => {
      expect(API_ENDPOINTS).toHaveProperty(key);
    });
  });

  it("all API_ENDPOINTS values are non-empty strings", () => {
    Object.values(API_ENDPOINTS).forEach((endpoint) => {
      expect(typeof endpoint).toBe("string");
      expect(endpoint.length).toBeGreaterThan(0);
    });
  });

  it("all API_ENDPOINTS start with API_BASE", () => {
    Object.values(API_ENDPOINTS).forEach((endpoint) => {
      expect(endpoint.startsWith(API_BASE)).toBe(true);
    });
  });

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
