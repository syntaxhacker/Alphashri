// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "solid-js";

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));

vi.mock("../api/catalysts", () => ({
  CATALYST_DEFAULT_SECTOR: "all",
  fetchCatalystsToday: (...args: unknown[]) => mockFetch(...args),
}));

import type { CatalystToday } from "../api/catalysts";
import {
  CATALYST_POLL_MS,
  __resetCatalystStore,
  useCatalystToday,
} from "./catalystStore";

const PAYLOAD: CatalystToday = {
  as_of: "2026-11-19T11:13:00+05:30",
  market: null,
  sector: null,
  available_sectors: [],
  rows: [],
  counts: { high: 0, medium: 0, low: 0, total: 0 },
  warnings: [],
};

const OTHER: CatalystToday = { ...PAYLOAD, as_of: "2026-11-19T11:14:00+05:30" };

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

function mount(): () => void {
  return createRoot((dispose) => {
    useCatalystToday();
    return dispose;
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  __resetCatalystStore();
  mockFetch.mockReset();
  mockFetch.mockResolvedValue(PAYLOAD);
});

afterEach(() => {
  __resetCatalystStore();
  vi.useRealTimers();
  Reflect.deleteProperty(document, "hidden");
});

describe("useCatalystToday", () => {
  it("hands every consumer the same store and starts one request", () => {
    const dispose = createRoot((root) => {
      const first = useCatalystToday();
      const second = useCatalystToday();
      expect(first).toBe(second);
      return root;
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("changing sector refetches the selected sector", async () => {
    let catalyst!: ReturnType<typeof useCatalystToday>;
    const dispose = createRoot((root) => {
      catalyst = useCatalystToday();
      return root;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(catalyst.sector()).toBe("all");

    mockFetch.mockClear();
    catalyst.setSector("it");
    await vi.advanceTimersByTimeAsync(0);

    expect(catalyst.sector()).toBe("it");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][1]).toBe("it");
    dispose();
  });

  it("polls at the 30s floor, not faster", async () => {
    const dispose = mount();
    await vi.advanceTimersByTimeAsync(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(CATALYST_POLL_MS - 1);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("stops polling while the tab is hidden", async () => {
    const dispose = mount();
    await vi.advanceTimersByTimeAsync(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    setHidden(true);
    await vi.advanceTimersByTimeAsync(CATALYST_POLL_MS * 3);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("refreshes on visibility return only when the payload is stale", async () => {
    const dispose = mount();
    await vi.advanceTimersByTimeAsync(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // A quick glance away does not spend a request.
    setHidden(true);
    setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    setHidden(true);
    await vi.advanceTimersByTimeAsync(CATALYST_POLL_MS);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("keeps a single request in flight", async () => {
    let resolve!: (value: CatalystToday) => void;
    mockFetch.mockReset();
    mockFetch.mockReturnValue(
      new Promise<CatalystToday>((done) => {
        resolve = done;
      }),
    );

    const store = useCatalystToday();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    store.refresh();
    store.refresh();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    resolve(PAYLOAD);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.data()).toBe(PAYLOAD);
  });

  it("exposes no data and loading until the first payload lands", async () => {
    let resolve!: (value: CatalystToday) => void;
    mockFetch.mockReset();
    mockFetch.mockReturnValue(
      new Promise<CatalystToday>((done) => {
        resolve = done;
      }),
    );

    const store = useCatalystToday();
    expect(store.data()).toBeNull();
    expect(store.loading()).toBe(true);
    expect(store.error()).toBeNull();

    resolve(PAYLOAD);
    await vi.advanceTimersByTimeAsync(0);

    expect(store.data()).toBe(PAYLOAD);
    expect(store.loading()).toBe(false);
  });

  it("retains the last good payload and surfaces the refresh error", async () => {
    const store = useCatalystToday();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.data()).toBe(PAYLOAD);

    mockFetch.mockRejectedValue(new Error("catalysts service down"));
    store.refresh();
    await vi.advanceTimersByTimeAsync(0);

    expect(store.data()).toBe(PAYLOAD);
    expect(store.error()).toBe("catalysts service down");
    expect(store.loading()).toBe(false);
  });

  it("clears the error on the next success and replaces the payload", async () => {
    const store = useCatalystToday();
    await vi.advanceTimersByTimeAsync(0);

    mockFetch.mockRejectedValueOnce(new Error("temporary failure"));
    store.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.error()).toBe("temporary failure");

    mockFetch.mockResolvedValue(OTHER);
    store.refresh();
    await vi.advanceTimersByTimeAsync(0);

    expect(store.error()).toBeNull();
    expect(store.data()).toBe(OTHER);
  });

  it("aborts the in-flight request when the last consumer unmounts", () => {
    let signal: AbortSignal | undefined;
    mockFetch.mockReset();
    mockFetch.mockImplementation((passed?: AbortSignal) => {
      signal = passed;
      return new Promise<CatalystToday>(() => {});
    });

    const dispose = mount();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(signal?.aborted).toBe(false);

    dispose();
    expect(signal?.aborted).toBe(true);
  });

  it("leaves no timer behind after the last consumer unmounts", async () => {
    const dispose = mount();
    await vi.advanceTimersByTimeAsync(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    dispose();
    await vi.advanceTimersByTimeAsync(CATALYST_POLL_MS * 2);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
