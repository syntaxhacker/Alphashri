// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach } from "vitest";
import { buildValueScanUrl, valueScan, VALUE_PRESETS } from "./valueScan";
import { fetchWithAuth } from "../state/auth";

vi.mock("../state/auth", () => ({
  fetchWithAuth: vi.fn(),
}));

const mockFetchWithAuth = vi.mocked(fetchWithAuth);

function mockResponse(ok: boolean, body: unknown, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildValueScanUrl", () => {
  test("always sends market and limit defaults", () => {
    const url = buildValueScanUrl({});
    expect(url).toContain("/api/value/scan?");
    expect(url).toContain("market=india");
    expect(url).toContain("limit=100");
  });

  test("sends preset, market, and numeric filters", () => {
    const url = buildValueScanUrl({
      market: "usa",
      preset: "DEEP",
      limit: 50,
      max_pe: 15,
      min_roe: 12,
      sort: "score_desc",
    });
    expect(url).toContain("market=usa");
    expect(url).toContain("preset=DEEP");
    expect(url).toContain("limit=50");
    expect(url).toContain("max_pe=15");
    expect(url).toContain("min_roe=12");
    expect(url).toContain("sort=score_desc");
  });

  test("omits empty filters and joins sectors", () => {
    const url = buildValueScanUrl({
      max_pe: undefined,
      min_roe: undefined,
      preset: "",
      sort: "",
      require_low_de: false,
      above_200dma: true,
      sectors: ["Banks", "IT"],
    });
    expect(url).not.toContain("max_pe");
    expect(url).not.toContain("min_roe");
    expect(url).not.toContain("preset");
    expect(url).not.toContain("sort");
    expect(url).not.toContain("require_low_de");
    expect(url).toContain("above_200dma=true");
    expect(url).toContain(`sectors=${encodeURIComponent("Banks,IT")}`);
  });

  test("omits empty sector list and NaN numbers", () => {
    const url = buildValueScanUrl({ sectors: [], max_ps: Number.NaN });
    expect(url).not.toContain("sectors");
    expect(url).not.toContain("max_ps");
  });
});

describe("valueScan", () => {
  test("returns parsed JSON on success", async () => {
    const body = { market: "india", rows: [], sectors: [], warnings: [] };
    mockFetchWithAuth.mockResolvedValueOnce(mockResponse(true, body));
    const result = await valueScan({ market: "india", max_pe: 20 });
    expect(result).toEqual(body);
    const calledUrl = mockFetchWithAuth.mock.calls[0][0] as string;
    expect(calledUrl).toContain("market=india");
    expect(calledUrl).toContain("max_pe=20");
  });

  test("throws the server detail on !ok", async () => {
    mockFetchWithAuth.mockResolvedValueOnce(mockResponse(false, { detail: "bad preset" }, 400));
    await expect(valueScan({ preset: "NOPE" })).rejects.toThrow("bad preset");
  });

  test("throws HTTP status when no detail is present", async () => {
    mockFetchWithAuth.mockResolvedValueOnce(mockResponse(false, {}, 500));
    await expect(valueScan({})).rejects.toThrow("500");
  });

  test("forwards AbortSignal via init", async () => {
    mockFetchWithAuth.mockResolvedValueOnce(mockResponse(true, { rows: [] }));
    const controller = new AbortController();
    await valueScan({}, { signal: controller.signal });
    expect(mockFetchWithAuth.mock.calls[0][1]).toMatchObject({ signal: controller.signal });
  });
});

describe("VALUE_PRESETS", () => {
  test("covers all six presets with label + description", () => {
    for (const name of ["SERIOUS", "DEEP", "GARP_VALUE", "YIELD", "TURNAROUND", "NO_GATE"]) {
      expect(VALUE_PRESETS[name].label).toBeTruthy();
      expect(VALUE_PRESETS[name].description).toBeTruthy();
    }
  });
});
