// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type {
  AnomaliesResponse,
  EventDTO,
  EventsQuery,
  EventsResponse,
} from "../types/events";

vi.mock("../api/events", async () => {
  const actual = await vi.importActual<typeof import("../api/events")>("../api/events");
  return {
    buildEventsQuery: actual.buildEventsQuery,
    fetchEvents: vi.fn(),
    fetchTodayEvents: vi.fn(),
    fetchAnomalies: vi.fn(),
    refreshEvents: vi.fn(),
  };
});

import { fetchAnomalies, fetchEvents, refreshEvents } from "../api/events";
import { eventsStore } from "../state/events";
import { useEvents } from "./useEvents";

const mockFetchEvents = vi.mocked(fetchEvents);
const mockFetchAnomalies = vi.mocked(fetchAnomalies);
const mockRefreshEvents = vi.mocked(refreshEvents);

const EVENT: EventDTO = {
  id: "evt-1",
  symbol: "AAPL",
  event_type: "investor_day",
  title: "Apple Investor Day",
  event_date: "2026-11-10",
  source: "seed",
  exchange: "NASDAQ",
  name: "Apple Inc.",
  announced_at: "2026-10-01",
  source_url: null,
  confidence: 0.9,
  recurring: true,
  notes: null,
  days_until: 12,
  is_alpha: true,
};

function eventsResponse(events: EventDTO[] = [EVENT]): EventsResponse {
  return {
    events,
    meta: { as_of: "2026-10-29T12:00:00Z", scanned: 42, sources: { seed: 1 }, warnings: [] },
  };
}

function anomaliesResponse(): AnomaliesResponse {
  return {
    anomalies: [
      {
        symbol: "AAPL",
        ts: "2026-10-28T14:19:00+05:30",
        price: 210.5,
        ret_pct: 1.4,
        ret_sigma: 4.8,
        vol_ratio: 9.1,
        has_known_event: false,
        suspected: null,
        exchange: "NASDAQ",
      },
    ],
    meta: {
      as_of: "2026-10-28T20:00:00Z",
      date: "2026-10-28",
      scanned: 10,
      thresholds: { ret_sigma: 4, vol_mult: 8, min_abs_ret: 1, cooldown_min: 30 },
      warnings: [],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  eventsStore.reset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useEvents", () => {
  test("renders events and meta from the store without refetching", async () => {
    mockFetchEvents.mockResolvedValueOnce(eventsResponse());
    await act(async () => {
      await eventsStore.loadCalendar();
    });
    expect(mockFetchEvents).toHaveBeenCalledTimes(1);

    const { result } = renderHook(() => useEvents());

    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0].symbol).toBe("AAPL");
    expect(result.current.meta?.scanned).toBe(42);
    expect(result.current.data?.events).toHaveLength(1);
    expect(result.current.error).toBeNull();
    expect(result.current.lastUpdated).toBe("2026-10-29T12:00:00Z");
    // Data already present: the bootstrap effect must not fire a request.
    expect(mockFetchEvents).toHaveBeenCalledTimes(1);
  });

  test("bootstraps a load on mount when the store is empty", async () => {
    mockFetchEvents.mockResolvedValueOnce(eventsResponse());
    const { result } = renderHook(() => useEvents());

    await waitFor(() => expect(result.current.events).toHaveLength(1));
    expect(mockFetchEvents).toHaveBeenCalledTimes(1);
  });

  test("exposes refresh, which POSTs then reloads", async () => {
    mockFetchEvents.mockResolvedValue(eventsResponse());
    mockRefreshEvents.mockResolvedValue({ ok: true });
    await act(async () => {
      await eventsStore.loadCalendar();
    });

    const { result } = renderHook(() => useEvents());
    act(() => {
      result.current.refresh();
    });
    await waitFor(() => expect(mockRefreshEvents).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockFetchEvents).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.isRefreshing).toBe(false));
  });

  test("does not reload when re-rendered with an equal external query", async () => {
    mockFetchEvents.mockResolvedValue(eventsResponse());
    const { rerender } = renderHook(({ query }) => useEvents(query), {
      initialProps: { query: { market: "us" as const } },
    });

    await waitFor(() => expect(mockFetchEvents).toHaveBeenCalledTimes(1));
    rerender({ query: { market: "us" as const } });
    rerender({ query: { market: "us" as const } });

    expect(mockFetchEvents).toHaveBeenCalledTimes(1);
  });

  test("syncs a changed external query into the store", async () => {
    mockFetchEvents.mockResolvedValue(eventsResponse());
    const { rerender } = renderHook(({ query }) => useEvents(query), {
      initialProps: { query: { market: "us" } as EventsQuery },
    });
    await waitFor(() => expect(mockFetchEvents).toHaveBeenCalledTimes(1));

    await act(async () => {
      rerender({ query: { market: "india" } });
    });
    await waitFor(() => expect(mockFetchEvents).toHaveBeenCalledTimes(2));

    expect(eventsStore.getState().query.market).toBe("india");
    expect(mockFetchEvents.mock.calls[1][0]?.market).toBe("india");
  });

  test("loadAnomalies stores the anomaly payload", async () => {
    mockFetchEvents.mockResolvedValueOnce(eventsResponse([]));
    mockFetchAnomalies.mockResolvedValueOnce(anomaliesResponse());
    await act(async () => {
      await eventsStore.loadCalendar();
    });

    const { result } = renderHook(() => useEvents());
    act(() => {
      result.current.loadAnomalies("2026-10-28");
    });
    await waitFor(() => expect(result.current.anomalies).not.toBeNull());
    expect(result.current.anomalies?.anomalies[0].symbol).toBe("AAPL");
    expect(mockFetchAnomalies).toHaveBeenCalledWith("2026-10-28", expect.anything());
  });

  test("surfaces store errors", async () => {
    mockFetchEvents.mockRejectedValueOnce(new Error("HTTP 502 bad gateway"));
    await act(async () => {
      await eventsStore.loadCalendar();
    });

    const { result } = renderHook(() => useEvents());
    expect(result.current.error?.message).toContain("Could not load the event calendar.");
    expect(result.current.events).toEqual([]);
    expect(result.current.meta).toBeNull();
  });
});
