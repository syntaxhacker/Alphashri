import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import * as state from "../state";
import {
  pushNotification,
  markNewSymbols,
  isRecentlyAdded,
  setRenderCallback,
} from "./notifications";

beforeEach(() => {
  state.clearNotifications();
  state.setRecentAddedSymbols({});
  vi.useFakeTimers();
  setRenderCallback(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});

describe("pushNotification", () => {
  test("creates a notification with correct fields", () => {
    pushNotification("Test Title", "Test Detail", "primary");
    expect(state.notifications).toHaveLength(1);
    const notif = state.notifications[0];
    expect(notif.id).toBe(1);
    expect(notif.title).toBe("Test Title");
    expect(notif.detail).toBe("Test Detail");
    expect(notif.kind).toBe("primary");
    expect(notif.ts).toBeDefined();
  });

  test("increments notifSeq after each call", () => {
    pushNotification("A", "B", "primary");
    pushNotification("C", "D", "secondary");
    expect(state.notifSeq).toBe(3);
    expect(state.notifications[0].id).toBe(2);
    expect(state.notifications[1].id).toBe(1);
  });

  test("prepends new notification (newest first)", () => {
    pushNotification("First", "A", "primary");
    pushNotification("Second", "B", "secondary");
    expect(state.notifications[0].title).toBe("Second");
    expect(state.notifications[1].title).toBe("First");
  });

  test("limits notifications to 50 entries", () => {
    for (let i = 0; i < 55; i++) {
      pushNotification(`Title ${i}`, `Detail ${i}`, "primary");
    }
    expect(state.notifications).toHaveLength(50);
    expect(state.notifications[0].title).toBe("Title 54");
  });

  test("supports both kind values", () => {
    pushNotification("P", "Primary", "primary");
    pushNotification("S", "Secondary", "secondary");
    expect(state.notifications[0].kind).toBe("secondary");
    expect(state.notifications[1].kind).toBe("primary");
  });
});

describe("markNewSymbols", () => {
  test("sets expiry timestamps for given symbols", () => {
    const now = Date.now();
    markNewSymbols(["RELIANCE", "TCS"]);
    expect(state.recentAddedSymbols["RELIANCE"]).toBeGreaterThan(now);
    expect(state.recentAddedSymbols["TCS"]).toBeGreaterThan(now);
  });

  test("does nothing for empty array", () => {
    state.setRecentAddedSymbols({ EXISTING: 99999 });
    markNewSymbols([]);
    expect(state.recentAddedSymbols).toEqual({ EXISTING: 99999 });
  });

  test("preserves existing recent symbols", () => {
    const now = Date.now();
    state.setRecentAddedSymbols({ EXISTING: now + 50000 });
    markNewSymbols(["NEW"]);
    expect(state.recentAddedSymbols["EXISTING"]).toBe(now + 50000);
    expect(state.recentAddedSymbols["NEW"]).toBeDefined();
  });

  test("cleans up expired symbols after timeout", () => {
    markNewSymbols(["SYMBOL1"]);
    expect(state.recentAddedSymbols["SYMBOL1"]).toBeDefined();

    vi.advanceTimersByTime(12100);
    expect(state.recentAddedSymbols["SYMBOL1"]).toBeUndefined();
  });
});

describe("isRecentlyAdded", () => {
  test("returns false for unknown symbol", () => {
    expect(isRecentlyAdded("UNKNOWN")).toBe(false);
  });

  test("returns true for symbol with future expiry", () => {
    state.setRecentAddedSymbols({ RELIANCE: Date.now() + 60000 });
    expect(isRecentlyAdded("RELIANCE")).toBe(true);
  });

  test("returns false and cleans up expired symbol", () => {
    state.setRecentAddedSymbols({ EXPIRED: Date.now() - 1000 });
    expect(isRecentlyAdded("EXPIRED")).toBe(false);
    expect(state.recentAddedSymbols["EXPIRED"]).toBeUndefined();
  });

  test("does not remove non-expired symbol after check", () => {
    const futureExpiry = Date.now() + 60000;
    state.setRecentAddedSymbols({ RELIANCE: futureExpiry });
    isRecentlyAdded("RELIANCE");
    expect(state.recentAddedSymbols["RELIANCE"]).toBe(futureExpiry);
  });

  test("returns false for symbol with exactly now timestamp", () => {
    state.setRecentAddedSymbols({ EXACT: Date.now() });
    expect(isRecentlyAdded("EXACT")).toBe(false);
  });
});
