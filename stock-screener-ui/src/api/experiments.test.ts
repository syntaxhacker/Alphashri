import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../state/experiments", () => ({
  setStrategies: vi.fn(),
  setSessions: vi.fn(),
  setSessionState: vi.fn(),
  setResults: vi.fn(),
  setChartData: vi.fn(),
  setError: vi.fn(),
}));

vi.mock("../state/auth", () => ({
  fetchWithAuth: vi.fn(),
}));

vi.mock("@/ui", () => ({
  showError: vi.fn(),
}));

import { fetchWithAuth } from "../state/auth";
import { setStrategies, setSessions, setSessionState, setResults, setChartData, setError } from "../state/experiments";
import {
  getSweepGridSize,
  fetchStrategies,
  fetchSessions,
  fetchSessionState,
  fetchResults,
  startExperiment,
  pauseExperiment,
  resumeExperiment,
  cancelExperiment,
  fetchRunChart,
} from "./experiments";

const mockedFetch = vi.mocked(fetchWithAuth);
const mockedSetStrategies = vi.mocked(setStrategies);
const mockedSetSessions = vi.mocked(setSessions);
const mockedSetSessionState = vi.mocked(setSessionState);
const mockedSetResults = vi.mocked(setResults);
const mockedSetChartData = vi.mocked(setChartData);
const mockedSetError = vi.mocked(setError);

beforeEach(() => vi.clearAllMocks());

describe("getSweepGridSize", () => {
  it("returns 1 for empty sweeps", () => expect(getSweepGridSize([])).toBe(1));
  it("returns 1 when all sweeps empty values", () => expect(getSweepGridSize([{ key: "a", label: "A", values: [] }])).toBe(1));
  it("calculates product", () => {
    expect(getSweepGridSize([{ key: "a", label: "A", values: [1, 2] }, { key: "b", label: "B", values: [3, 4, 5] }])).toBe(6);
  });
  it("ignores empty sweeps in product", () => {
    expect(getSweepGridSize([{ key: "a", label: "A", values: [1, 2] }, { key: "b", label: "B", values: [] }])).toBe(2);
  });
  it("single sweep size", () => expect(getSweepGridSize([{ key: "a", label: "A", values: [1, 2, 3] }])).toBe(3));
});

describe("fetchStrategies", () => {
  it("fetches and sets strategies on success", async () => {
    const strategies = [{ key: "orb", params: [] }];
    mockedFetch.mockResolvedValue({ ok: true, json: async () => ({ strategies }) } as Response);
    const result = await fetchStrategies();
    expect(result).toEqual(strategies);
    expect(mockedFetch).toHaveBeenCalledWith(expect.stringContaining("/api/experiments/strategies"));
    expect(mockedSetStrategies).toHaveBeenCalledWith(strategies);
    // should call fetchWithAuth with GET url
    const url = mockedFetch.mock.calls[0][0] as string;
    expect(url).toContain("/api/experiments/strategies");
  });

  it("handles array data.strategies missing -> empty", async () => {
    mockedFetch.mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
    const result = await fetchStrategies();
    expect(result).toEqual([]);
    expect(mockedSetStrategies).toHaveBeenCalledWith([]);
  });

  it("returns [] and sets error on non-ok with detail", async () => {
    mockedFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({ detail: "Server error" }) } as Response);
    const result = await fetchStrategies();
    expect(result).toEqual([]);
    expect(mockedSetError).toHaveBeenCalledWith("Server error");
  });

  it("uses body.error fallback", async () => {
    mockedFetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "Bad request" }) } as Response);
    await fetchStrategies();
    expect(mockedSetError).toHaveBeenCalledWith("Bad request");
  });

  it("uses status fallback when body has no detail/error", async () => {
    mockedFetch.mockResolvedValue({ ok: false, status: 422, json: async () => ({}) } as Response);
    await fetchStrategies();
    expect(mockedSetError).toHaveBeenCalledWith(expect.stringContaining("422"));
  });

  it("handles json parse failure in parseError", async () => {
    mockedFetch.mockResolvedValue({ ok: false, status: 500, json: async () => { throw new Error("parse fail"); } } as Response);
    const result = await fetchStrategies();
    expect(result).toEqual([]);
    expect(mockedSetError).toHaveBeenCalledWith(expect.stringContaining("500"));
  });

  it("catches network error and returns []", async () => {
    mockedFetch.mockRejectedValue(new Error("Network error"));
    const result = await fetchStrategies();
    expect(result).toEqual([]);
    expect(mockedSetError).toHaveBeenCalledWith("Network error");
  });

  it("handles non-Error thrown", async () => {
    mockedFetch.mockRejectedValue("string error");
    const result = await fetchStrategies();
    expect(result).toEqual([]);
    expect(mockedSetError).toHaveBeenCalledWith(expect.stringContaining("Failed to fetch strategies"));
  });
});

