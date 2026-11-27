import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAgriFiltersUrl,
  buildAgriPricesUrl,
  fetchAgriFilters,
  fetchAgriPrices,
  fetchAgriSources,
} from "./agri";

const fakeFetch = vi.fn();

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500): Response {
  return {
    ok,
    status,
    headers: new Headers(),
    json: async () => body,
  } as Response;
}

function paramsOf(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

beforeEach(() => {
  fakeFetch.mockReset();
  vi.stubGlobal("fetch", fakeFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildAgriFiltersUrl", () => {
  it("sends only the source whitelist entry when a release is selected", () => {
    const url = buildAgriFiltersUrl({ source: "release:data-2026-11" });
    expect(url).toContain("/api/agri/filters?");
    expect([...paramsOf(url).keys()]).toEqual(["source"]);
    expect(paramsOf(url).get("source")).toBe("release:data-2026-11");
  });

  it("omits local and blank sources", () => {
    expect(buildAgriFiltersUrl({ source: "local" })).toBe(
      buildAgriFiltersUrl({ source: "   " }),
    );
    expect(buildAgriFiltersUrl({ source: "local" })).not.toContain("?");
    expect([...paramsOf(buildAgriFiltersUrl({ source: "" })).keys()]).toEqual([]);
  });
});

describe("buildAgriPricesUrl", () => {
  it("sends a non-local source alongside the other filters", () => {
    const params = paramsOf(
      buildAgriPricesUrl({ commodity: "rice", source: "release:data-2026-11", range: "1m" }),
    );
    expect(params.get("source")).toBe("release:data-2026-11");
    expect(params.get("commodity")).toBe("rice");
    expect(params.get("range")).toBe("1m");
  });

  it("does not send a local or blank source", () => {
    expect([...paramsOf(buildAgriPricesUrl({ source: "local" })).keys()]).toEqual([]);
    expect([...paramsOf(buildAgriPricesUrl({ source: "  " })).keys()]).toEqual([]);
  });

  it("sends every supported filter", () => {
    const url = buildAgriPricesUrl({
      commodity: "rice",
      group: "cereals",
      state: "Maharashtra",
      district: "Pune",
      market: "Pune",
      range: "1m",
      from: "2026-01-01",
      to: "2026-03-01",
      limit: 50,
    });
    expect(url).toContain("/api/agri/prices?");
    const params = paramsOf(url);
    expect(params.get("commodity")).toBe("rice");
    expect(params.get("group")).toBe("cereals");
    expect(params.get("state")).toBe("Maharashtra");
    expect(params.get("district")).toBe("Pune");
    expect(params.get("market")).toBe("Pune");
    expect(params.get("range")).toBe("1m");
    expect(params.get("from")).toBe("2026-01-01");
    expect(params.get("to")).toBe("2026-03-01");
    expect(params.get("limit")).toBe("50");
  });

  it("comma-joins a compare list", () => {
    const params = paramsOf(buildAgriPricesUrl({ compare: ["wheat", "moong", " "], limit: 10 }));
    expect(params.get("compare")).toBe("wheat,moong");
  });

  it("keeps an already comma-joined compare string", () => {
    const params = paramsOf(buildAgriPricesUrl({ compare: "rice,wheat" }));
    expect(params.get("compare")).toBe("rice,wheat");
  });

  it("omits empty filters and leaves no dangling question mark", () => {
    const url = buildAgriPricesUrl({
      commodity: "",
      group: "   ",
      state: "",
      district: "",
      market: "",
      range: "",
      from: "",
      to: "",
      compare: [],
      limit: 0,
    });
    expect(url.endsWith("/api/agri/prices")).toBe(true);
    expect(url).not.toContain("?");
    expect([...paramsOf(url).keys()]).toEqual([]);
  });

  it("treats a bare commodity string as the legacy call shape", () => {
    const params = paramsOf(buildAgriPricesUrl("arhar_tur"));
    expect(params.get("commodity")).toBe("arhar_tur");
    expect([...params.keys()]).toEqual(["commodity"]);
  });
});

describe("fetchAgriPrices", () => {
  it("calls the prices endpoint with built params and returns the payload", async () => {
    const body = { ok: true, kpis: { modal: 2400 }, series: [], snapshot: [] };
    fakeFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await fetchAgriPrices({ commodity: "rice", range: "3m", limit: 20 });

    expect(fakeFetch.mock.calls[0][0]).toContain("/api/agri/prices?");
    expect(paramsOf(fakeFetch.mock.calls[0][0] as string).get("commodity")).toBe("rice");
    expect(paramsOf(fakeFetch.mock.calls[0][0] as string).get("range")).toBe("3m");
    expect(result).toEqual(body);
  });

  it("forwards the abort signal", async () => {
    fakeFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const controller = new AbortController();

    await fetchAgriPrices({ commodity: "rice" }, controller.signal);

    expect(fakeFetch.mock.calls[0][1]).toMatchObject({ signal: controller.signal });
  });

  it("throws the server detail on a failed request", async () => {
    fakeFetch.mockResolvedValueOnce(jsonResponse({ detail: "agri unavailable" }, false, 503));

    await expect(fetchAgriPrices({ commodity: "rice" })).rejects.toThrow("agri unavailable");
  });
});

describe("fetchAgriFilters", () => {
  it("calls the filters endpoint and forwards the signal", async () => {
    const body = {
      ok: true,
      as_of: "2026-11-22",
      freshness_days: 1,
      commodities: [],
      groups: [],
      states: [],
      districts: [],
      markets: [],
    };
    fakeFetch.mockResolvedValueOnce(jsonResponse(body));
    const controller = new AbortController();

    const result = await fetchAgriFilters(controller.signal);

    expect(fakeFetch.mock.calls[0][0]).toContain("/api/agri/filters");
    expect(fakeFetch.mock.calls[0][1]).toMatchObject({ signal: controller.signal });
    expect(result).toEqual(body);
  });

  it("throws on an error response", async () => {
    fakeFetch.mockResolvedValueOnce(jsonResponse({ detail: "filters down" }, false, 500));
    await expect(fetchAgriFilters()).rejects.toThrow("filters down");
  });

  it("passes a selected source to the filters URL", async () => {
    fakeFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const controller = new AbortController();

    await fetchAgriFilters(controller.signal, "release:data-2026-11");

    expect(paramsOf(fakeFetch.mock.calls[0][0] as string).get("source")).toBe(
      "release:data-2026-11",
    );
  });

  it("accepts a source before the abort signal", async () => {
    fakeFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const controller = new AbortController();

    await fetchAgriFilters("release:data-2026-11", controller.signal);

    expect(paramsOf(fakeFetch.mock.calls[0][0] as string).get("source")).toBe(
      "release:data-2026-11",
    );
    expect(fakeFetch.mock.calls[0][1]).toMatchObject({ signal: controller.signal });
  });
});

describe("fetchAgriSources", () => {
  const body = {
    default: "local",
    sources: [
      { id: "local", label: "Local cache", dataset: "local", as_of: "2026-11-21", rows: 2328450, status: "available" },
      { id: "release:data-2026-11", label: "Release data-2026-11", dataset: "data-2026-11", as_of: "2026-11-21", rows: 42, status: "available" },
    ],
  };

  it("fetches and parses the source registry", async () => {
    fakeFetch.mockResolvedValueOnce(jsonResponse(body));
    const controller = new AbortController();

    const result = await fetchAgriSources(controller.signal);

    expect(fakeFetch.mock.calls[0][0]).toContain("/api/agri/sources");
    expect(fakeFetch.mock.calls[0][1]).toMatchObject({ signal: controller.signal });
    expect(result.sources.map((source) => source.id)).toEqual(["local", "release:data-2026-11"]);
    expect(result.sources[1]).toMatchObject({ dataset: "data-2026-11", rows: 42 });
    expect(result.default).toBe("local");
  });

  it("throws the server detail on a failed request", async () => {
    fakeFetch.mockResolvedValueOnce(jsonResponse({ detail: "sources down" }, false, 503));
    await expect(fetchAgriSources()).rejects.toThrow("sources down");
  });
});
