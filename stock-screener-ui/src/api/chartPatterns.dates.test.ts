import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../state/auth", () => ({
  fetchWithAuth: vi.fn(),
}));

import { fetchWithAuth } from "../state/auth";
import { buildPatternsQuery, fetchSymbolChart } from "./chartPatterns";

const mockedFetch = vi.mocked(fetchWithAuth);

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("chartPatterns as-of replay transport", () => {
  it("serializes from_date/to_date into the results/summary query", () => {
    const qs = buildPatternsQuery({ from_date: "2026-06-01", to_date: "2026-09-30T14:30" });
    expect(qs).toContain("from_date=2026-06-01");
    expect(qs).toContain("to_date=2026-09-30T14%3A30");
  });

  it("omits from_date/to_date when unset", () => {
    expect(buildPatternsQuery({})).toBe("");
  });

  it("fetchSymbolChart sends as_of_date/from_date query params", async () => {
    mockedFetch.mockResolvedValue(okResponse({ symbol: "IRCON", timeframe: "1D", candles: [], overlays: [] }));
    await fetchSymbolChart("IRCON", "1D", {
      detectPatterns: true,
      asOf: "2026-09-30T14:30",
      fromDate: "2026-06-01",
    });
    const url = mockedFetch.mock.calls[0][0] as string;
    expect(url).toContain("detect_patterns=1");
    expect(url).toContain("as_of_date=2026-09-30T14%3A30");
    expect(url).toContain("from_date=2026-06-01");
  });

  it("fetchSymbolChart omits replay params when live", async () => {
    mockedFetch.mockResolvedValue(okResponse({ symbol: "IRCON", timeframe: "1D", candles: [], overlays: [] }));
    await fetchSymbolChart("IRCON", "1D", { detectPatterns: true });
    const url = mockedFetch.mock.calls[0][0] as string;
    expect(url).toContain("detect_patterns=1");
    expect(url).not.toContain("as_of_date");
    expect(url).not.toContain("from_date");
  });
});
