import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../state/auth", () => ({
  fetchWithAuth: vi.fn(),
}));

import { fetchWithAuth } from "../state/auth";
import { ApiError } from "./apiError";
import { fetchCatalystsToday, normalizeCatalystToday } from "./catalysts";

const mockedFetch = vi.mocked(fetchWithAuth);

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    as_of: "2026-11-19T11:13:00+05:30",
    market: {
      nifty: { last: 25304.2, change_pct: 0.3 },
      sensex: { last: 82300, change_pct: 0.4 },
      vix: 16.31,
    },
    sector: {
      id: "auto",
      label: "NIFTY AUTO",
      change_pct: 3.75,
      relative_strength_pct: 3.45,
      breadth: { advancing: 12, declining: 3, total: 15 },
    },
    available_sectors: [
      { id: "auto", label: "NIFTY AUTO", count: 15 },
      { id: "it", label: "NIFTY IT", count: 10 },
    ],
    rows: [
      {
        symbol: "MARUTI",
        name: "Maruti Suzuki",
        sector: "Auto",
        kind: "event",
        headline: "Investor meetings 17-19 Nov; stock near 52-week low",
        source: "Business Standard",
        source_url: "https://example.test/maruti",
        first_seen: "2026-11-19T10:31:00+05:30",
        event_at: "2026-11-19T09:15:00+05:30",
        state: "scheduled",
        score: "high",
        confidence: 0.72,
        move_pct: "6.5",
        rel_volume: 2.4,
        reasons: ["GST small-car demand", "Stock -25% YTD"],
        invalidates: ["Nifty Auto gives back >1.5%"],
      },
    ],
    counts: { high: 1, medium: 0, low: 0, total: 1 },
    warnings: ["event_source_unavailable"],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchCatalystsToday", () => {
  it("requests today's india payload and normalizes snake_case", async () => {
    mockedFetch.mockResolvedValue(jsonResponse(payload()));

    const result = await fetchCatalystsToday();

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(mockedFetch.mock.calls[0][0]).toContain("/api/catalysts/today?market=india");
    expect(result.as_of).toBe("2026-11-19T11:13:00+05:30");
    expect(result.market?.nifty).toEqual({ last: 25304.2, change_pct: 0.3 });
    expect(result.market?.vix).toBe(16.31);
    expect(result.sector?.breadth).toEqual({ advancing: 12, declining: 3, total: 15 });
    expect(result.available_sectors).toEqual([
      { id: "auto", label: "NIFTY AUTO", count: 15 },
      { id: "it", label: "NIFTY IT", count: 10 },
    ]);
    expect(result.counts).toEqual({ high: 1, medium: 0, low: 0, total: 1 });
    expect(result.warnings).toEqual(["event_source_unavailable"]);

    const row = result.rows[0];
    expect(row.symbol).toBe("MARUTI");
    expect(row.kind).toBe("event");
    expect(row.state).toBe("scheduled");
    expect(row.score).toBe("high");
    expect(row.move_pct).toBe(6.5);
    expect(row.rel_volume).toBe(2.4);
    expect(row.source_url).toBe("https://example.test/maruti");
    expect(row.reasons).toEqual(["GST small-car demand", "Stock -25% YTD"]);
    expect(row.invalidates).toEqual(["Nifty Auto gives back >1.5%"]);
  });

  it("forwards the abort signal", async () => {
    mockedFetch.mockResolvedValue(jsonResponse(payload()));
    const controller = new AbortController();

    await fetchCatalystsToday(controller.signal);

    const options = mockedFetch.mock.calls[0][1] as RequestInit;
    expect(options.signal).toBe(controller.signal);
  });

  it("passes the selected sector to the endpoint", async () => {
    mockedFetch.mockResolvedValue(jsonResponse(payload()));

    await fetchCatalystsToday(undefined, "it");

    expect(mockedFetch.mock.calls[0][0]).toContain("sector=it");
  });

  it("keeps an explicitly empty rows list as a successful payload", async () => {
    mockedFetch.mockResolvedValue(jsonResponse(payload({ rows: [], counts: null })));

    const result = await fetchCatalystsToday();

    expect(result.rows).toEqual([]);
    expect(result.counts).toBeNull();
  });

  it("rejects a non-2xx response instead of returning an empty success", async () => {
    mockedFetch.mockResolvedValue(
      jsonResponse({ detail: "event_source_unavailable" }, 503),
    );

    const failure = fetchCatalystsToday();

    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({
      status: 503,
      message: "event_source_unavailable",
    });
  });

  it("rejects an unreadable body", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    } as unknown as Response);

    await expect(fetchCatalystsToday()).rejects.toThrow(
      "Catalysts response was not valid JSON",
    );
  });

  it("rejects a payload without a rows array", async () => {
    mockedFetch.mockResolvedValue(jsonResponse({ as_of: null }));

    await expect(fetchCatalystsToday()).rejects.toThrow(/rows must be an array/);
  });

  it("rejects a row that cannot be rendered rather than dropping it silently", async () => {
    const row = payload().rows as Record<string, unknown>[];
    const broken = { ...row[0], headline: "" };
    mockedFetch.mockResolvedValue(jsonResponse(payload({ rows: [broken] })));

    await expect(fetchCatalystsToday()).rejects.toThrow(/rows\[0\]\.headline/);
  });

  it("accepts a positioning row without a headline", async () => {
    const row = payload().rows as Record<string, unknown>[];
    mockedFetch.mockResolvedValue(
      jsonResponse(payload({ rows: [{ ...row[0], kind: "positioning", headline: null }] })),
    );

    const data = await fetchCatalystsToday();
    expect(data.rows[0]).toMatchObject({
      kind: "positioning",
      headline: null,
    });
  });

  it("rejects an unknown score instead of inventing one", async () => {
    const row = payload().rows as Record<string, unknown>[];
    mockedFetch.mockResolvedValue(
      jsonResponse(payload({ rows: [{ ...row[0], score: "extreme" }] })),
    );

    await expect(fetchCatalystsToday()).rejects.toThrow(/rows\[0\]\.score/);
  });
});

describe("normalizeCatalystToday", () => {
  it("keeps gaps as null and drops non-string list entries", () => {
    const normalized = normalizeCatalystToday({
      rows: [
        {
          symbol: "SBIN",
          headline: "Broker upgrade",
          kind: "news",
          state: "breaking",
          score: "medium",
          reasons: ["upgrade", 42, ""],
        },
      ],
    });

    expect(normalized.as_of).toBeNull();
    expect(normalized.market).toBeNull();
    expect(normalized.sector).toBeNull();
    expect(normalized.counts).toBeNull();
    expect(normalized.warnings).toEqual([]);
    expect(normalized.rows[0]).toMatchObject({
      name: null,
      sector: null,
      source: null,
      source_url: null,
      first_seen: null,
      event_at: null,
      confidence: null,
      move_pct: null,
      rel_volume: null,
      invalidates: [],
      reasons: ["upgrade"],
    });
  });

  it("rejects a non-object payload", () => {
    expect(() => normalizeCatalystToday([])).toThrow(/expected an object/);
    expect(() => normalizeCatalystToday(null)).toThrow(/expected an object/);
  });
});