describe("fetchSessions", () => {
  it("fetches array sessions directly", async () => {
    const sessions = [{ session: "s1" }];
    mockedFetch.mockResolvedValue({ ok: true, json: async () => sessions } as Response);
    const result = await fetchSessions();
    expect(result).toEqual(sessions);
    expect(mockedSetSessions).toHaveBeenCalledWith(sessions);
    expect(mockedFetch).toHaveBeenCalledWith(expect.stringContaining("/api/experiments/list"));
  });

  it("fetches sessions wrapped in {sessions: []}", async () => {
    const sessions = [{ session: "s1" }];
    mockedFetch.mockResolvedValue({ ok: true, json: async () => ({ sessions }) } as Response);
    const result = await fetchSessions();
    expect(result).toEqual(sessions);
  });

  it("returns [] on non-ok", async () => {
    mockedFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({ detail: "err" }) } as Response);
    expect(await fetchSessions()).toEqual([]);
    expect(mockedSetError).toHaveBeenCalled();
  });

  it("network error -> []", async () => {
    mockedFetch.mockRejectedValue(new Error("Network error"));
    expect(await fetchSessions()).toEqual([]);
  });
});

describe("fetchSessionState", () => {
  it("fetches state and sets", async () => {
    const state = { status: "running" };
    mockedFetch.mockResolvedValue({ ok: true, json: async () => state } as Response);
    const result = await fetchSessionState("sess1");
    expect(result).toEqual(state);
    expect(mockedSetSessionState).toHaveBeenCalledWith(state);
    expect(mockedFetch).toHaveBeenCalledWith(expect.stringContaining("/api/experiments/sess1/state"));
  });

  it("returns null on non-ok", async () => {
    mockedFetch.mockResolvedValue({ ok: false, status: 404, json: async () => ({ detail: "Not found" }) } as Response);
    expect(await fetchSessionState("bad")).toBeNull();
    expect(mockedSetError).toHaveBeenCalled();
  });

  it("network error -> null", async () => {
    mockedFetch.mockRejectedValue(new Error("fail"));
    expect(await fetchSessionState("s1")).toBeNull();
  });
});

describe("fetchResults", () => {
  it("fetches array runs", async () => {
    const runs = [{ run: 1 }];
    mockedFetch.mockResolvedValue({ ok: true, json: async () => runs } as Response);
    const result = await fetchResults("s1");
    expect(result).toEqual(runs);
    expect(mockedSetResults).toHaveBeenCalledWith(runs);
  });

  it("fetches wrapped {runs: []}", async () => {
    const runs = [{ run: 1 }];
    mockedFetch.mockResolvedValue({ ok: true, json: async () => ({ runs }) } as Response);
    expect(await fetchResults("s1")).toEqual(runs);
  });

  it("null on non-ok", async () => {
    mockedFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({ detail: "err" }) } as Response);
    expect(await fetchResults("s1")).toBeNull();
  });

  it("null on network error", async () => {
    mockedFetch.mockRejectedValue(new Error("fail"));
    expect(await fetchResults("s1")).toBeNull();
  });
});

