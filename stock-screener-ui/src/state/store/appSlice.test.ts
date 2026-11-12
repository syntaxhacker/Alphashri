import { beforeEach, describe, expect, test } from "vitest";
import { appStore, setCurrentView, type AppRouteView } from "./appSlice";

describe("appSlice", () => {
  beforeEach(() => {
    setCurrentView("screener");
  });

  test("defaults to the screener view", () => {
    expect(appStore.currentView).toBe("screener");
  });

  test("setCurrentView updates currentView", () => {
    const views: AppRouteView[] = ["screener", "backtest", "paper", "sector", "strategies", "bots"];

    for (const view of views) {
      setCurrentView(view);
      expect(appStore.currentView).toBe(view);
    }
  });

  test("notifies subscribers only when the view actually changes", () => {
    let reads = 0;
    const dispose = appStore.subscribe?.(() => reads++);
    setCurrentView("backtest");
    const afterFirst = reads;
    setCurrentView("backtest");
    expect(reads).toBe(afterFirst);
    dispose?.();
  });
});
