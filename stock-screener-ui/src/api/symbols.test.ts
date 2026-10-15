import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../state/auth", () => ({
  fetchWithAuth: vi.fn(),
}));

import { fetchWithAuth } from "../state/auth";
import { searchSymbols } from "./symbols";

const mockedFetch = vi.mocked(fetchWithAuth);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("searchSymbols", () => {
  it("returns empty array for empty string", async () => {
    const result = await searchSymbols("");

    expect(result).toEqual([]);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("returns empty array for whitespace-only query", async () => {
    const result = await searchSymbols("   ");

    expect(result).toEqual([]);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("returns empty array for null query", async () => {
    const result = await searchSymbols(null as any);

    expect(result).toEqual([]);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("returns empty array for undefined query", async () => {
    const result = await searchSymbols(undefined as any);

    expect(result).toEqual([]);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("trims whitespace from query", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ symbol: "TATASTEEL" }], query: "TATA", total: 1 }),
    } as Response);

    await searchSymbols("  TATA  ");

    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("q=TATA");
    expect(calledUrl).not.toContain("%20");
  });

  it("encodes special characters in query", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ results: [], query: "test", total: 0 }),
    } as Response);

    await searchSymbols("TATA STEEL & CO");

    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("q=TATA%20STEEL%20%26%20CO");
  });

  it("uses default limit of 10", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ results: [], query: "test", total: 0 }),
    } as Response);

    await searchSymbols("TATA");

    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("limit=10");
  });

  it("uses custom limit when provided", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ results: [], query: "test", total: 0 }),
    } as Response);

    await searchSymbols("TATA", 25);

    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("limit=25");
  });

  it("returns results array from response", async () => {
    const results = [
      { symbol: "TATASTEEL", name: "Tata Steel Limited" },
      { symbol: "TATAMOTORS", name: "Tata Motors Limited" },
    ];
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ results, query: "TATA", total: 2 }),
    } as Response);

    const result = await searchSymbols("TATA");

    expect(result).toEqual(results);
  });

  it("returns empty array when results not present", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ query: "BAD", total: 0 }),
    } as Response);

    const result = await searchSymbols("BAD");

    expect(result).toEqual([]);
  });

  it("returns empty array on non-ok response", async () => {
    mockedFetch.mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    const result = await searchSymbols("TATA");

    expect(result).toEqual([]);
  });

  it("returns empty array on network error", async () => {
    mockedFetch.mockRejectedValue(new Error("Network error"));

    const result = await searchSymbols("TATA");

    expect(result).toEqual([]);
  });

  it("calls fetchWithAuth with correct base URL", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ results: [], query: "test", total: 0 }),
    } as Response);

    await searchSymbols("TATA");

    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/api/symbols/search");
  });

  it("builds the exact search URL shape (path + q + limit)", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ results: [], query: "TATA", total: 0 }),
    } as Response);

    await searchSymbols("TATA", 5);

    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/api/symbols/search?q=TATA&limit=5");
  });

  it("preserves full result fields (symbol/name/isin)", async () => {
    const results = [{ symbol: "RELIANCE", name: "Reliance Industries Ltd", isin: "INE002A01018" }];
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ results, query: "REL", total: 1 }),
    } as Response);

    await expect(searchSymbols("REL")).resolves.toEqual(results);
  });

  it("returns empty array when results is null", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mockedFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ results: null, query: "x", total: 0 }),
      } as unknown as Response);

      await expect(searchSymbols("x")).resolves.toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it("returns empty array when the response body is null", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mockedFetch.mockResolvedValue({
        ok: true,
        json: async () => null,
      } as unknown as Response);

      await expect(searchSymbols("x")).resolves.toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it("returns empty array when json() rejects (malformed body)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mockedFetch.mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error("bad json");
        },
      } as unknown as Response);

      await expect(searchSymbols("TATA")).resolves.toEqual([]);
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("returns empty array on 404 without throwing", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mockedFetch.mockResolvedValue({ ok: false, status: 404 } as Response);

      await expect(searchSymbols("NOPE")).resolves.toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
});
