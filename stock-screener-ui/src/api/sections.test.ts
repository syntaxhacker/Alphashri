import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../state/auth", () => ({
  fetchWithAuth: vi.fn(),
}));

vi.mock("./config", () => ({
  API_BASE: "http://localhost:8765",
}));

import { fetchWithAuth } from "../state/auth";
import { fetchSectionScan } from "./sections";
import type { SectionDefinition } from "../state/sections/types";

const mockedFetch = vi.mocked(fetchWithAuth);

const section = (id: string): SectionDefinition => ({
  id,
  name: id,
  description: "test section",
  concept: "momentum_5m",
  side: "long",
  conditions: [{ metric: "change|5", op: "gte", value: 1.5 }],
  render: { type: "table", columns: ["symbol", "change|5"] },
  refreshSec: 60,
  enabled: true,
  pinned: false,
});

const response = (body: unknown, ok = true) =>
  ({ ok, status: ok ? 200 : 500, json: async () => body }) as Response;

function callUrl(call: Parameters<typeof mockedFetch>[0]): URL {
  return new URL(String(call));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchSectionScan", () => {
  it("GETs /api/sections/scan with market, sections JSON and allow_delayed=false by default", async () => {
    const defs = [section("vwap-reclaim")];
    mockedFetch.mockResolvedValue(
      response({
        market: "india",
        generated_at: "2026-11-25T09:00:00+05:30",
        row_count: 0,
        delayed_rows: 0,
        note: null,
        rows: [],
      }),
    );

    await fetchSectionScan("india", defs);

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    const url = callUrl(mockedFetch.mock.calls[0]![0]);
    expect(url.pathname).toBe("/api/sections/scan");
    expect(url.searchParams.get("market")).toBe("india");
    expect(url.searchParams.get("allow_delayed")).toBe("false");
    expect(JSON.parse(url.searchParams.get("sections") ?? "null")).toEqual(defs);
  });

  it("sends allow_delayed=true for america when delayed rows are requested", async () => {
    mockedFetch.mockResolvedValue(response({ rows: [], note: null }));

    await fetchSectionScan("america", [], true);

    const url = callUrl(mockedFetch.mock.calls[0]![0]);
    expect(url.searchParams.get("market")).toBe("america");
    expect(url.searchParams.get("allow_delayed")).toBe("true");
    expect(url.searchParams.get("sections")).toBe("[]");
  });

  it("returns the scan result unchanged, including the delayed-data note", async () => {
    const payload = {
      market: "india",
      generated_at: "2026-11-25T09:00:00+05:30",
      row_count: 1,
      delayed_rows: 1,
      note: "Including 1 delayed row(s); data may be up to 15 minutes old.",
      rows: [
        {
          symbol: "RELIANCE",
          name: "Reliance Industries",
          fields: { close: 1440, change: 0.7 },
          signals: { "vwap-reclaim": true },
        },
      ],
    };
    mockedFetch.mockResolvedValue(response(payload));

    await expect(fetchSectionScan("india", [section("vwap-reclaim")])).resolves.toEqual(payload);
  });

  it("throws the server's detail on a failed scan", async () => {
    mockedFetch.mockResolvedValue(
      response({ detail: "scanner upstream unavailable" }, false),
    );

    await expect(fetchSectionScan("india", [])).rejects.toThrow("scanner upstream unavailable");
  });
});
