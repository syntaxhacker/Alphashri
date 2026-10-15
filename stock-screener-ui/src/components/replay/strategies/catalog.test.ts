import { describe, expect, test } from "vitest";
import { getStrategy, listStrategies } from "./registry";
import "./index"; // importing the entrypoint registers built-in plugins

// Equity plugins converted to progressive timeline replay with an explicit Run.
const TIMELINE_MANUAL = [
  "orb",
  "sr-breakout",
  "ema-cross",
  "52w-target",
  "blind-52w",
  "short-52w-failed",
  "adx-trend",
  "volume-surge",
];
const INTRADAY_EQUITY = ["orb", "sr-breakout", "ema-cross"];
const REVIEW_AUTO = ["smc", "smc-chop"];
const ADDED = [...TIMELINE_MANUAL, ...REVIEW_AUTO];
// Actual registry order (matches REPLAY_STRATEGY_SPECS declaration order).
const ALL = [
  "vwap-orb",
  "smc-ifvg",
  "week52-chaser",
  "orb",
  "sr-breakout",
  "ema-cross",
  "smc",
  "52w-target",
  "blind-52w",
  "short-52w-failed",
  "adx-trend",
  "volume-surge",
  "smc-chop",
];

describe("replay strategy catalog", () => {
  test("all 13 ids resolve via getStrategy", () => {
    for (const id of ALL) {
      const plugin = getStrategy(id);
      expect(plugin, `getStrategy(${id})`).toBeDefined();
      expect(plugin!.id).toBe(id);
    }
  });

  test("listStrategies returns all 13 in stable registration order", () => {
    expect(listStrategies()).toHaveLength(13);
    expect(listStrategies().map(s => s.id)).toEqual(ALL);
  });

  for (const id of ADDED) {
    test(`${id} is a well-formed plugin`, () => {
      const plugin = getStrategy(id)!;
      expect(plugin.endpoint).toBe(`/api/poc/replay/${id}`);
      expect(Array.isArray(plugin.dates)).toBe(true);
      expect(plugin.dates.length).toBeGreaterThan(0);
      expect(plugin.params.length).toBeGreaterThan(0);

      for (const spec of plugin.params) {
        expect(typeof spec.name).toBe("string");
        expect(spec.name.length).toBeGreaterThan(0);
        expect(typeof spec.label).toBe("string");
        expect(spec.label.length).toBeGreaterThan(0);
        expect(["int", "float", "bool", "select", "text", "symbol"]).toContain(spec.type);
        expect(spec.default).toBeDefined();
        if (spec.options) {
          expect(Array.isArray(spec.options)).toBe(true);
          expect(spec.options.length).toBeGreaterThan(0);
        }
      }
    });
  }

  for (const id of TIMELINE_MANUAL) {
    test(`${id} is a timeline/manual equity plugin with a symbol + timeline`, () => {
      const plugin = getStrategy(id)!;
      expect(plugin.mode).toBe("timeline");
      expect(plugin.runMode).toBe("manual");
      expect(plugin.timeline).toBeDefined();
      const symbol = plugin.params.find(p => p.name === "symbol");
      expect(symbol, `${id} symbol param`).toBeDefined();
      expect(symbol!.type).toBe("symbol");

      const bars = [{ time: 1, open: 1, high: 2, low: 0.5, close: 1.5 }];
      const tl = plugin.timeline!({ bars });
      expect(tl.candles).toBe(bars);
      expect(tl.subs).toEqual([]);
      expect(tl.vwap).toEqual([]);
      expect(tl.levels).toEqual({ or_high: 0, or_low: 0, or_end: 0 });
      expect(tl.barSeconds).toBe(INTRADAY_EQUITY.includes(id) ? 60 : 86400);
    });
  }

  for (const id of REVIEW_AUTO) {
    test(`${id} stays a review/auto plugin`, () => {
      const plugin = getStrategy(id)!;
      expect(plugin.mode).toBe("review");
      expect(plugin.runMode).toBe("auto");
      expect(plugin.timeline).toBeUndefined();
    });
  }

  test("vwap-orb stays timeline/auto with no runMode override", () => {
    const plugin = getStrategy("vwap-orb")!;
    expect(plugin.mode).toBe("timeline");
    expect(plugin.runMode ?? "auto").toBe("auto");
  });

  test("smc-ifvg stays review/auto", () => {
    const plugin = getStrategy("smc-ifvg")!;
    expect(plugin.mode).toBe("review");
    expect(plugin.runMode ?? "auto").toBe("auto");
    expect(plugin.timeline).toBeUndefined();
  });

  test("normalize maps bars/trades/error through for every added plugin", () => {
    const bars = [{ time: 1, open: 1, high: 2, low: 0.5, close: 1.5 }];
    const trades = [{ time: 1, exit_time: 2 }];
    for (const id of ADDED) {
      const plugin = getStrategy(id)!;
      const bundle = plugin.normalize({ bars, trades, error: "boom" });
      expect(bundle.bars).toBe(bars);
      expect(bundle.trades).toBe(trades);
      expect(bundle.error).toBe("boom");
      expect(plugin.normalize({}).bars).toEqual([]);
      expect(plugin.normalize({}).trades).toEqual([]);
      expect(plugin.normalize(null).bars).toEqual([]);
      expect(plugin.normalize(null).trades).toEqual([]);
    }
  });
});
