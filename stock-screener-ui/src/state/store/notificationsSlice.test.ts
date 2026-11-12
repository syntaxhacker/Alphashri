import { beforeEach, describe, expect, test } from "vitest";
import {
  notificationsStore,
  addNotification,
  removeNotification,
  clearAllNotifications,
} from "./notificationsSlice";

/**
 * The store is a Solid `createStore`, not a reducer: the mutators write it in
 * place, so these tests assert on the live store and reset between cases.
 */
describe("notificationsSlice", () => {
  beforeEach(() => {
    clearAllNotifications();
  });

  test("starts with empty items", () => {
    expect(notificationsStore.items).toEqual([]);
  });

  describe("addNotification", () => {
    test("adds a notification with generated id and timestamp", () => {
      addNotification({ type: "success", message: "Test message" });

      expect(notificationsStore.items).toHaveLength(1);
      expect(notificationsStore.items[0].type).toBe("success");
      expect(notificationsStore.items[0].message).toBe("Test message");
      expect(notificationsStore.items[0].id).toMatch(/^notif-\d+-\w+$/);
      expect(typeof notificationsStore.items[0].timestamp).toBe("number");
    });

    test("defaults duration to 5000", () => {
      addNotification({ type: "info", message: "Info" });
      expect(notificationsStore.items[0].duration).toBe(5000);
    });

    test("uses custom duration when provided", () => {
      addNotification({ type: "warning", message: "Warning", duration: 10000 });
      expect(notificationsStore.items[0].duration).toBe(10000);
    });

    test("supports all notification types", () => {
      const types = ["success", "error", "warning", "info"] as const;

      for (const type of types) {
        addNotification({ type, message: `${type} message` });
      }

      expect(notificationsStore.items.map((n) => n.type)).toEqual([...types]);
    });

    test("adds multiple notifications in order", () => {
      addNotification({ type: "success", message: "First" });
      addNotification({ type: "error", message: "Second" });

      expect(notificationsStore.items).toHaveLength(2);
      expect(notificationsStore.items[0].message).toBe("First");
      expect(notificationsStore.items[1].message).toBe("Second");
    });

    test("generates unique ids for each notification", () => {
      addNotification({ type: "info", message: "A" });
      addNotification({ type: "info", message: "B" });

      expect(notificationsStore.items[0].id).not.toBe(notificationsStore.items[1].id);
    });
  });

  describe("removeNotification", () => {
    test("removes notification by id", () => {
      addNotification({ type: "info", message: "Keep" });
      addNotification({ type: "info", message: "Remove" });

      removeNotification(notificationsStore.items[1].id);

      expect(notificationsStore.items).toHaveLength(1);
      expect(notificationsStore.items[0].message).toBe("Keep");
    });

    test("does nothing when id does not exist", () => {
      addNotification({ type: "info", message: "Test" });

      removeNotification("non-existent-id");

      expect(notificationsStore.items).toHaveLength(1);
      expect(notificationsStore.items[0].message).toBe("Test");
    });

    test("handles removing from empty state", () => {
      removeNotification("some-id");
      expect(notificationsStore.items).toHaveLength(0);
    });
  });

  describe("clearAllNotifications", () => {
    test("removes all notifications", () => {
      addNotification({ type: "info", message: "A" });
      addNotification({ type: "error", message: "B" });
      addNotification({ type: "warning", message: "C" });

      expect(notificationsStore.items).toHaveLength(3);
      clearAllNotifications();
      expect(notificationsStore.items).toHaveLength(0);
    });

    test("works on already empty state", () => {
      clearAllNotifications();
      expect(notificationsStore.items).toHaveLength(0);
    });
  });
});