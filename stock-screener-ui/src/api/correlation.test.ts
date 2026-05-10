import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../state/auth", () => ({
  fetchWithAuth: vi.fn(),
}));

import { fetchWithAuth } from "../state/auth";
import { fetchCorrelation } from "./correlation";

const mockFetchWithAuth = vi.mocked(fetchWithAuth);

describe("Correlation API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends POST with symbols, timeframe, period", async () => {
    mockFetchWithAuth.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        matrix: [[1]],
        symbols: ["RELIANCE"],
        normalized: {},
        meta: { start_date: "2024-01-01", end_date: "2024-01-31", data_points: 20 },
      }),
    } as any);

    await fetchCorrelation({
      symbols: ["RELIANCE"],
      timeframe: "daily",
      period: 30,
      period_unit: "days",
    });

    expect(mockFetchWithAuth).toHaveBeenCalledWith(
      expect.stringContaining("/api/correlation"),
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: expect.stringContaining('"symbols":["RELIANCE"]'),
      }),
    );
  });

  it("throws on non-ok response", async () => {
    mockFetchWithAuth.mockResolvedValue({
      ok: false,
      json: vi.fn().mockResolvedValue({ detail: "Invalid request" }),
    } as any);

    await expect(
      fetchCorrelation({
        symbols: ["RELIANCE"],
        timeframe: "daily",
        period: 30,
        period_unit: "days",
      }),
    ).rejects.toThrow("Invalid request");
  });

  it("returns matrix, symbols, normalized, meta", async () => {
    const response = {
      matrix: [[1, 0.5], [0.5, 1]],
      symbols: ["RELIANCE", "TCS"],
      normalized: {
        RELIANCE: [{ timestamp: "2024-01-01", value: 100 }],
        TCS: [{ timestamp: "2024-01-01", value: 200 }],
      },
      meta: { start_date: "2024-01-01", end_date: "2024-01-31", data_points: 20 },
    };
    mockFetchWithAuth.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(response),
    } as any);

    const result = await fetchCorrelation({
      symbols: ["RELIANCE", "TCS"],
      timeframe: "daily",
      period: 30,
      period_unit: "days",
    });

    expect(result.matrix).toEqual(response.matrix);
    expect(result.symbols).toEqual(response.symbols);
    expect(result.normalized).toEqual(response.normalized);
    expect(result.meta).toEqual(response.meta);
  });
});
