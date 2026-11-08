import { describe, expect, test } from "vitest";
import {
  EMACrossValidationStrategy,
  ORBValidationStrategy,
  SRBreakoutValidationStrategy,
  SwingValidationStrategy,
  ValidationStrategyRegistry,
} from "./ParamValidationStrategy";

describe("ORBValidationStrategy", () => {
  test("accepts a valid config", () => {
    const result = new ORBValidationStrategy().validate({
      or_minutes: 15,
      min_or_range_pct: 0.5,
      max_or_range_pct: 3,
      sl_pct: 1,
      tp_pct: 1.5,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  test("rejects min >= max and missing/out-of-range fields", () => {
    const result = new ORBValidationStrategy().validate({
      or_minutes: 0,
      min_or_range_pct: 3,
      max_or_range_pct: 3,
      sl_pct: 0.05,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("ORB window (min) must be between 1 and 60");
    expect(result.errors).toContain("Min OR range % must be less than Max OR range %");
    expect(result.errors).toContain("Stop-loss % must be between 0.1 and 10");
    expect(result.errors).toContain("Take-profit % is required");
  });
});

describe("EMACrossValidationStrategy", () => {
  test("accepts a valid config", () => {
    const result = new EMACrossValidationStrategy().validate({
      ema_fast_period: 9,
      ema_slow_period: 21,
      sl_pct: 1,
      tp_pct: 1.5,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test("rejects fast >= slow", () => {
    const result = new EMACrossValidationStrategy().validate({
      ema_fast_period: 21,
      ema_slow_period: 21,
      sl_pct: 1,
      tp_pct: 1.5,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Fast EMA period must be less than Slow EMA period");
  });
});

describe("SRBreakoutValidationStrategy", () => {
  test("accepts a valid config with a known pivot type", () => {
    const result = new SRBreakoutValidationStrategy().validate({
      pivot_type: "classic",
      breakout_buffer_pct: 0.5,
      sl_pct: 1,
      tp_pct: 1.5,
    });
    expect(result.valid).toBe(true);
  });

  test("rejects an unknown pivot type", () => {
    const result = new SRBreakoutValidationStrategy().validate({
      pivot_type: "woodie",
      breakout_buffer_pct: 0.5,
      sl_pct: 1,
      tp_pct: 1.5,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Pivot type must be one of: classic, fibonacci, camarilla");
  });
});

describe("SwingValidationStrategy", () => {
  test("accepts a valid config", () => {
    const result = new SwingValidationStrategy().validate({
      entry_threshold_pct: 2,
      trailing_stop_pct: 2,
      max_holding_days: 15,
      cooldown_days: 7,
    });
    expect(result.valid).toBe(true);
  });

  test("flags missing fields as required", () => {
    const result = new SwingValidationStrategy().validate({});
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Entry threshold % is required");
    expect(result.errors).toContain("Cooldown days is required");
  });
});

describe("ValidationStrategyRegistry", () => {
  test("delegates to the registered strategy", () => {
    const registry = ValidationStrategyRegistry.getInstance();
    const result = registry.validate("ORB", {
      or_minutes: 15,
      min_or_range_pct: 0.5,
      max_or_range_pct: 3,
      sl_pct: 1,
      tp_pct: 1.5,
    });
    expect(result.valid).toBe(true);
  });

  test("throws for an unregistered type", () => {
    const registry = ValidationStrategyRegistry.getInstance();
    expect(() => registry.get("UNKNOWN")).toThrow(
      'No validation strategy registered for type "UNKNOWN"',
    );
  });

  test("52W_CHASER and 52W_TARGET share the swing rules", () => {
    const registry = ValidationStrategyRegistry.getInstance();
    const config = {
      entry_threshold_pct: 2,
      trailing_stop_pct: 2,
      max_holding_days: 15,
      cooldown_days: 7,
    };
    expect(registry.validate("52W_CHASER", config).valid).toBe(true);
    expect(registry.validate("52W_TARGET", config).valid).toBe(true);
  });
});
