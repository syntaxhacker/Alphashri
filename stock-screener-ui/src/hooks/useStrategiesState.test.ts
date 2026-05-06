import { describe, expect, it } from "vitest";
import { getViewLoadAction } from "./useStrategiesState";
import type { ViewLoadAction } from "./useStrategiesState";
import type { StrategyView } from "../components/strategies/types";

describe("getViewLoadAction", () => {
  it("returns loadTemplates for tree view", () => {
    const result = getViewLoadAction("tree");
    expect(result).toBe<ViewLoadAction>("loadTemplates");
  });

  it("returns loadAllPerformance for performance view", () => {
    const result = getViewLoadAction("performance");
    expect(result).toBe<ViewLoadAction>("loadAllPerformance");
  });

  it("returns null for unknown view values", () => {
    const result = getViewLoadAction("unknown" as StrategyView);
    expect(result).toBeNull();
  });

  it("returns null for empty string view", () => {
    const result = getViewLoadAction("" as StrategyView);
    expect(result).toBeNull();
  });
});
