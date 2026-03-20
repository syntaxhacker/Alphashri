import { describe, expect, test } from "vitest";
import {
  notificationsReducer,
  addNotification,
  removeNotification,
  clearAllNotifications,
} from "./notificationsSlice";

describe("notificationsSlice", () => {
  test("has empty items in initial state", () => {
    const state = notificationsReducer(undefined, { type: "@@INIT" });
    expect(state.items).toEqual([]);
  });

  test("handles unknown action by returning current state", () => {
    const state = notificationsReducer(undefined, { type: "UNKNOWN_ACTION" });
    expect(state.items).toEqual([]);
  });

  describe("addNotification", () => {
    test("adds a notification with generated id and timestamp", () => {
      const state = notificationsReducer(
        undefined,
        addNotification({ type: "success", message: "Test message" }),
      );

      expect(state.items).toHaveLength(1);
      expect(state.items[0].type).toBe("success");
      expect(state.items[0].message).toBe("Test message");
      expect(state.items[0].id).toMatch(/^notif-\d+-\w+$/);
      expect(typeof state.items[0].timestamp).toBe("number");
    });

    test("defaults duration to 5000", () => {
      const state = notificationsReducer(
        undefined,
        addNotification({ type: "info", message: "Info" }),
      );

      expect(state.items[0].duration).toBe(5000);
    });

    test("uses custom duration when provided", () => {
      const state = notificationsReducer(
        undefined,
        addNotification({ type: "warning", message: "Warning", duration: 10000 }),
      );

      expect(state.items[0].duration).toBe(10000);
    });

    test("supports all notification types", () => {
      const types = ["success", "error", "warning", "info"] as const;

      for (const type of types) {
        const state = notificationsReducer(
          undefined,
          addNotification({ type, message: `${type} message` }),
        );
        expect(state.items[0].type).toBe(type);
      }
    });

    test("adds multiple notifications", () => {
      let state = notificationsReducer(
        undefined,
        addNotification({ type: "success", message: "First" }),
      );
      state = notificationsReducer(
        state,
        addNotification({ type: "error", message: "Second" }),
      );

      expect(state.items).toHaveLength(2);
      expect(state.items[0].message).toBe("First");
      expect(state.items[1].message).toBe("Second");
    });

    test("generates unique ids for each notification", () => {
      let state = notificationsReducer(
        undefined,
        addNotification({ type: "info", message: "A" }),
      );
      state = notificationsReducer(
        state,
        addNotification({ type: "info", message: "B" }),
      );

      expect(state.items[0].id).not.toBe(state.items[1].id);
    });
  });

  describe("removeNotification", () => {
    test("removes notification by id", () => {
      let state = notificationsReducer(
        undefined,
        addNotification({ type: "info", message: "Keep" }),
      );
      state = notificationsReducer(
        state,
        addNotification({ type: "info", message: "Remove" }),
      );

      const idToRemove = state.items[1].id;
      state = notificationsReducer(state, removeNotification(idToRemove));

      expect(state.items).toHaveLength(1);
      expect(state.items[0].message).toBe("Keep");
    });

    test("does nothing when id does not exist", () => {
      let state = notificationsReducer(
        undefined,
        addNotification({ type: "info", message: "Test" }),
      );

      const prevItems = state.items;
      state = notificationsReducer(state, removeNotification("non-existent-id"));

      expect(state.items).toHaveLength(1);
      expect(state.items).toEqual(prevItems);
    });

    test("handles removing from empty state", () => {
      const state = notificationsReducer(
        undefined,
        removeNotification("some-id"),
      );

      expect(state.items).toHaveLength(0);
    });
  });

  describe("clearAllNotifications", () => {
    test("removes all notifications", () => {
      let state = notificationsReducer(
        undefined,
        addNotification({ type: "info", message: "A" }),
      );
      state = notificationsReducer(
        state,
        addNotification({ type: "error", message: "B" }),
      );
      state = notificationsReducer(
        state,
        addNotification({ type: "warning", message: "C" }),
      );

      expect(state.items).toHaveLength(3);
      state = notificationsReducer(state, clearAllNotifications());
      expect(state.items).toHaveLength(0);
    });

    test("works on already empty state", () => {
      const state = notificationsReducer(
        undefined,
        clearAllNotifications(),
      );

      expect(state.items).toHaveLength(0);
    });
  });
});
