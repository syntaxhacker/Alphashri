import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../state/auth", () => ({
  fetchWithAuth: vi.fn(),
}));

import { fetchWithAuth } from "../state/auth";
import {
  getUnderlyings,
  getExpiries,
  getOptionChain,
  getSpotPrice,
  getPositions,
} from "./upstoxOptions";

const mockedFetch = vi.mocked(fetchWithAuth);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getUnderlyings", () => {
  it("fetches underlyings and extracts array", async () => {
    const underlyings = [
      { symbol: "NIFTY", name: "Nifty 50", instrument_key: "key1", lot_size: 25, tick_size: 0.05 },
    ];
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ underlyings }),
    } as Response);

    const result = await getUnderlyings();

    expect(result).toEqual(underlyings);
    expect(mockedFetch).toHaveBeenCalledWith(expect.stringContaining("/api/options/underlyings"));
  });

  it("returns empty array when underlyings not present", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);

    const result = await getUnderlyings();

    expect(result).toEqual([]);
  });

  it("throws on non-ok response", async () => {
    mockedFetch.mockResolvedValue({
      ok: false,
    } as Response);

    await expect(getUnderlyings()).rejects.toThrow("Failed to fetch underlyings");
  });
});

describe("getExpiries", () => {
  it("includes underlying in URL path", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ expiries: [{ date: "2024-02-29" }] }),
    } as Response);

    await getExpiries("NIFTY");

    expect(mockedFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/options/expiries/NIFTY"),
    );
  });

  it("returns expiries array", async () => {
    const expiries = [
      { date: "2024-02-29", weekly: true, days_to_expiry: 10 },
      { date: "2024-03-28", weekly: false, days_to_expiry: 37 },
    ];
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ expiries }),
    } as Response);

    const result = await getExpiries("NIFTY");

    expect(result).toEqual(expiries);
  });

  it("returns empty array when expiries not present", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);

    const result = await getExpiries("NIFTY");

    expect(result).toEqual([]);
  });

  it("throws on non-ok response", async () => {
    mockedFetch.mockResolvedValue({
      ok: false,
    } as Response);

    await expect(getExpiries("BAD")).rejects.toThrow("Failed to fetch expiries");
  });
});

describe("getOptionChain", () => {
  it("builds URL with underlying and expiry params", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ underlying: "NIFTY", chain: [] }),
    } as Response);

    await getOptionChain("NIFTY", "2024-02-29");

    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/api/options/chain/NIFTY");
    expect(calledUrl).toContain("expiry=2024-02-29");
  });

  it("returns full option chain response", async () => {
    const response = {
      underlying: "NIFTY",
      expiry: "2024-02-29",
      spot: 22000,
      chain: [{ strike: 22000, ce: null, pe: null }],
    };
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => response,
    } as Response);

    const result = await getOptionChain("NIFTY", "2024-02-29");

    expect(result).toEqual(response);
  });

  it("throws on non-ok response", async () => {
    mockedFetch.mockResolvedValue({
      ok: false,
    } as Response);

    await expect(getOptionChain("BAD", "2024-01-01")).rejects.toThrow(
      "Failed to fetch option chain",
    );
  });
});

describe("getSpotPrice", () => {
  it("includes underlying in URL path", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: "success", underlying: "NIFTY", spot: 22000 }),
    } as Response);

    await getSpotPrice("NIFTY");

    expect(mockedFetch).toHaveBeenCalledWith(expect.stringContaining("/api/options/spot/NIFTY"));
  });

  it("returns spot price response", async () => {
    const response = { status: "success", underlying: "NIFTY", spot: 22000.5 };
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => response,
    } as Response);

    const result = await getSpotPrice("NIFTY");

    expect(result).toEqual(response);
  });

  it("throws on non-ok response", async () => {
    mockedFetch.mockResolvedValue({
      ok: false,
    } as Response);

    await expect(getSpotPrice("BAD")).rejects.toThrow("Failed to fetch spot price");
  });
});

describe("getPositions", () => {
  it("returns positions response", async () => {
    const response = {
      status: "success",
      positions: [{ instrument_key: "key", trading_symbol: "NIFTY24000CE", quantity: 50 }],
    };
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => response,
    } as Response);

    const result = await getPositions();

    expect(result).toEqual(response);
    expect(mockedFetch).toHaveBeenCalledWith(expect.stringContaining("/api/options/positions"));
  });

  it("throws on non-ok response", async () => {
    mockedFetch.mockResolvedValue({
      ok: false,
    } as Response);

    await expect(getPositions()).rejects.toThrow("Failed to fetch positions");
  });
});
