import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Only the transport is mocked: the real api/chartPatterns `getJson` and the
// real store are exercised, so the 401 can be observed after the store's
// `asApiError` wrapper (which previously downgraded it to network/0).
vi.mock("./auth", () => ({ fetchWithAuth: vi.fn() }));

import { fetchWithAuth } from "./auth";
import { getChartPatternsState, loadSummary, resetChartPatternsState } from "./chartPatterns";

const mockFetch = vi.mocked(fetchWithAuth);

function errorResponse(status: number, body: unknown): Response {
  return { ok: false, status, json: async () => body } as Response;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.clearAllMocks();
  resetChartPatternsState();
});

afterEach(() => {
  resetChartPatternsState();
});

describe("chartPatterns real API → store", () => {
  it("(c) a real 401 reaches the store as kind unauthorized (not network)", async () => {
    mockFetch.mockResolvedValue(errorResponse(401, { detail: "Session expired" }));

    await loadSummary();
    await flush();

    const state = getChartPatternsState();
    expect(state.apiError).toMatchObject({ status: 401, kind: "unauthorized" });
    expect(state.error).toBe("Session expired");
    expect(state.apiError?.message).toBe(state.error);
  });

  it("(d) a real successful load leaves no error", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ scanned: 1, patterns: 0, in_view: 0, confirmed: 0 }),
    } as Response);

    await loadSummary();
    await flush();

    expect(getChartPatternsState().apiError).toBeNull();
    expect(getChartPatternsState().error).toBeNull();
  });
});
