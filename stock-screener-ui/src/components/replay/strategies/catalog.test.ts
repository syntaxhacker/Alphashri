import { describe, expect, test } from "vitest";
import { getStrategy, listStrategies } from "./registry";
import "./index"; // importing the entrypoint registers built-in plugins

const EXISTING = ["vwap-orb", "smc-ifvg", "week52-chaser"];
const ADDED = [
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
const ALL = [...EXISTING, ...ADDED];

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
    test(`${id} is a well-formed review plugin`, () => {
      const plugin = getStrategy(id)!;
      expect(plugin.mode).toBe("review");
      expect(plugin.endpoint).toBe(`/api/poc/replay/${id}`);
      expect(Array.isArray(plugin.dates)).toBe(true);
      expect(plugin.dates.length).toBeGreaterThan(0);
      expect(plugin.params.length).toBeGreaterThan(0);

      for (const spec of plugin.params) {
        expect(typeof spec.name).toBe("string");
        expect(spec.name.length).toBeGreaterThan(0);
        expect(typeof spec.label).toBe("string");
        expect(spec.label.length).toBeGreaterThan(0);
        expect(["int", "float", "bool", "select", "text"]).toContain(spec.type);
        expect(spec.default).toBeDefined();
        if (spec.options) {
          expect(Array.isArray(spec.options)).toBe(true);
          expect(spec.options.length).toBeGreaterThan(0);
        }
      }
    });
  }

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
