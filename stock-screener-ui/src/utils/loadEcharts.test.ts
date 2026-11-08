// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { loadEcharts } from "./loadEcharts";

vi.mock("echarts", () => ({ default: { version: "5.4.0", init: vi.fn() } }));

beforeEach(() => {
  delete (window as any).echarts;
});

afterEach(() => {
  delete (window as any).echarts;
});

describe("loadEcharts", () => {
  it("imports echarts and caches the lib on window", async () => {
    const lib = await loadEcharts();
    expect(lib).toMatchObject({ version: "5.4.0", init: expect.any(Function) });
    expect((window as any).echarts).toBe(lib);
  });

  it("returns the cached instance without re-importing", async () => {
    const first = await loadEcharts();
    const second = await loadEcharts();
    expect(second).toBe(first);
  });
});
