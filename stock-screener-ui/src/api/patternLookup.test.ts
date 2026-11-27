// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  lookupPatterns,
  mapPatternLookup,
  PATTERN_LOOKUP_MAX_SYMBOLS,
} from "./patternLookup";
import { fetchWithAuth } from "../state/auth";

vi.mock("../state/auth", () => ({
  fetchWithAuth: vi.fn(),
}));

const mockedFetch = vi.mocked(fetchWithAuth);

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

const STORED = {
  timeframe: "1D",
  session: "2026-11-16",
  source: "stored",
  data_through: "2026-11-14",
  items: [
    {
      symbol: "RELIANCE",
      count: 2,
      patterns: [
        {
          pattern_id: "bull_flag",
          name: "Bull Flag",
          direction: "bullish",
          status: "confirmed",
          quality: "strong",
          confidence: 80,
          bars_ago: 2,
        },
        {
          pattern_id: "double_top",
          name: "Double Top",
          direction: "bearish",
          status: "forming",
          quality: "fair",
          confidence: null,
          bars_ago: null,
        },
      ],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("lookupPatterns", () => {
  test("posts the flat symbol list with timeframe and universe", async () => {
    mockedFetch.mockResolvedValueOnce(jsonResponse(STORED));

    await lookupPatterns({
      symbols: ["RELIANCE", "TCS"],
      timeframe: "1D",
      universe: "all_equity",
    });

    const [url, init] = mockedFetch.mock.calls[0];
    expect(url).toContain("/api/chart-patterns/patterns/lookup");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      symbols: ["RELIANCE", "TCS"],
      timeframe: "1D",
      universe: "all_equity",
    });
  });

  test("defaults the timeframe to 1D and sends null for an unscoped read", async () => {
    mockedFetch.mockResolvedValueOnce(jsonResponse(STORED));

    await lookupPatterns({ symbols: ["RELIANCE"] });

    expect(JSON.parse(String(mockedFetch.mock.calls[0][1]?.body))).toEqual({
      symbols: ["RELIANCE"],
      timeframe: "1D",
      universe: null,
    });
  });

  test("caps the body at the endpoint's 500-symbol limit", async () => {
    mockedFetch.mockResolvedValueOnce(jsonResponse({ items: [] }));
    const symbols = Array.from({ length: 620 }, (_, i) => `SYM${i}`);

    await lookupPatterns({ symbols });

    const body = JSON.parse(String(mockedFetch.mock.calls[0][1]?.body));
    expect(body.symbols).toHaveLength(PATTERN_LOOKUP_MAX_SYMBOLS);
    expect(body.symbols[0]).toBe("SYM0");
  });

  test("forwards the abort signal so a window change can cancel the request", async () => {
    mockedFetch.mockResolvedValueOnce(jsonResponse(STORED));
    const controller = new AbortController();

    await lookupPatterns({ symbols: ["RELIANCE"] }, { signal: controller.signal });

    expect(mockedFetch.mock.calls[0][1]).toMatchObject({ signal: controller.signal });
  });

  test("maps stored items, leaving confidence null where the hit has none", async () => {
    mockedFetch.mockResolvedValueOnce(jsonResponse(STORED));

    const res = await lookupPatterns({ symbols: ["RELIANCE", "TCS"] });

    expect(res.session).toBe("2026-11-16");
    expect(res.data_through).toBe("2026-11-14");
    expect(res.items).toHaveLength(1);
    expect(res.items[0].symbol).toBe("RELIANCE");
    expect(res.items[0].patterns.map((p) => p.name)).toEqual(["Bull Flag", "Double Top"]);
    expect(res.items[0].patterns[0].confidence).toBe(80);
    expect(res.items[0].patterns[1].confidence).toBeNull();
  });

  test("throws the server detail on a non-2xx response", async () => {
    mockedFetch.mockResolvedValueOnce(
      jsonResponse({ detail: "unknown timeframe '7m'" }, false, 422),
    );

    await expect(lookupPatterns({ symbols: ["RELIANCE"] })).rejects.toThrow(
      "unknown timeframe '7m'",
    );
  });

  test("throws the status when the error body carries no detail", async () => {
    mockedFetch.mockResolvedValueOnce(jsonResponse({}, false, 503));

    await expect(lookupPatterns({ symbols: ["RELIANCE"] })).rejects.toThrow("503");
  });
});

describe("mapPatternLookup", () => {
  test("a cold store yields no items rather than fabricated entries", () => {
    const mapped = mapPatternLookup({
      timeframe: "1D",
      session: "2026-11-16",
      source: "stored",
      data_through: null,
      items: [],
    });

    expect(mapped.items).toEqual([]);
    expect(mapped.data_through).toBeNull();
  });

  test("drops malformed items and folds the symbol case", () => {
    const mapped = mapPatternLookup({
      items: [
        { symbol: " reliance ", patterns: [{ pattern_id: "bull_flag" }] },
        { symbol: "", patterns: [] },
        { patterns: [] },
        "nonsense",
      ],
    });

    expect(mapped.items.map((i) => i.symbol)).toEqual(["RELIANCE"]);
    // A pattern with no name falls back to its id rather than rendering blank.
    expect(mapped.items[0].patterns[0].name).toBe("bull_flag");
  });

  test("the count always matches the pattern array", () => {
    const mapped = mapPatternLookup({
      items: [
        {
          symbol: "TCS",
          count: 99,
          patterns: [{ pattern_id: "cup_handle", name: "Cup & Handle" }],
        },
      ],
    });

    // The badge and its tooltip must describe the same set.
    expect(mapped.items[0].count).toBe(1);
    expect(mapped.items[0].patterns).toHaveLength(1);
  });

  test("an absent body degrades to an empty stored answer", () => {
    expect(mapPatternLookup(null).items).toEqual([]);
    expect(mapPatternLookup(null).source).toBe("stored");
  });
});
