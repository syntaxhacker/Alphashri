import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../state/auth", () => ({
  fetchWithAuth: vi.fn(),
}));

import { fetchWithAuth } from "../state/auth";
import { fetchSectorHistory } from "./sectorHistory";

const mockedFetch = vi.mocked(fetchWithAuth);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchSectorHistory", () => {
  it("sends market and years on the history endpoint", async () => {
    const payload = { market: "america", years: 10, months: [], series: [] };
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => payload,
    } as Response);

    const result = await fetchSectorHistory({ market: "america", years: 10 });

    const [url, init] = mockedFetch.mock.calls[0];
    expect(url).toContain("/api/sector/history?");
    expect(url).toContain("market=america");
    expect(url).toContain("years=10");
    expect(init).toEqual({ signal: undefined });
    expect(result).toEqual(payload);
  });

  it("passes the abort signal through to fetchWithAuth", async () => {
    const controller = new AbortController();
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ market: "india", years: 5 }),
    } as Response);

    await fetchSectorHistory({ market: "india", years: 5, signal: controller.signal });

    expect(mockedFetch.mock.calls[0][1]).toEqual({ signal: controller.signal });
  });

  it("throws the server detail on a non-ok response", async () => {
    mockedFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ detail: "history unavailable" }),
    } as Response);

    await expect(fetchSectorHistory({ market: "india", years: 5 })).rejects.toThrow(
      "history unavailable",
    );
  });

  it("falls back to the default message when the body has no detail", async () => {
    mockedFetch.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    } as Response);

    await expect(fetchSectorHistory({ market: "india", years: 5 })).rejects.toThrow(
      "Failed to fetch sector history",
    );
  });
});
