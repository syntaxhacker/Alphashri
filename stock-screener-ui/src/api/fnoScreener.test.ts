// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach } from "vitest";
import { buildFnoScreenerUrl, fetchFnoScreener, FNO_PRESETS, type FnoScreenerPreset } from "./fnoScreener";
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

const baseBody = {
  status: "ok",
  as_of: "2026-11-10T14:30:00+05:30",
  expiry: "2026-11-20",
  expiries: [],
  preset: "balanced",
  scanned: 0,
  matched: 0,
  stale: false,
  warnings: [],
  errors: [],
  rows: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildFnoScreenerUrl", () => {
  test("omits empty params and includes only provided values", () => {
    const url = buildFnoScreenerUrl({
      preset: "high_pop",
      expiry: "2026-11-20",
      limit: 25,
      max_cost: 10000,
      min_pop: 60,
    });
    expect(url).toContain("/api/options/screener?");
    expect(url).toContain("preset=high_pop");
    expect(url).toContain("expiry=2026-11-20");
    expect(url).toContain("limit=25");
    expect(url).toContain("max_cost=10000");
    expect(url).toContain("min_pop=60");
    expect(url).not.toContain("min_volume");
    expect(url).not.toContain("otm_min");
    expect(url).not.toContain("otm_max");
    expect(url).not.toContain("refresh");
  });

  test("omits empty values entirely", () => {
    const url = buildFnoScreenerUrl({
      expiry: "",
      preset: "" as unknown as FnoScreenerPreset,
      limit: undefined,
      max_cost: undefined,
      min_pop: undefined,
      min_volume: undefined,
      otm_min: undefined,
      otm_max: undefined,
      refresh: false,
    });
    const search = url.split("?")[1];
    expect(search).toBe("");
    expect(url).not.toContain("expiry");
    expect(url).not.toContain("preset");
    expect(url).not.toContain("limit");
    expect(url).not.toContain("max_cost");
    expect(url).not.toContain("min_pop");
    expect(url).not.toContain("refresh");
  });

  test("omits NaN numbers and empty arrays/lists", () => {
    const url = buildFnoScreenerUrl({ max_cost: Number.NaN, min_pop: Number.NaN });
    expect(url).not.toContain("max_cost");
    expect(url).not.toContain("min_pop");
  });

  test("sends refresh=true only when refresh is set", () => {
    expect(buildFnoScreenerUrl({ refresh: true })).toContain("refresh=true");
    expect(buildFnoScreenerUrl({ refresh: false })).not.toContain("refresh");
    expect(buildFnoScreenerUrl({})).not.toContain("refresh");
  });

  test("encodes expiry with special characters", () => {
    const url = buildFnoScreenerUrl({ expiry: "2026-11-20 & weekly" });
    const parsed = new URLSearchParams(url.split("?")[1]);
    expect(parsed.get("expiry")).toBe("2026-11-20 & weekly");
    expect(parsed.get("preset")).toBeNull();
  });
});

describe("FNO_PRESETS", () => {
  test("covers all five presets with label + description", () => {
    for (const name of ["cheap_momentum", "max_torque", "balanced", "high_pop", "breakout"] as FnoScreenerPreset[]) {
      expect(FNO_PRESETS[name].label).toBeTruthy();
      expect(FNO_PRESETS[name].description).toBeTruthy();
    }
  });
});

describe("fetchFnoScreener", () => {
  test("calls fetchWithAuth with the built URL and returns parsed JSON", async () => {
    mockFetchWithAuth.mockResolvedValueOnce(mockResponse(true, baseBody));
    const result = await fetchFnoScreener({ preset: "balanced", max_cost: 5000 });
    expect(result).toEqual(baseBody);
    const calledUrl = mockFetchWithAuth.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/api/options/screener?");
    expect(calledUrl).toContain("preset=balanced");
    expect(calledUrl).toContain("max_cost=5000");
    expect(mockFetchWithAuth.mock.calls[0][1]?.signal).toBeUndefined();
  });

  test("omits empty params in the fetch URL", async () => {
    mockFetchWithAuth.mockResolvedValueOnce(mockResponse(true, baseBody));
    await fetchFnoScreener({});
    const calledUrl = mockFetchWithAuth.mock.calls[0][0] as string;
    expect(calledUrl).not.toContain("expiry");
    expect(calledUrl).not.toContain("preset");
    expect(calledUrl).not.toContain("limit");
  });

  test("throws the server detail on !ok", async () => {
    mockFetchWithAuth.mockResolvedValueOnce(mockResponse(false, { detail: "unknown preset" }, 400));
    await expect(fetchFnoScreener({ preset: "nope" as never })).rejects.toThrow("unknown preset");
  });

  test("throws HTTP status when no detail is present", async () => {
    mockFetchWithAuth.mockResolvedValueOnce(mockResponse(false, {}, 502));
    await expect(fetchFnoScreener({})).rejects.toThrow("502");
  });

  test("forwards AbortSignal via init", async () => {
    mockFetchWithAuth.mockResolvedValueOnce(mockResponse(true, baseBody));
    const controller = new AbortController();
    await fetchFnoScreener({}, { signal: controller.signal });
    expect(mockFetchWithAuth.mock.calls[0][1]).toMatchObject({ signal: controller.signal });
  });
});
