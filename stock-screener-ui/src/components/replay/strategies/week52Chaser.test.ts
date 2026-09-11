import { describe, expect, test } from "vitest";
import { getStrategy, listStrategies } from "./registry";
import "./index"; // importing the entrypoint registers built-in plugins

describe("week52-chaser plugin", () => {
  test("getStrategy resolves the built-in week52-chaser plugin", () => {
    const plugin = getStrategy("week52-chaser");
    expect(plugin).toBeDefined();
    expect(plugin!.id).toBe("week52-chaser");
    expect(plugin!.label).toBe("52W High Chaser");
    expect(plugin!.mode).toBe("review");
    expect(plugin!.endpoint).toBe("/api/poc/replay/week52-chaser");
    expect(typeof plugin!.normalize).toBe("function");
  });

  test("normalize maps json.bars and json.trades", () => {
    const plugin = getStrategy("week52-chaser")!;
    const bars = [{ time: 1, open: 1, high: 2, low: 0.5, close: 1.5 }];
    const trades = [{ time: 1, exit_time: 2 }];
    const bundle = plugin.normalize({ bars, trades, error: "boom" });
    expect(bundle.bars).toBe(bars);
    expect(bundle.trades).toBe(trades);
    expect(bundle.error).toBe("boom");
  });

  test("normalize defaults missing arrays and tolerates empty json", () => {
    const plugin = getStrategy("week52-chaser")!;
    expect(plugin.normalize({}).bars).toEqual([]);
    expect(plugin.normalize({}).trades).toEqual([]);
    expect(plugin.normalize(null).bars).toEqual([]);
    expect(plugin.normalize(null).trades).toEqual([]);
  });

  test("listStrategies includes vwap-orb, smc-ifvg and week52-chaser", () => {
    expect(listStrategies().map(s => s.id)).toEqual(
      expect.arrayContaining(["vwap-orb", "smc-ifvg", "week52-chaser"]),
    );
  });

  test("params are well-formed specs", () => {
    const plugin = getStrategy("week52-chaser")!;
    expect(plugin.params.length).toBeGreaterThan(0);
    const names = plugin.params.map(p => p.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "symbol", "lookback_days", "sl_pct", "tp_pct", "entry_threshold_pct",
        "min_breakout_pct", "max_holding_days", "enable_trailing_stop", "trailing_stop_pct",
      ]),
    );
    for (const p of plugin.params) {
      expect(typeof p.name).toBe("string");
      expect(p.name.length).toBeGreaterThan(0);
      expect(typeof p.label).toBe("string");
      expect(["int", "float", "bool", "select", "text", "symbol"]).toContain(p.type);
      expect(p.default).toBeDefined();
    }
  });

  test("card sets multi-day fit padding with defaults", () => {
    const plugin = getStrategy("week52-chaser")!;
    expect(plugin.card?.fitPaddingBeforeMin).toBe(4320);
    expect(plugin.card?.fitPaddingAfterMin).toBe(4320);
  });
});
