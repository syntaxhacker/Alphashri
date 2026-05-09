import { describe, expect, test } from "vitest";
import { store, type RootState, type AppDispatch } from "./index";
import { setCurrentView } from "./appSlice";
import { addNotification, removeNotification, clearAllNotifications } from "./notificationsSlice";

describe("store index", () => {
  test("configures store with both slices", () => {
    const state = store.getState();
    expect(state).toHaveProperty("app");
    expect(state).toHaveProperty("notifications");
    expect(state.app.currentView).toBe("screener");
    expect(state.notifications.items).toEqual([]);
  });

  test("exports RootState and AppDispatch types", () => {
    // Type-level check: these should be valid types
    const _state: RootState = store.getState();
    const _dispatch: AppDispatch = store.dispatch;
    expect(_state).toBeDefined();
    expect(_dispatch).toBeDefined();
  });

  test("dispatches app actions", () => {
    store.dispatch(setCurrentView("backtest"));
    expect(store.getState().app.currentView).toBe("backtest");
  });

  test("dispatches notification actions", () => {
    store.dispatch(addNotification({ type: "error", message: "Test error" }));
    expect(store.getState().notifications.items).toHaveLength(1);

    const id = store.getState().notifications.items[0].id;
    store.dispatch(removeNotification(id));
    expect(store.getState().notifications.items).toHaveLength(0);
  });

  test("clearAllNotifications works", () => {
    store.dispatch(addNotification({ type: "info", message: "A" }));
    store.dispatch(addNotification({ type: "info", message: "B" }));
    expect(store.getState().notifications.items).toHaveLength(2);

    store.dispatch(clearAllNotifications());
    expect(store.getState().notifications.items).toHaveLength(0);
  });
});
