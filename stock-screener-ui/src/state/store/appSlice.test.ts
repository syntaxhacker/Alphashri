import { beforeEach, describe, expect, test } from "vitest";
import { createEffect, createRoot } from "solid-js";
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

  test("notifies subscribers only when the view actually changes", async () => {
    // Solid stores notify through reactivity, not a `subscribe` method: an effect
    // that reads `currentView` must not re-run when the value is unchanged.
    let reads = 0;
    const dispose = createRoot((disposeRoot) => {
      createEffect(() => {
        // Read the field so the effect subscribes to it.
        void appStore.currentView;
        reads++;
      });
      return disposeRoot;
    });
    await Promise.resolve();
    const initialReads = reads;

    setCurrentView("backtest");
    await Promise.resolve();
    const afterFirst = reads;

    setCurrentView("backtest");
    await Promise.resolve();

    expect(afterFirst).toBeGreaterThan(initialReads);
    expect(reads).toBe(afterFirst);
    dispose();
  });
});
