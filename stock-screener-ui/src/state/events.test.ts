// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AnomaliesResponse, EventsResponse } from "../types/events";

vi.mock("../api/events", async () => {
  const actual = await vi.importActual<typeof import("../api/events")>("../api/events");
  return {
    // The query builder is pure — the store needs the real one for cache keys.
    buildEventsQuery: actual.buildEventsQuery,
    fetchEvents: vi.fn(),
    fetchTodayEvents: vi.fn(),
    fetchAnomalies: vi.fn(),
    refreshEvents: vi.fn(),
  };
});

import { fetchAnomalies, fetchEvents, refreshEvents } from "../api/events";
import { eventsStore, isoDate } from "./events";

const mockFetchEvents = vi.mocked(fetchEvents);
const mockFetchAnomalies = vi.mocked(fetchAnomalies);
const mockRefreshEvents = vi.mocked(refreshEvents);

/** Independent local-date formatter (does not reuse `isoDate`). */
function localISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function plusDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function eventsResponse(asOf = "2026-10-29T12:00:00Z"): EventsResponse {
  return {
    events: [],
    meta: { as_of: asOf, scanned: 1, sources: { seed: 1 }, warnings: [] },
  };
}

function anomaliesResponse(): AnomaliesResponse {
  return {
    anomalies: [],
    meta: {
      as_of: "2026-10-28T20:00:00Z",
      date: "2026-10-28",
      scanned: 10,
      thresholds: {
        ret_sigma: 4,
        vol_mult: 8,
        min_abs_ret: 1,
        cooldown_min: 30,
      },
      warnings: [],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  eventsStore.reset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("default query", () => {
  test("is US, future-only, 90 days long, capped at 500 rows", () => {
    const { query } = eventsStore.getState();
    const today = new Date();
    expect(query.market).toBe("us");
    expect(query.upcoming_only).toBe(true);
    expect(query.limit).toBe(500);
    expect(query.from).toBe(localISO(today));
    expect(query.to).toBe(localISO(plusDays(today, 90)));
  });
});

describe("isoDate", () => {
  test("uses local date parts, not the UTC day", () => {
    // 00:30 local — in IST this is the PREVIOUS UTC day, which is exactly the
    // bug `toISOString()` would introduce.
    expect(isoDate(new Date(2026, 9, 29, 0, 30, 0))).toBe("2026-10-29");
    expect(isoDate(new Date(2026, 0, 5, 23, 59, 0))).toBe("2026-01-05");
  });
});

describe("loadCalendar", () => {
  test("loads and stores the payload plus the server as-of stamp", async () => {
    mockFetchEvents.mockResolvedValueOnce(eventsResponse("2026-10-29T12:00:00Z"));
    await eventsStore.loadCalendar();

    const state = eventsStore.getState();
    expect(mockFetchEvents).toHaveBeenCalledTimes(1);
    expect(state.data?.meta.as_of).toBe("2026-10-29T12:00:00Z");
    expect(state.lastUpdated).toBe("2026-10-29T12:00:00Z");
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  test("a cache hit sets data synchronously and skips the fetch", async () => {
    mockFetchEvents.mockResolvedValueOnce(eventsResponse());
    await eventsStore.loadCalendar();
    expect(mockFetchEvents).toHaveBeenCalledTimes(1);

    // Second load: synchronous cache hit — data is present before awaiting.
    const pending = eventsStore.loadCalendar();
    expect(eventsStore.getState().data).not.toBeNull();
    await pending;

    expect(mockFetchEvents).toHaveBeenCalledTimes(1);
  });

  test("aborts the previous request and ignores its late result", async () => {
    let resolveFirst: (value: EventsResponse) => void = () => {};
    let resolveSecond: (value: EventsResponse) => void = () => {};
    mockFetchEvents
      .mockImplementationOnce(
        () => new Promise<EventsResponse>((resolve) => (resolveFirst = resolve)),
      )
      .mockImplementationOnce(
        () => new Promise<EventsResponse>((resolve) => (resolveSecond = resolve)),
      );

    const first = eventsStore.loadCalendar({ market: "us" });
    const firstSignal = mockFetchEvents.mock.calls[0][1]?.signal as AbortSignal | undefined;
    const second = eventsStore.loadCalendar({ market: "india" });

    expect(firstSignal?.aborted).toBe(true);

    resolveSecond(eventsResponse("second"));
    await second;
    resolveFirst(eventsResponse("first"));
    await first;

    const state = eventsStore.getState();
    expect(state.data?.meta.as_of).toBe("second");
    expect(state.query.market).toBe("india");
    expect(state.isLoading).toBe(false);
  });

  test("stores a human-readable error and clears isLoading on failure", async () => {
    mockFetchEvents.mockRejectedValueOnce(new Error("HTTP 500 storage offline"));
    await eventsStore.loadCalendar();

    const state = eventsStore.getState();
    expect(state.isLoading).toBe(false);
    expect(state.data).toBeNull();
    expect(state.error).toBeInstanceOf(Error);
    expect(state.error?.message).toContain("Could not load the event calendar.");
    // Technical detail must survive so the failure is debuggable.
    expect(state.error?.message).toContain("HTTP 500 storage offline");
  });

  test("notifies subscribers with the new state", async () => {
    mockFetchEvents.mockResolvedValueOnce(eventsResponse());
    const seen: boolean[] = [];
    const unsubscribe = eventsStore.subscribe((s) => seen.push(s.data !== null));
    await eventsStore.loadCalendar();
    unsubscribe();
    expect(seen).toContain(true);
  });
});

describe("setQuery", () => {
  test("reloads with the patched query and keeps the default range", async () => {
    mockFetchEvents.mockResolvedValue(eventsResponse());
    eventsStore.setQuery({ market: "india" });

    await vi.waitFor(() => expect(mockFetchEvents).toHaveBeenCalledTimes(1));
    const query = mockFetchEvents.mock.calls[0][0] ?? {};
    expect(query.market).toBe("india");
    expect(query.from).toBe(localISO(new Date()));
    expect(query.to).toBe(localISO(plusDays(new Date(), 90)));
    expect(eventsStore.getState().query.market).toBe("india");
  });

  test("resets the range to today/+90 when a date is cleared", async () => {
    mockFetchEvents.mockResolvedValue(eventsResponse());
    eventsStore.setQuery({ from: "", to: undefined });

    await vi.waitFor(() => expect(mockFetchEvents).toHaveBeenCalledTimes(1));
    const query = mockFetchEvents.mock.calls[0][0] ?? {};
    expect(query.from).toBe(localISO(new Date()));
    expect(query.to).toBe(localISO(plusDays(new Date(), 90)));
  });
});

describe("refresh", () => {
  test("clears the cache, POSTs, then refetches the calendar", async () => {
    mockFetchEvents.mockResolvedValue(eventsResponse());
    mockRefreshEvents.mockResolvedValue({ ok: true });

    await eventsStore.loadCalendar();
    expect(mockFetchEvents).toHaveBeenCalledTimes(1);

    await eventsStore.refresh();

    expect(mockRefreshEvents).toHaveBeenCalledTimes(1);
    expect(mockFetchEvents).toHaveBeenCalledTimes(2);
    // The POST must happen before the reload, otherwise the UI re-caches the
    // payload the refresh was meant to replace.
    expect(mockRefreshEvents.mock.invocationCallOrder[0]).toBeLessThan(
      mockFetchEvents.mock.invocationCallOrder[1],
    );
    expect(eventsStore.getState().isRefreshing).toBe(false);
  });

  test("surfaces a refresh failure and stops the refreshing flag", async () => {
    mockRefreshEvents.mockRejectedValueOnce(new Error("HTTP 503 busy"));

    await eventsStore.refresh();

    const state = eventsStore.getState();
    expect(state.isRefreshing).toBe(false);
    expect(state.error?.message).toContain("Could not refresh the event sources.");
    expect(state.error?.message).toContain("HTTP 503 busy");
    expect(mockFetchEvents).not.toHaveBeenCalled();
  });
});

describe("loadAnomalies", () => {
  test("stores the anomaly payload", async () => {
    mockFetchAnomalies.mockResolvedValueOnce(anomaliesResponse());
    await eventsStore.loadAnomalies("2026-10-28");

    expect(mockFetchAnomalies).toHaveBeenCalledWith(
      "2026-10-28",
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(eventsStore.getState().anomalies?.meta.date).toBe("2026-10-28");
    expect(eventsStore.getState().isLoading).toBe(false);
  });

  test("stores a friendly error on failure", async () => {
    mockFetchAnomalies.mockRejectedValueOnce(new Error("HTTP 500"));
    await eventsStore.loadAnomalies("2026-10-28");

    const state = eventsStore.getState();
    expect(state.isLoading).toBe(false);
    expect(state.error?.message).toContain("Could not load the event anomalies.");
  });

  test("keeps a calendar error when the anomaly feed then succeeds", async () => {
    // The panel fires both loads on mount; a healthy anomaly response must not
    // erase the calendar 500 that is still the reason the table is empty.
    mockFetchEvents.mockRejectedValueOnce(new Error("HTTP 500 storage offline"));
    await eventsStore.loadCalendar();
    expect(eventsStore.getState().error?.message).toContain("Could not load the event calendar.");

    mockFetchAnomalies.mockResolvedValueOnce(anomaliesResponse());
    await eventsStore.loadAnomalies("2026-10-28");

    const state = eventsStore.getState();
    expect(state.anomalies).not.toBeNull();
    expect(state.error?.message).toContain("Could not load the event calendar.");
    expect(state.error?.message).toContain("HTTP 500 storage offline");
  });

  test("keeps an anomaly error when the calendar then succeeds", async () => {
    mockFetchAnomalies.mockRejectedValueOnce(new Error("HTTP 500 anomaly feed"));
    await eventsStore.loadAnomalies("2026-10-28");
    expect(eventsStore.getState().error?.message).toContain("Could not load the event anomalies.");

    mockFetchEvents.mockResolvedValueOnce(eventsResponse());
    await eventsStore.loadCalendar();

    expect(eventsStore.getState().data).not.toBeNull();
    expect(eventsStore.getState().error?.message).toContain("Could not load the event anomalies.");
  });
});

describe("reset", () => {
  test("drops data, anomalies and the cache", async () => {
    mockFetchEvents.mockResolvedValueOnce(eventsResponse());
    await eventsStore.loadCalendar();
    expect(eventsStore.getState().data).not.toBeNull();

    eventsStore.reset();
    expect(eventsStore.getState().data).toBeNull();
    expect(eventsStore.getState().anomalies).toBeNull();
    expect(eventsStore.getState().error).toBeNull();

    // Cache was cleared: the next load must hit the network again.
    mockFetchEvents.mockResolvedValueOnce(eventsResponse());
    await eventsStore.loadCalendar();
    expect(mockFetchEvents).toHaveBeenCalledTimes(2);
  });
});
