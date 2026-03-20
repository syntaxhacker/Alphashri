import { describe, expect, test } from "vitest";
import { appReducer, setCurrentView } from "./appSlice";
import type { AppRouteView } from "./appSlice";

describe("appSlice", () => {
  test("has correct initial state", () => {
    const state = appReducer(undefined, { type: "@@INIT" });
    expect(state.currentView).toBe("screener");
  });

  test("setCurrentView updates currentView", () => {
    const views: AppRouteView[] = ["screener", "backtest", "paper", "sector", "strategies", "bots"];

    for (const view of views) {
      const state = appReducer(undefined, setCurrentView(view));
      expect(state.currentView).toBe(view);
    }
  });

  test("handles unknown action by returning current state", () => {
    const initialState = appReducer(undefined, { type: "@@INIT" });
    const state = appReducer(initialState, { type: "UNKNOWN_ACTION" });
    expect(state).toBe(initialState);
    expect(state.currentView).toBe("screener");
  });

  test("preserves state through multiple transitions", () => {
    let state = appReducer(undefined, setCurrentView("backtest"));
    expect(state.currentView).toBe("backtest");

    state = appReducer(state, setCurrentView("paper"));
    expect(state.currentView).toBe("paper");

    state = appReducer(state, { type: "UNKNOWN" });
    expect(state.currentView).toBe("paper");
  });
});
