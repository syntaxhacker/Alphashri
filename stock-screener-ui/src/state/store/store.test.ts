import { beforeEach, describe, expect, test } from "vitest";
import { store, type RootState } from "./index";
import { setCurrentView } from "./appSlice";
import { addNotification, removeNotification, clearAllNotifications } from "./notificationsSlice";

/**
 * `store` is a facade over two Solid stores, not a redux store: there is no
 * `getState`/`dispatch`. The slice mutators write the live stores.
 */
describe("store index", () => {
  beforeEach(() => {
    clearAllNotifications();
    setCurrentView("screener");
  });

  test("exposes both slices", () => {
    const state: RootState = { app: store.app, notifications: store.notifications };
    expect(state.app.currentView).toBe("screener");
    expect(state.notifications.items).toEqual([]);
  });

  test("app mutations are visible through the facade", () => {
    setCurrentView("backtest");
    expect(store.app.currentView).toBe("backtest");
  });

  test("notification mutations are visible through the facade", () => {
    addNotification({ type: "error", message: "Test error" });
    expect(store.notifications.items).toHaveLength(1);

    removeNotification(store.notifications.items[0].id);
    expect(store.notifications.items).toHaveLength(0);
  });

  test("clearAllNotifications works", () => {
    addNotification({ type: "info", message: "A" });
    addNotification({ type: "info", message: "B" });
    expect(store.notifications.items).toHaveLength(2);

    clearAllNotifications();
    expect(store.notifications.items).toHaveLength(0);
  });
});