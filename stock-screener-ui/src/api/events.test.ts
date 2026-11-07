// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  buildEventsQuery,
  fetchAnomalies,
  fetchEvents,
  fetchTodayEvents,
  refreshEvents,
} from "./events";

/**
 * Minimal `Response` stand-in. It implements both `text()` and `json()` so the
 * error path (which prefers `text()`) is exercised exactly as in production.
 */
function mockResponse(body: unknown, status = 200): Response {
  const ok = status >= 200 && status < 300;
  return {
    ok,
    status,
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function calledUrl(call = 0): string {
  return String(fetchMock.mock.calls[call][0]);
}

describe("buildEventsQuery", () => {
  test("returns an empty string for an empty query", () => {
    expect(buildEventsQuery({})).toBe("");
  });

  test("emits a deterministic key order regardless of insertion order", () => {
    const a = buildEventsQuery({
      limit: 10,
      upcoming_only: true,
      symbols: "AAPL,MSFT",
      types: "earnings",
      to: "2026-12-31",
      from: "2026-10-01",
      market: "us",
    });
    const b = buildEventsQuery({
      market: "us",
      from: "2026-10-01",
      to: "2026-12-31",
      types: "earnings",
      symbols: "AAPL,MSFT",
      upcoming_only: true,
      limit: 10,
    });
    expect(a).toBe(b);
    expect(a).toBe(
      "market=us&from=2026-10-01&to=2026-12-31&types=earnings&symbols=AAPL%2CMSFT&upcoming_only=true&limit=10",
    );
  });

  test("skips undefined params", () => {
    const query = buildEventsQuery({ market: "india", from: undefined, limit: undefined });
    expect(query).toBe("market=india");
    expect(query).not.toContain("from");
    expect(query).not.toContain("limit");
  });

  test("serialises booleans as true/false strings", () => {
    expect(buildEventsQuery({ upcoming_only: true })).toBe("upcoming_only=true");
    expect(buildEventsQuery({ upcoming_only: false })).toBe("upcoming_only=false");
  });
});

describe("fetchEvents", () => {
  test("hits the calendar endpoint with the serialised query", async () => {
    const body = { events: [], meta: { as_of: "x", scanned: 0, sources: {}, warnings: [] } };
    fetchMock.mockResolvedValueOnce(mockResponse(body));

    const result = await fetchEvents({
      market: "us",
      from: "2026-10-01",
      to: "2026-12-31",
      upcoming_only: false,
      limit: 25,
    });

    expect(result).toEqual(body);
    const url = calledUrl();
    expect(url).toContain("/api/events/calendar?");
    expect(url).toContain("market=us");
    expect(url).toContain("from=2026-10-01");
    expect(url).toContain("to=2026-12-31");
    expect(url).toContain("upcoming_only=false");
    expect(url).toContain("limit=25");
  });

  test("omits the question mark when the query is empty", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ events: [] }));
    await fetchEvents();
    expect(calledUrl()).toMatch(/\/api\/events\/calendar$/);
  });

  test("forwards the abort signal", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ events: [] }));
    const controller = new AbortController();
    await fetchEvents({}, { signal: controller.signal });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ signal: controller.signal });
  });

  test("throws status + server detail on a non-ok response", async () => {
    fetchMock.mockResolvedValue(mockResponse({ detail: "bad date range" }, 422));
    await expect(fetchEvents({ from: "nope" })).rejects.toThrow(/422/);
    await expect(fetchEvents({ from: "nope" })).rejects.toThrow(/bad date range/);
  });

  test("keeps a plain-text error body in the message", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse("upstream exploded", 503));
    await expect(fetchEvents()).rejects.toThrow("upstream exploded");
  });
});

describe("fetchTodayEvents", () => {
  test("hits the today endpoint", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ events: [] }));
    await fetchTodayEvents();
    expect(calledUrl()).toMatch(/\/api\/events\/today$/);
  });

  test("forwards the abort signal", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ events: [] }));
    const controller = new AbortController();
    await fetchTodayEvents({ signal: controller.signal });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ signal: controller.signal });
  });
});

describe("fetchAnomalies", () => {
  test("sends the date as a query param", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ anomalies: [] }));
    await fetchAnomalies("2026-10-28");
    expect(calledUrl()).toContain("/api/events/anomalies?date=2026-10-28");
  });

  test("throws on a failed response", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ detail: "no session" }, 404));
    await expect(fetchAnomalies("2026-10-28")).rejects.toThrow(/404/);
  });
});

describe("refreshEvents", () => {
  test("POSTs to the refresh endpoint", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ ok: true }));
    const result = await refreshEvents();
    expect(result).toEqual({ ok: true });
    expect(calledUrl()).toMatch(/\/api\/events\/refresh$/);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST" });
  });

  test("assumes success when the body is empty (204)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 204,
      text: () => Promise.resolve(""),
      json: () => Promise.reject(new Error("no body")),
    } as unknown as Response);
    await expect(refreshEvents()).resolves.toEqual({ ok: true });
  });

  test("throws on a failed refresh", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ detail: "busy" }, 409));
    await expect(refreshEvents()).rejects.toThrow(/409/);
  });
});
