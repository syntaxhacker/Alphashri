import { describe, expect, it } from "vitest";
import { getScreenerDefaults } from "./useScreenerState";
import type { ScreenerData } from "../types";

describe("getScreenerDefaults", () => {
  it("returns defaults when data is undefined", () => {
    const result = getScreenerDefaults(undefined);
    expect(result).toEqual({ provider: "upstox", mode: "intraday" });
  });

  it("returns defaults when data is null", () => {
    const result = getScreenerDefaults(null);
    expect(result).toEqual({ provider: "upstox", mode: "intraday" });
  });

  it("returns data provider and mode when present", () => {
    const data: ScreenerData = {
      approaching: [],
      touched: [],
      last_updated: "2026-03-20T10:00:00Z",
      provider: "zerodha",
      mode: "positional",
      screener: "trending",
    };
    const result = getScreenerDefaults(data);
    expect(result).toEqual({ provider: "zerodha", mode: "positional" });
  });

  it("falls back to defaults when provider is empty string", () => {
    const data: ScreenerData = {
      approaching: [],
      touched: [],
      last_updated: "",
      provider: "",
      mode: "intraday",
      screener: "trending",
    };
    const result = getScreenerDefaults(data);
    expect(result).toEqual({ provider: "upstox", mode: "intraday" });
  });

  it("falls back to defaults when mode is empty string", () => {
    const data: ScreenerData = {
      approaching: [],
      touched: [],
      last_updated: "",
      provider: "dhan",
      mode: "",
      screener: "trending",
    };
    const result = getScreenerDefaults(data);
    expect(result).toEqual({ provider: "dhan", mode: "intraday" });
  });

  it("returns upstox and intraday when both are empty", () => {
    const data: ScreenerData = {
      approaching: [],
      touched: [],
      last_updated: "",
      provider: "",
      mode: "",
      screener: "trending",
    };
    const result = getScreenerDefaults(data);
    expect(result).toEqual({ provider: "upstox", mode: "intraday" });
  });
});
