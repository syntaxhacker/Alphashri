// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import {
  configToPayload,
  payloadToUrl,
  urlToPayload,
  encodeConfig,
  decodeConfig,
  useBacktestQueryParams,
} from "./useBacktestQueryParams";
import type { BacktestConfigPayload, BacktestConfigInput } from "./useBacktestQueryParams";
import * as backtestState from "../state/backtest";

beforeEach(() => {
  backtestState.resetBacktestState();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const defaultState: BacktestConfigInput = {
  selectedStrategy: "orb",
  selectedVariation: null,
  selectedSymbols: [] as string[],
  days: 180,
  includeCosts: true,
  params: {
    or_minutes: 45,
    timeframe: "5",
    stop_loss_pct: 0.5,
    take_profit_pct: 1.5,
    trade_size: 100,
    cooldown_bars: 3,
    enable_shorts: false,
    max_positions: 5,
  },
};

describe("encodeConfig / decodeConfig", () => {
  it("round-trips a payload", () => {
    const payload: BacktestConfigPayload = {
      strategy: "52w_chaser",
      symbols: ["TCS", "RELIANCE"],
      days: 90,
      params: { entry_threshold_pct: 2.0, stop_loss_pct: 3.0 },
    };
    const encoded = encodeConfig(payload);
    const decoded = decodeConfig(encoded);
    expect(decoded).toEqual(payload);
  });

  it("returns null for invalid base64", () => {
    expect(decodeConfig("not-valid-base64!!!")).toBeNull();
  });

  it("returns null for valid base64 but invalid JSON", () => {
    expect(decodeConfig(btoa("not json"))).toBeNull();
  });

  it("round-trips empty payload", () => {
    const payload: BacktestConfigPayload = {};
    const encoded = encodeConfig(payload);
    expect(decodeConfig(encoded)).toEqual({});
  });

  it("round-trips boolean values", () => {
    const payload: BacktestConfigPayload = {
      includeCosts: false,
      params: { enable_shorts: true, enable_filters: false },
    };
    const encoded = encodeConfig(payload);
    expect(decodeConfig(encoded)).toEqual(payload);
  });
});

describe("configToPayload", () => {
  it("returns empty for all defaults", () => {
    expect(configToPayload(defaultState)).toEqual({});
  });

  it("includes strategy when it is non-default", () => {
    const srBreakoutDefaults = {
      pivot_type: "classic",
      breakout_buffer_pct: 0.1,
      stop_loss_pct: 0.5,
      take_profit_pct: 1.5,
      trade_size: 100,
      max_positions: 3,
    };
    expect(
      configToPayload({
        ...defaultState,
        selectedStrategy: "sr_breakout",
        params: srBreakoutDefaults,
      }),
    ).toEqual({ strategy: "sr_breakout" });
  });

  it("includes strategy even when default, if non-default params exist", () => {
    expect(
      configToPayload({
        ...defaultState,
        params: { ...defaultState.params, stop_loss_pct: 1.0 },
      }),
    ).toEqual({ strategy: "orb", params: { stop_loss_pct: 1.0 } });
  });

  it("includes variation", () => {
    expect(configToPayload({ ...defaultState, selectedVariation: "var-1" })).toEqual({
      variation: "var-1",
    });
  });

  it("includes symbols", () => {
    expect(configToPayload({ ...defaultState, selectedSymbols: ["TCS", "RELIANCE"] })).toEqual({
      symbols: ["TCS", "RELIANCE"],
    });
  });

  it("includes non-default days", () => {
    expect(configToPayload({ ...defaultState, days: 90 })).toEqual({ days: 90 });
  });

  it("includes costs=false", () => {
    expect(configToPayload({ ...defaultState, includeCosts: false })).toEqual({
      includeCosts: false,
    });
  });

  it("includes non-default params", () => {
    const state = {
      ...defaultState,
      params: {
        ...defaultState.params,
        stop_loss_pct: 1.0,
        take_profit_pct: 2.0,
      },
    };
    const result = configToPayload(state);
    expect(result.params).toEqual({ stop_loss_pct: 1.0, take_profit_pct: 2.0 });
  });

  it("omits default params", () => {
    const result = configToPayload(defaultState);
    expect(result).not.toHaveProperty("params");
  });

  it("combines multiple non-default fields", () => {
    const chaserDefaults = {
      entry_threshold_pct: 3.0,
      stop_loss_pct: 3.0,
      take_profit_pct: 5.0,
      enable_trailing_stop: false,
      trailing_stop_pct: 3.0,
      trailing_activation_pct: 2.0,
      max_holding_days: 30,
      cooldown_days: 30,
      trade_size: 100,
      enable_filters: false,
    };
    const state: BacktestConfigInput = {
      ...defaultState,
      selectedStrategy: "52w_chaser",
      selectedSymbols: ["TCS"],
      days: 90,
      includeCosts: false,
      params: { ...chaserDefaults, entry_threshold_pct: 2.0, trade_size: 200 },
    };
    expect(configToPayload(state)).toEqual({
      strategy: "52w_chaser",
      symbols: ["TCS"],
      days: 90,
      includeCosts: false,
      params: { entry_threshold_pct: 2.0, trade_size: 200 },
    });
  });
});

describe("payloadToUrl", () => {
  it("returns null for empty payload", () => {
    expect(payloadToUrl({})).toBeNull();
  });

  it("returns p=<compressed> for non-empty payload", () => {
    const url = payloadToUrl({ strategy: "sr_breakout" });
    expect(url).toMatch(/^p=\w+$/);
  });

  it("encodes to valid compressed payload", () => {
    const url = payloadToUrl({ strategy: "52w_chaser", days: 90 });
    const match = url?.match(/^p=(.+)$/);
    expect(match).toBeTruthy();
    const decoded = decodeConfig(match![1]);
    expect(decoded).toEqual({ strategy: "52w_chaser", days: 90 });
  });
});

describe("urlToPayload", () => {
  it("returns null when no p param", () => {
    expect(urlToPayload(new URLSearchParams(""))).toBeNull();
  });

  it("returns null when p param is missing", () => {
    expect(urlToPayload(new URLSearchParams("strategy=orb"))).toBeNull();
  });

  it("decodes a valid p param", () => {
    const encoded = encodeConfig({ strategy: "sr_breakout", days: 90 });
    const sp = new URLSearchParams(`p=${encoded}`);
    expect(urlToPayload(sp)).toEqual({ strategy: "sr_breakout", days: 90 });
  });

  it("returns null for invalid p param", () => {
    const sp = new URLSearchParams("p=invalid!!!");
    expect(urlToPayload(sp)).toBeNull();
  });
});

describe("edge cases", () => {
  it("handles missing variation gracefully in payload", () => {
    const result = configToPayload({
      ...defaultState,
      selectedVariation: null,
    });
    expect(result).not.toHaveProperty("variation");
  });

  it("includes variation when set", () => {
    const result = configToPayload({
      ...defaultState,
      selectedVariation: "var-1",
    });
    expect(result.variation).toBe("var-1");
  });

  it("handles empty symbols array", () => {
    const result = configToPayload({
      ...defaultState,
      selectedSymbols: [],
    });
    expect(result).not.toHaveProperty("symbols");
  });

  it("handles default days (180) correctly - omits from payload", () => {
    const result = configToPayload({
      ...defaultState,
      days: 180,
    });
    expect(result).not.toHaveProperty("days");
  });

  it("handles includeCosts=true (default) - omits from payload", () => {
    const result = configToPayload({
      ...defaultState,
      includeCosts: true,
    });
    expect(result).not.toHaveProperty("includeCosts");
  });
});

describe("round-trip integration", () => {
  it("configToPayload → payloadToUrl → urlToPayload matches", () => {
    const chaserDefaults = {
      entry_threshold_pct: 3.0,
      stop_loss_pct: 3.0,
      take_profit_pct: 5.0,
      enable_trailing_stop: false,
      trailing_stop_pct: 3.0,
      trailing_activation_pct: 2.0,
      max_holding_days: 30,
      cooldown_days: 30,
      trade_size: 100,
      enable_filters: false,
    };
    const state: BacktestConfigInput = {
      ...defaultState,
      selectedStrategy: "52w_chaser",
      selectedSymbols: ["TCS", "RELIANCE"],
      days: 90,
      includeCosts: false,
      params: { ...chaserDefaults, entry_threshold_pct: 2.0, trade_size: 200 },
    };

    const payload = configToPayload(state);
    const url = payloadToUrl(payload);
    const sp = new URLSearchParams(url!);
    const decoded = urlToPayload(sp);

    expect(decoded).toEqual(payload);
  });
});

describe("useBacktestQueryParams hook", () => {
  beforeEach(() => {
    backtestState.resetBacktestState();
    vi.restoreAllMocks();
    Object.defineProperty(window, "location", {
      value: new URL("http://localhost:3000/"),
      configurable: true,
      writable: true,
    });
  });

  function setUrlWithPayload(payload: BacktestConfigPayload) {
    const encoded = encodeConfig(payload);
    Object.defineProperty(window, "location", {
      value: new URL(`http://localhost:3000/?p=${encoded}`),
      configurable: true,
      writable: true,
    });
  }

  it("on mount, reads URL params and restores config", async () => {
    setUrlWithPayload({ strategy: "orb", symbols: ["TCS"] });

    backtestState.setVariations([
      { id: "v1", internal_id: 1, name: "ORB Base", strategy_type: "ORB", description: "", is_template: true, is_default: true, or_minutes: 45 },
    ]);

    renderHook(() => useBacktestQueryParams());

    await waitFor(() => {
      expect(backtestState.getState().selectedSymbols).toContain("TCS");
    });
  });

  it("restores strategy, symbols, days, includeCosts, params from URL", async () => {
    setUrlWithPayload({
      strategy: "52w_chaser",
      symbols: ["TCS", "RELIANCE"],
      days: 90,
      includeCosts: false,
      params: { entry_threshold_pct: 2.0 },
    });

    backtestState.setVariations([
      { id: "v1", internal_id: 1, name: "ORB Base", strategy_type: "orb", description: "", is_template: true, is_default: true },
    ]);

    renderHook(() => useBacktestQueryParams());

    await waitFor(() => {
      const state = backtestState.getState();
      expect(state.selectedStrategy).toBe("52w_chaser");
      expect(state.selectedSymbols).toEqual(["TCS", "RELIANCE"]);
      expect(state.days).toBe(90);
      expect(state.includeCosts).toBe(false);
      expect(state.params.entry_threshold_pct).toBe(2.0);
    });
  });

  it("restores variation when match found", async () => {
    setUrlWithPayload({ variation: "v1" });

    backtestState.setVariations([
      { id: "v1", internal_id: 1, name: "ORB Base", strategy_type: "ORB", description: "", is_template: true, is_default: true, or_minutes: 30 },
    ]);

    renderHook(() => useBacktestQueryParams());

    await waitFor(() => {
      expect(backtestState.getState().selectedVariation).toBe("v1");
    });
  });

  it("writes current config to URL on state changes", async () => {
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    renderHook(() => useBacktestQueryParams());

    await act(async () => {
      backtestState.setSelectedSymbols(["TCS"]);
    });

    await waitFor(() => {
      expect(replaceStateSpy).toHaveBeenCalled();
    });
  });

  it("does not write URL until initial sync done", async () => {
    setUrlWithPayload({ strategy: "orb" });

    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    renderHook(() => useBacktestQueryParams());

    await act(async () => {
      backtestState.setSelectedSymbols(["TCS"]);
    });

    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it("handles missing variation gracefully", async () => {
    setUrlWithPayload({ variation: "nonexistent" });

    backtestState.setVariations([
      { id: "v1", internal_id: 1, name: "ORB Base", strategy_type: "ORB", description: "", is_template: true, is_default: true },
    ]);

    renderHook(() => useBacktestQueryParams());

    await waitFor(() => {
      expect(backtestState.getState().selectedVariation).toBe("nonexistent");
    });
  });
});
