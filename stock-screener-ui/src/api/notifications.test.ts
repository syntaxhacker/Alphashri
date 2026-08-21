import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../state/auth", () => ({
  fetchWithAuth: vi.fn(),
  apiFetch: vi.fn(),
}));

import { apiFetch } from "../state/auth";
import { fetchSurges, recordSurge } from "./notifications";

const mockedApiFetch = vi.mocked(apiFetch);
const API_BASE = "http://localhost:8765";

beforeEach(() => vi.clearAllMocks());

describe("fetchSurges", () => {
  it("builds URL with limit and offset", async () => {
    mockedApiFetch.mockResolvedValue({ total: 5, events: [] });
    await fetchSurges(10, 0);
    expect(mockedApiFetch).toHaveBeenCalledWith(`${API_BASE}/api/notifications/surge?limit=10&offset=0`);
  });

  it("uses default limit/offset", async () => {
    mockedApiFetch.mockResolvedValue({ total: 0, events: [] });
    await fetchSurges();
    expect(mockedApiFetch).toHaveBeenCalledWith(`${API_BASE}/api/notifications/surge?limit=10&offset=0`);
  });

  it("propagates custom pagination", async () => {
    mockedApiFetch.mockResolvedValue({ total: 2, events: [{ id: 1 } as any] });
    const result = await fetchSurges(20, 5);
    expect(mockedApiFetch).toHaveBeenCalledWith(`${API_BASE}/api/notifications/surge?limit=20&offset=5`);
    expect(result).toEqual({ total: 2, events: [{ id: 1 }] });
  });

  it("throws envelope error with success:false shape when apiFetch rejects with 401", async () => {
    mockedApiFetch.mockRejectedValue(new Error("API 401: Unauthorized"));
    await expect(fetchSurges()).rejects.toThrow("API 401");
  });

  it("error envelope contains status text", async () => {
    mockedApiFetch.mockRejectedValue(new Error("API 500: Internal Server Error"));
    await expect(fetchSurges()).rejects.toThrow("Internal Server Error");
  });

  it("returns total and events", async () => {
    const payload = { total: 3, events: [{ symbol: "INFY", move_pct: 2.5 } as any] };
    mockedApiFetch.mockResolvedValue(payload);
    const result = await fetchSurges(10, 0);
    expect(result.total).toBe(3);
    expect(result.events[0].symbol).toBe("INFY");
  });
});

describe("recordSurge", () => {
  it("sends POST with JSON body and correct URL", async () => {
    mockedApiFetch.mockResolvedValue({});
    const data = { symbol: "TCS", move_pct: 3.1, direction: "up", screener_id: "1", screen_label: "Top Gainers" };
    await recordSurge(data);
    expect(mockedApiFetch).toHaveBeenCalledWith(
      `${API_BASE}/api/notifications/surge`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(data),
      }),
    );
  });

  it("includes optional price", async () => {
    mockedApiFetch.mockResolvedValue({});
    const data = { symbol: "TCS", move_pct: 1.2, direction: "up", price: 3200, screener_id: "1", screen_label: "L1" };
    await recordSurge(data);
    const body = JSON.parse((mockedApiFetch.mock.calls[0][1] as any).body);
    expect(body.price).toBe(3200);
  });

  it("throws on 401 error envelope", async () => {
    mockedApiFetch.mockRejectedValue(new Error("API 401: bad token"));
    await expect(recordSurge({ symbol: "A", move_pct: 1, direction: "up", screener_id: "x", screen_label: "y" })).rejects.toThrow("API 401");
  });

  it("throws on generic error", async () => {
    mockedApiFetch.mockRejectedValue(new Error("Network error"));
    await expect(recordSurge({ symbol: "A", move_pct: 1, direction: "up", screener_id: "x", screen_label: "y" })).rejects.toThrow("Network error");
  });

  it("returns void on success", async () => {
    mockedApiFetch.mockResolvedValue(undefined);
    await expect(recordSurge({ symbol: "X", move_pct: 2, direction: "down", screener_id: "s", screen_label: "lbl" })).resolves.toBeUndefined();
  });
});
