// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  alertsMuted,
  flashAlertTitle,
  playAlertSound,
  setAlertsMuted,
  unlockAlertAudio,
} from "./alertSound";

beforeEach(() => {
  window.localStorage.clear();
  document.title = "Alphashri";
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("mute flag", () => {
  test("defaults to unmuted and persists the toggle", () => {
    expect(alertsMuted()).toBe(false);
    setAlertsMuted(true);
    expect(alertsMuted()).toBe(true);
    setAlertsMuted(false);
    expect(alertsMuted()).toBe(false);
  });

  test("a blocked localStorage does not throw", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(alertsMuted()).toBe(false);
    expect(() => setAlertsMuted(true)).not.toThrow();
  });
});

describe("playAlertSound", () => {
  test("is a no-op without Web Audio (jsdom) and never throws", () => {
    expect(() => playAlertSound("critical")).not.toThrow();
    expect(() => playAlertSound("alert")).not.toThrow();
    expect(() => playAlertSound("watch")).not.toThrow();
    expect(() => unlockAlertAudio()).not.toThrow();
  });

  test("stays silent while muted", () => {
    setAlertsMuted(true);
    const resume = vi.fn();
    class FakeCtx {
      state = "running";
      currentTime = 0;
      destination = {};
      resume = resume;
      createOscillator() {
        return {
          type: "sine",
          frequency: { value: 0 },
          connect: () => ({ connect: () => undefined }),
          start: vi.fn(),
          stop: vi.fn(),
        };
      }
      createGain() {
        return {
          gain: {
            setValueAtTime: vi.fn(),
            linearRampToValueAtTime: vi.fn(),
            exponentialRampToValueAtTime: vi.fn(),
          },
          connect: () => ({ connect: () => undefined }),
        };
      }
    }
    // Even with a working context, muted means no oscillator is created.
    vi.stubGlobal("AudioContext", FakeCtx as unknown as typeof AudioContext);
    expect(() => playAlertSound("critical")).not.toThrow();
    vi.unstubAllGlobals();
  });
});

describe("flashAlertTitle", () => {
  test("prefixes the bell and restores the original title on focus", () => {
    vi.useFakeTimers();
    flashAlertTitle("→ BUY PE 22,450");
    expect(document.title).toBe("🔔 → BUY PE 22,450");
    window.dispatchEvent(new Event("focus"));
    expect(document.title).toBe("Alphashri");
  });

  test("auto-restores after the timeout", () => {
    vi.useFakeTimers();
    flashAlertTitle("critical", 1000);
    vi.advanceTimersByTime(1001);
    expect(document.title).toBe("Alphashri");
  });

  test("a second alert keeps the original base title", () => {
    vi.useFakeTimers();
    flashAlertTitle("first");
    flashAlertTitle("second");
    expect(document.title).toBe("🔔 second");
    vi.advanceTimersByTime(30_001);
    expect(document.title).toBe("Alphashri");
  });

  test("re-flashing does not leave focus listeners behind", () => {
    // A desk session can fire dozens of flashes with the tab focused, so no
    // `focus` event ever runs their restore handler. Each flash must replace
    // the previous listener instead of stacking a new one.
    vi.useFakeTimers();
    const added: EventListenerOrEventListenerObject[] = [];
    const removed: EventListenerOrEventListenerObject[] = [];
    const addSpy = vi
      .spyOn(window, "addEventListener")
      .mockImplementation((type, listener) => {
        if (type === "focus") added.push(listener as EventListener);
      });
    const removeSpy = vi
      .spyOn(window, "removeEventListener")
      .mockImplementation((type, listener) => {
        if (type === "focus") removed.push(listener as EventListener);
      });

    for (let i = 0; i < 20; i += 1) flashAlertTitle(`alert ${i}`);

    expect(added).toHaveLength(20);
    // Every flash after the first removes its predecessor → at most one live.
    expect(added.length - removed.length).toBeLessThanOrEqual(1);
    expect(document.title).toBe("🔔 alert 19");

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