describe("startExperiment", () => {
  const payload = { session: "exp1", strategy: "orb", symbols: ["RELIANCE"], tf: 5, param_space: { sl_pct: 1 } };

  it("sends POST with JSON body and returns session", async () => {
    mockedFetch.mockResolvedValue({ ok: true, json: async () => ({ session: "exp1" }) } as Response);
    const result = await startExperiment(payload);
    expect(result).toEqual({ session: "exp1" });
    expect(mockedFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/experiments/start"),
      expect.objectContaining({ method: "POST", body: JSON.stringify(payload) }),
    );
    const opts = mockedFetch.mock.calls[0][1] as RequestInit;
    expect((opts.headers as any)["Content-Type"]).toBe("application/json");
  });

  it("returns data directly when no session field", async () => {
    const data = { ok: true, id: 123 };
    mockedFetch.mockResolvedValue({ ok: true, json: async () => data } as Response);
    expect(await startExperiment(payload)).toEqual(data);
  });

  it("returns null when data.error present and sets error", async () => {
    mockedFetch.mockResolvedValue({ ok: true, json: async () => ({ error: "Strategy not found" }) } as Response);
    expect(await startExperiment(payload)).toBeNull();
    expect(mockedSetError).toHaveBeenCalledWith("Strategy not found");
  });

  it("returns null on non-ok and sets error", async () => {
    mockedFetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({ detail: "Bad payload" }) } as Response);
    expect(await startExperiment(payload)).toBeNull();
    expect(mockedSetError).toHaveBeenCalledWith("Bad payload");
  });

  it("null on network error", async () => {
    mockedFetch.mockRejectedValue(new Error("Network error"));
    expect(await startExperiment(payload)).toBeNull();
    expect(mockedSetError).toHaveBeenCalledWith("Network error");
  });

  it("url contains /api/experiments/start and method POST", async () => {
    mockedFetch.mockResolvedValue({ ok: true, json: async () => ({ session: "x" }) } as Response);
    await startExperiment(payload);
    const [url, opts] = mockedFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/experiments/start");
    expect(opts.method).toBe("POST");
  });
});

describe("control experiments pause/resume/cancel", () => {
  it.each([
    ["pause", pauseExperiment],
    ["resume", resumeExperiment],
    ["cancel", cancelExperiment],
  ] as const)("%s sends POST and returns true on ok", async (action, fn) => {
    mockedFetch.mockResolvedValue({ ok: true } as Response);
    expect(await fn("sess1")).toBe(true);
    expect(mockedFetch).toHaveBeenCalledWith(expect.stringContaining(`/api/experiments/sess1/${action}`), expect.objectContaining({ method: "POST" }));
  });

  it("pause returns false on non-ok and sets error", async () => {
    mockedFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({ detail: "err" }) } as Response);
    expect(await pauseExperiment("s1")).toBe(false);
    expect(mockedSetError).toHaveBeenCalled();
  });

  it("resume returns false on network error", async () => {
    mockedFetch.mockRejectedValue(new Error("fail"));
    expect(await resumeExperiment("s1")).toBe(false);
    expect(mockedSetError).toHaveBeenCalled();
  });

  it("cancel handles json parse failure in parseError", async () => {
    mockedFetch.mockResolvedValue({ ok: false, status: 500, json: async () => { throw new Error("x"); } } as Response);
    expect(await cancelExperiment("s1")).toBe(false);
  });
});

describe("fetchRunChart", () => {
  it("fetches chart with encoded symbol and sets", async () => {
    const data = { candles: [] };
    mockedFetch.mockResolvedValue({ ok: true, json: async () => data } as Response);
    const result = await fetchRunChart("sess1", 42, "RELIANCE");
    expect(result).toEqual(data);
    expect(mockedSetChartData).toHaveBeenCalledWith(data);
    expect(mockedFetch).toHaveBeenCalledWith(expect.stringContaining("/api/experiments/sess1/chart/42?symbol=RELIANCE"));
  });

  it("encodes symbol correctly", async () => {
    mockedFetch.mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
    await fetchRunChart("s1", "run-1", "M&M");
    const url = mockedFetch.mock.calls[0][0] as string;
    expect(url).toContain("symbol=M%26M");
  });

  it("returns null on non-ok", async () => {
    mockedFetch.mockResolvedValue({ ok: false, status: 404, json: async () => ({ detail: "Not found" }) } as Response);
    expect(await fetchRunChart("s1", 1, "RELIANCE")).toBeNull();
    expect(mockedSetError).toHaveBeenCalled();
  });

  it("null on network error", async () => {
    mockedFetch.mockRejectedValue(new Error("fail"));
    expect(await fetchRunChart("s1", 1, "RELIANCE")).toBeNull();
  });

  it("asserts URL+method correct (GET by default)", async () => {
    mockedFetch.mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
    await fetchRunChart("sess", 99, "TCS");
    const url = mockedFetch.mock.calls[0][0] as string;
    expect(url).toContain("/api/experiments/sess/chart/99");
    // fetchWithAuth default method is GET when no method specified
    expect(mockedFetch).toHaveBeenCalledWith(expect.stringContaining("/api/experiments/sess/chart/99"));
  });
});
