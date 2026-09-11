import { describe, expect, test } from "vitest";
import { registerStrategy, getStrategy, listStrategies } from "./registry";
import "./index"; // importing the entrypoint registers built-in plugins

describe("strategy registry", () => {
  test("getStrategy resolves the built-in vwap-orb plugin", () => {
    const plugin = getStrategy("vwap-orb");
    expect(plugin).toBeDefined();
    expect(plugin!.id).toBe("vwap-orb");
    expect(plugin!.label).toBe("VWAP + ORB");
    expect(plugin!.mode).toBe("timeline");
    expect(typeof plugin!.normalize).toBe("function");
    expect(typeof plugin!.timeline).toBe("function");
  });

  test("registering a duplicate id throws", () => {
    const existing = getStrategy("vwap-orb")!;
    expect(() => registerStrategy({ ...existing })).toThrow(/duplicate/i);
  });

  test("params are well-formed specs", () => {
    const plugin = getStrategy("vwap-orb")!;
    expect(plugin.params.length).toBeGreaterThan(0);
    const names = plugin.params.map(p => p.name);
    expect(names).toEqual(expect.arrayContaining(["secs", "orb", "hist"]));
    for (const p of plugin.params) {
      expect(typeof p.name).toBe("string");
      expect(p.name.length).toBeGreaterThan(0);
      expect(typeof p.label).toBe("string");
      expect(["int", "float", "bool", "select", "text"]).toContain(p.type);
      expect(p.default).toBeDefined();
      if (p.options) {
        expect(Array.isArray(p.options)).toBe(true);
        expect(p.options.length).toBeGreaterThan(0);
      }
    }
  });

  test("listStrategies returns registered plugins", () => {
    expect(listStrategies().map(s => s.id)).toContain("vwap-orb");
  });
});
