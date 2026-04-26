import { describe, expect, it } from "vitest";
import { strategyParamKeys, getStrategyDefaults } from "./backtestDefaults";

describe("strategyParamKeys", () => {
  it("has keys for all strategies", () => {
    expect(strategyParamKeys).toHaveProperty("orb");
    expect(strategyParamKeys).toHaveProperty("sr_breakout");
    expect(strategyParamKeys).toHaveProperty("52w_chaser");
    expect(strategyParamKeys).toHaveProperty("52w_target");
    expect(strategyParamKeys).toHaveProperty("ema_cross");
  });

  it("orb keys are correct", () => {
    expect(strategyParamKeys.orb).toEqual([
      "or_minutes",
      "sl_pct",
      "tp_pct",
      "max_positions",
      "timeframe",
      "trade_size",
      "cooldown_bars",
      "enable_shorts",
    ]);
  });

  it("sr_breakout keys are correct", () => {
    expect(strategyParamKeys.sr_breakout).toEqual([
      "breakout_buffer_pct",
      "pivot_type",
      "sl_pct",
      "tp_pct",
      "max_positions",
      "trade_size",
    ]);
  });

  it("52w_chaser keys are correct", () => {
    expect(strategyParamKeys["52w_chaser"]).toEqual([
      "entry_threshold_pct",
      "sl_pct",
      "tp_pct",
      "enable_trailing_stop",
      "trailing_stop_pct",
      "trailing_activation_pct",
      "max_holding_days",
      "cooldown_days",
      "trade_size",
      "enable_filters",
    ]);
  });

  it("52w_target keys are correct", () => {
    expect(strategyParamKeys["52w_target"]).toEqual([
      "entry_threshold_pct",
      "sl_pct",
      "trailing_stop_pct",
      "max_holding_days",
      "cooldown_days",
      "trade_size",
    ]);
  });

  it("ema_cross keys are correct", () => {
    expect(strategyParamKeys.ema_cross).toEqual([
      "ema_fast_period",
      "ema_slow_period",
      "sl_pct",
      "tp_pct",
      "timeframe",
      "trade_size",
      "enable_shorts",
      "cooldown_bars",
    ]);
  });
});

describe("getStrategyDefaults", () => {
  describe("orb", () => {
    it("returns correct default values", () => {
      const defaults = getStrategyDefaults("orb");
      expect(defaults).toEqual({
        or_minutes: 45,
        timeframe: "5",
        stop_loss_pct: 0.5,
        take_profit_pct: 1.5,
        trade_size: 100,
        cooldown_bars: 3,
        enable_shorts: false,
        max_positions: 5,
      });
    });
  });

  describe("sr_breakout", () => {
    it("returns correct default values", () => {
      const defaults = getStrategyDefaults("sr_breakout");
      expect(defaults).toEqual({
        pivot_type: "classic",
        breakout_buffer_pct: 0.1,
        stop_loss_pct: 0.5,
        take_profit_pct: 1.5,
        trade_size: 100,
        max_positions: 3,
      });
    });
  });

  describe("52w_chaser", () => {
    it("returns correct default values", () => {
      const defaults = getStrategyDefaults("52w_chaser");
      expect(defaults).toEqual({
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
      });
    });
  });

  describe("52w_target", () => {
    it("returns correct default values", () => {
      const defaults = getStrategyDefaults("52w_target");
      expect(defaults).toEqual({
        entry_threshold_pct: 2.0,
        stop_loss_pct: 2.0,
        trailing_stop_pct: 0.5,
        max_holding_days: 15,
        cooldown_days: 7,
        trade_size: 100,
      });
    });
  });

  describe("ema_cross", () => {
    it("returns correct default values", () => {
      const defaults = getStrategyDefaults("ema_cross");
      expect(defaults).toEqual({
        ema_fast_period: 9,
        ema_slow_period: 21,
        stop_loss_pct: 0.5,
        take_profit_pct: 1.5,
        timeframe: "5",
        trade_size: 100,
        enable_shorts: false,
        cooldown_bars: 3,
      });
    });
  });

  it("returns empty object for unknown strategy", () => {
    const defaults = getStrategyDefaults("unknown_strategy");
    expect(defaults).toEqual({});
  });

  it("returns empty object for empty string", () => {
    const defaults = getStrategyDefaults("");
    expect(defaults).toEqual({});
  });

  it("handles case sensitivity", () => {
    // Strategy names should match exactly
    const defaults = getStrategyDefaults("ORB"); // uppercase
    expect(defaults).toEqual({});
  });

  it("all defaults contain non-zero trade_size", () => {
    expect(getStrategyDefaults("orb").trade_size).toBeGreaterThan(0);
    expect(getStrategyDefaults("sr_breakout").trade_size).toBeGreaterThan(0);
    expect(getStrategyDefaults("52w_chaser").trade_size).toBeGreaterThan(0);
    expect(getStrategyDefaults("52w_target").trade_size).toBeGreaterThan(0);
    expect(getStrategyDefaults("ema_cross").trade_size).toBeGreaterThan(0);
  });

  it("strategies with SL/TP have positive values", () => {
    expect(getStrategyDefaults("orb").stop_loss_pct).toBeGreaterThan(0);
    expect(getStrategyDefaults("orb").take_profit_pct).toBeGreaterThan(0);
    expect(getStrategyDefaults("sr_breakout").stop_loss_pct).toBeGreaterThan(0);
    expect(getStrategyDefaults("sr_breakout").take_profit_pct).toBeGreaterThan(0);
  });
});
