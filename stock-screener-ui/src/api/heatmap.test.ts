import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchHeatmapData, fetchHeatmapSectors, refreshHeatmapCache } from "./heatmap";

const HEATMAP_BASE = "http://localhost:8765/api/heatmap";

function mockFetchOnce(response: Partial<Response> & { json?: () => Promise<any> }) {
  const mock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({}),
    ...response,
  } as Response);
  vi.stubGlobal("fetch", mock);
  return mock;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("fetchHeatmapData", () => {
  it("builds URL with min_pe, max_pe, sector, limit", async () => {
    const f = mockFetchOnce({ ok: true, json: async () => ({ stocks: [], count: 0, cached: false }) });
    await fetchHeatmapData(10, 30, "Technology", 100);
    const url = f.mock.calls[0][0] as string;
    expect(url).toContain(`${HEATMAP_BASE}/pe?`);
    expect(url).toContain("min_pe=10");
    expect(url).toContain("max_pe=30");
    expect(url).toContain("sector=Technology");
    expect(url).toContain("limit=100");
  });

  it("defaults limit to 500", async () => {
    const f = mockFetchOnce({ ok: true, json: async () => ({ stocks: [], count: 0, cached: false }) });
    await fetchHeatmapData();
    const url = f.mock.calls[0][0] as string;
    expect(url).toContain("limit=500");
  });

  it("omits undefined filters", async () => {
    const f = mockFetchOnce({ ok: true, json: async () => ({ stocks: [], count: 0, cached: false }) });
    await fetchHeatmapData(undefined, undefined, undefined, 200);
    const url = f.mock.calls[0][0] as string;
    expect(url).not.toContain("min_pe");
    expect(url).not.toContain("max_pe");
    expect(url).not.toContain("sector");
    expect(url).toContain("limit=200");
  });

  it("passes AbortSignal", async () => {
    const controller = new AbortController();
    const f = mockFetchOnce({ ok: true, json: async () => ({ stocks: [], count: 0, cached: false }) });
    await fetchHeatmapData(5, 10, undefined, 500, controller.signal);
    expect(f.mock.calls[0][1]).toMatchObject({ signal: controller.signal });
  });

  it("returns json on success", async () => {
    const payload = { stocks: [{ symbol: "INFY" }], count: 1, cached: true };
    mockFetchOnce({ ok: true, json: async () => payload });
    const result = await fetchHeatmapData();
    expect(result).toEqual(payload);
  });

  it("throws with detail from error body", async () => {
    mockFetchOnce({ ok: false, json: async () => ({ detail: "Bad request" }) } as any);
    await expect(fetchHeatmapData()).rejects.toThrow("Bad request");
  });

  it("throws fallback when json lacks detail", async () => {
    mockFetchOnce({ ok: false, json: async () => ({}) } as any);
    await expect(fetchHeatmapData()).rejects.toThrow("Failed to fetch heatmap data");
  });

  it("throws fallback when json() rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => { throw new Error("parse"); } } as unknown as Response));
    await expect(fetchHeatmapData()).rejects.toThrow("Failed to fetch heatmap data");
  });
});

describe("fetchHeatmapSectors", () => {
  it("calls /sectors with signal", async () => {
    const controller = new AbortController();
    const f = mockFetchOnce({ ok: true, json: async () => ({ sectors: [] }) });
    await fetchHeatmapSectors(controller.signal);
    expect(f.mock.calls[0][0]).toBe(`${HEATMAP_BASE}/sectors`);
    expect(f.mock.calls[0][1]).toMatchObject({ signal: controller.signal });
  });

  it("returns sectors", async () => {
    const data = { sectors: [{ name: "Tech", count: 10, avg_pe: 22 }] };
    mockFetchOnce({ ok: true, json: async () => data });
    const result = await fetchHeatmapSectors();
    expect(result).toEqual(data);
  });

  it("throws with detail on 401", async () => {
    mockFetchOnce({ ok: false, status: 401, statusText: "Unauthorized", json: async () => ({ detail: "Unauthorized" }) } as any);
    await expect(fetchHeatmapSectors()).rejects.toThrow("Unauthorized");
  });

  it("throws fallback on non-ok without detail", async () => {
    mockFetchOnce({ ok: false, json: async () => ({}) } as any);
    await expect(fetchHeatmapSectors()).rejects.toThrow("Failed to fetch sectors");
  });
});

describe("refreshHeatmapCache", () => {
  it("sends POST to /refresh", async () => {
    const f = mockFetchOnce({ ok: true, json: async () => ({ status: "ok", count: 10 }) });
    const result = await refreshHeatmapCache();
    expect(f.mock.calls[0][0]).toBe(`${HEATMAP_BASE}/refresh`);
    expect(f.mock.calls[0][1]).toMatchObject({ method: "POST" });
    expect(result).toEqual({ status: "ok", count: 10 });
  });

  it("throws on error with detail", async () => {
    mockFetchOnce({ ok: false, json: async () => ({ detail: "Failed to refresh cache" }) } as any);
    await expect(refreshHeatmapCache()).rejects.toThrow("Failed to refresh cache");
  });

  it("passes signal", async () => {
    const controller = new AbortController();
    const f = mockFetchOnce({ ok: true, json: async () => ({ status: "ok", count: 1 }) });
    await refreshHeatmapCache(controller.signal);
    expect(f.mock.calls[0][1]).toMatchObject({ signal: controller.signal });
  });

  it("maps 401 to error envelope", async () => {
    mockFetchOnce({ ok: false, status: 401, json: async () => ({ detail: "Unauthorized" }) } as any);
    await expect(refreshHeatmapCache()).rejects.toThrow("Unauthorized");
  });
});
