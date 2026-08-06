import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/experiments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/experiments")>();
  return {
    ...actual,
    fetchStrategies: vi.fn(),
    fetchSessions: vi.fn(),
    fetchSessionState: vi.fn(),
    fetchResults: vi.fn(),
    startExperiment: vi.fn(),
    pauseExperiment: vi.fn(),
    resumeExperiment: vi.fn(),
    cancelExperiment: vi.fn(),
    fetchRunChart: vi.fn(),
  };
});

import {
  getExperimentState,
  subscribe,
  resetExperimentState,
  setConfig,
  setFixedParam,
  setSweep,
  addSweepParam,
  removeSweepParam,
  resetConfig,
  fetchStrategies,
  fetchSessions,
  selectSession,
  fetchSessionState,
  fetchResults,
  startExperiment,
  pauseExperiment,
  resumeExperiment,
  cancelExperiment,
  fetchRunChart,
  selectRun,
  setError,
  setSessionState,
  setResults,
  setChartData,
  pollExperimentState,
  stopPolling,
} from "./experiments";
import { getSweepGridSize } from "../api/experiments";
import type { ExperimentStrategy, ExperimentRun, SweepParam } from "../types/experiments";

const api = vi.mocked(await import("../api/experiments"));

function makeStrategies(): ExperimentStrategy[] {
  return [
    {
      key: "orb",
      params: [
        { key: "or_minutes", label: "OR Minutes", type: "number", default: 45, min: 5, max: 120 },
        { key: "sl_pct", label: "Stop Loss %", type: "number", default: 1.0, min: 0.1 },
        { key: "enable_shorts", label: "Shorts", type: "boolean", default: false },
        { key: "pivot_type", label: "Pivot", type: "select", default: "classic", options: ["classic", "fibonacci"] },
      ],
    },
    {
      key: "ema_cross",
      params: [{ key: "fast", label: "Fast EMA", type: "number", default: 9 }],
    },
  ];
}

function makeRun(overrides: Partial<ExperimentRun> = {}): ExperimentRun {
  return {
    run: 1,
    metric: 1.5,
    metrics: {
      total_trades: 10,
      wins: 6,
      losses: 4,
      net_pnl: 1200,
      profit_factor: 1.5,
      win_rate: 60,
      tp_exits: 3,
      sl_exits: 5,
      eod_exits: 2,
    },
    per_symbol: {
      RELIANCE: {
        total_trades: 10,
        wins: 6,
        losses: 4,
        net_pnl: 1200,
        profit_factor: 1.5,
        win_rate: 60,
        tp_exits: 3,
        sl_exits: 5,
        eod_exits: 2,
      },
    },
    config: { or_minutes: 45 },
    strategy: "orb",
    symbols: ["RELIANCE"],
    tf: 5,
    status: "keep",
    description: "baseline",
    timestamp: 1700000000000,
    ...overrides,
  };
}

describe("experiments state", () => {
  beforeEach(() => {
    resetExperimentState();
    vi.clearAllMocks();
  });

  it("has correct initial state", () => {
    const state = getExperimentState();
    expect(state.strategies).toEqual([]);
    expect(state.loading.strategies).toBe(false);
    expect(state.sessions).toEqual([]);
    expect(state.loading.sessions).toBe(false);
    expect(state.activeSession).toBeNull();
    expect(state.config).toEqual({
      strategy: "orb",
      symbols: ["NEWGEN"],
      tf: 5,
      dateStart: "",
      dateEnd: "",
      includeCosts: true,
      description: "",
    });
    expect(state.fixedParams).toEqual({});
    expect(state.sweeps).toEqual([]);
    expect(state.state).toBeNull();
    expect(state.results).toBeNull();
    expect(state.selectedRun).toBeNull();
    expect(state.chartData).toBeNull();
    expect(state.loading.chart).toBe(false);
    expect(state.error).toBeNull();
  });

  it("returns unsubscribe function from subscribe", () => {
    const unsub = subscribe(vi.fn());
    expect(typeof unsub).toBe("function");
    unsub();
  });

  it("setConfig merges config fields", () => {
    setConfig({ tf: 15, includeCosts: false });
    const state = getExperimentState();
    expect(state.config.tf).toBe(15);
    expect(state.config.includeCosts).toBe(false);
    expect(state.config.strategy).toBe("orb");
  });

  it("setFixedParam updates a fixed param", () => {
    setFixedParam("sl_pct", 0.5);
    expect(getExperimentState().fixedParams.sl_pct).toBe(0.5);
  });

  it("addSweepParam moves param from fixedParams to sweeps", () => {
    setFixedParam("or_minutes", 30);
    addSweepParam("or_minutes");
    const state = getExperimentState();
    expect(state.sweeps).toHaveLength(1);
    expect(state.sweeps[0]).toMatchObject({ key: "or_minutes", values: [30] });
    expect(state.fixedParams.or_minutes).toBeUndefined();
  });

  it("addSweepParam uses param default when no fixed value", async () => {
    api.fetchStrategies.mockResolvedValueOnce(makeStrategies());
    await fetchStrategies();
    addSweepParam("sl_pct");
    const state = getExperimentState();
    expect(state.sweeps.find((s) => s.key === "sl_pct")).toMatchObject({
      key: "sl_pct",
      label: "Stop Loss %",
      values: [1.0],
    });
  });

  it("addSweepParam ignores duplicate keys", () => {
    setFixedParam("or_minutes", 30);
    addSweepParam("or_minutes");
    addSweepParam("or_minutes");
    expect(getExperimentState().sweeps).toHaveLength(1);
  });

  it("removeSweepParam restores last value to fixedParams", () => {
    setFixedParam("sl_pct", 1.0);
    addSweepParam("sl_pct");
    setSweep("sl_pct", [1.0, 2.0]);
    removeSweepParam("sl_pct");
    const state = getExperimentState();
    expect(state.sweeps).toHaveLength(0);
    expect(state.fixedParams.sl_pct).toBe(2.0);
  });

  it("setSweep updates values for matching key only", () => {
    setFixedParam("sl_pct", 1.0);
    setFixedParam("or_minutes", 45);
    addSweepParam("sl_pct");
    addSweepParam("or_minutes");
    setSweep("sl_pct", [1.0, 1.5, 2.0]);
    const state = getExperimentState();
    expect(state.sweeps.find((s) => s.key === "sl_pct")?.values).toEqual([1.0, 1.5, 2.0]);
    expect(state.sweeps.find((s) => s.key === "or_minutes")?.values).toEqual([45]);
  });

  it("resetConfig resets config, fixedParams, and sweeps", async () => {
    api.fetchStrategies.mockResolvedValueOnce(makeStrategies());
    await fetchStrategies();
    setConfig({ symbols: ["TCS"], description: "x" });
    setFixedParam("sl_pct", 0.5);
    addSweepParam("or_minutes");

    resetConfig();
    const state = getExperimentState();
    expect(state.config.symbols).toEqual(["NEWGEN"]);
    expect(state.config.description).toBe("");
    expect(state.config.strategy).toBe("orb");
    expect(state.fixedParams).toHaveProperty("or_minutes", 45);
    expect(state.sweeps).toEqual([]);
  });

  it("setError sets error", () => {
    setError("boom");
    expect(getExperimentState().error).toBe("boom");
  });

  it("setSessionState / setResults / setChartData update store", () => {
    const expState = { status: "running", current: 1, total: 4, best_pf: 1.2, best_desc: "", last_result: null, strategy: "orb", symbols: ["RELIANCE"], tf: 5 };
    setSessionState(expState);
    expect(getExperimentState().state).toEqual(expState);

    const run = makeRun();
    setResults([run]);
    expect(getExperimentState().results).toEqual([run]);

    const chartData = { symbol: "RELIANCE", candles: [], orb_zones: [], pivot_levels: [], week52_levels: [], trades: [], date_range: { start: "2026-01-01", end: "2026-01-02" }, total_candles: 0, total_trades: 0 };
    setChartData(chartData);
    expect(getExperimentState().chartData).toEqual(chartData);
  });
});

describe("getSweepGridSize", () => {
  it("returns 1 when no sweeps", () => {
    expect(getSweepGridSize([])).toBe(1);
  });

  it("returns 1 when all sweep lists are empty", () => {
    const sweeps: SweepParam[] = [{ key: "a", label: "A", values: [] }];
    expect(getSweepGridSize(sweeps)).toBe(1);
  });

  it("products non-empty sweep value list lengths", () => {
    const sweeps: SweepParam[] = [
      { key: "a", label: "A", values: [1, 2, 3] },
      { key: "b", label: "B", values: [0.5, 1.0] },
      { key: "c", label: "C", values: [] },
    ];
    expect(getSweepGridSize(sweeps)).toBe(6);
  });

  it("treats single-value sweep as 1 combo", () => {
    const sweeps: SweepParam[] = [{ key: "a", label: "A", values: [45] }];
    expect(getSweepGridSize(sweeps)).toBe(1);
  });
});

describe("experiments fetch actions", () => {
  beforeEach(() => {
    resetExperimentState();
    vi.clearAllMocks();
  });

  it("fetchStrategies populates strategies and builds param defaults", async () => {
    api.fetchStrategies.mockResolvedValueOnce(makeStrategies());

    await fetchStrategies();

    const state = getExperimentState();
    expect(state.strategies).toHaveLength(2);
    expect(state.loading.strategies).toBe(false);
    expect(state.config.strategy).toBe("orb");
    expect(state.fixedParams.or_minutes).toBe(45);
    expect(state.fixedParams.enable_shorts).toBe(false);
    // orb strategy gets a seeded default sweep so Start works immediately
    expect(state.sweeps).toHaveLength(1);
    expect(state.sweeps[0]).toMatchObject({
      key: "or_minutes",
      values: [5, 10, 15],
    });
  });

  it("fetchStrategies toggles strategies loading flag during fetch", async () => {
    let resolveFetch: (value: ExperimentStrategy[]) => void = () => {};
    const pending = new Promise<ExperimentStrategy[]>((resolve) => {
      resolveFetch = resolve;
    });
    api.fetchStrategies.mockReturnValueOnce(pending);

    const promise = fetchStrategies();

    // Loading flag is set synchronously when the fetch starts
    expect(getExperimentState().loading.strategies).toBe(true);

    resolveFetch(makeStrategies());
    await promise;

    // Loading flag is cleared once the fetch settles
    expect(getExperimentState().loading.strategies).toBe(false);
  });

  it("fetchStrategies keeps current strategy defaults when already selected", async () => {
    api.fetchStrategies.mockResolvedValueOnce(makeStrategies());
    setConfig({ strategy: "ema_cross" });

    await fetchStrategies();

    const state = getExperimentState();
    expect(state.config.strategy).toBe("ema_cross");
    expect(state.fixedParams.fast).toBe(9);
    expect(state.fixedParams.or_minutes).toBeUndefined();
  });

  it("fetchSessions populates sessions and clears loading", async () => {
    const sessions = [{ session: "s1", strategy: "orb", tf: 5, symbols: ["RELIANCE"], runs: 4, status: "completed" }];
    api.fetchSessions.mockResolvedValueOnce(sessions);

    await fetchSessions();

    expect(getExperimentState().sessions).toEqual(sessions);
    expect(getExperimentState().loading.sessions).toBe(false);
  });

  it("selectSession sets active session and fetches state + results", async () => {
    const expState = { status: "completed", current: 4, total: 4, best_pf: 1.6, best_desc: "best", last_result: null, strategy: "orb", symbols: ["RELIANCE"], tf: 5 };
    const run = makeRun();
    api.fetchSessionState.mockResolvedValueOnce(expState);
    api.fetchResults.mockResolvedValueOnce([run]);

    const result = await selectSession("s1");

    const state = getExperimentState();
    expect(result).toEqual(expState);
    expect(state.activeSession).toBe("s1");
    expect(api.fetchSessionState).toHaveBeenCalledWith("s1");
    expect(api.fetchResults).toHaveBeenCalledWith("s1");
    expect(state.results).toEqual([run]);
  });

  it("fetchSessionState delegates to api", async () => {
    const expState = { status: "running", current: 1, total: 4, best_pf: 1.0, best_desc: "", last_result: null, strategy: "orb", symbols: [], tf: 5 };
    api.fetchSessionState.mockResolvedValueOnce(expState);

    const result = await fetchSessionState("s1");

    expect(result).toEqual(expState);
    expect(api.fetchSessionState).toHaveBeenCalledWith("s1");
  });

  it("fetchResults delegates to api", async () => {
    const run = makeRun();
    api.fetchResults.mockResolvedValueOnce([run]);

    const result = await fetchResults("s1");

    expect(result).toEqual([run]);
    expect(api.fetchResults).toHaveBeenCalledWith("s1");
  });

  it("startExperiment builds param_space and selects returned session", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1);
    api.fetchStrategies.mockResolvedValueOnce(makeStrategies());
    await fetchStrategies();
    api.fetchSessions.mockResolvedValueOnce([]);
    api.startExperiment.mockResolvedValueOnce({ session: "exp_orb_1" });

    setConfig({ symbols: ["RELIANCE", "TCS"] });
    setFixedParam("or_minutes", 45);
    addSweepParam("sl_pct");
    setSweep("sl_pct", [1.0, 2.0]);

    const result = await startExperiment();

    expect(result).toEqual({ session: "exp_orb_1" });
    expect(api.startExperiment).toHaveBeenCalledWith(
      expect.objectContaining({
        session: "exp_orb_1",
        strategy: "orb",
        symbols: ["RELIANCE", "TCS"],
        tf: 5,
        param_space: expect.objectContaining({
          // or_minutes is swept (seeded default [5,10,15]); sl_pct swept to [1.0,2.0]
          or_minutes: [5, 10, 15],
          sl_pct: [1.0, 2.0],
          enable_shorts: false,
        }),
        include_costs: true,
      }),
    );
    expect(getExperimentState().activeSession).toBe("exp_orb_1");
    expect(api.fetchSessions).toHaveBeenCalled();
  });

  it("startExperiment returns null and sets error on failure", async () => {
    api.startExperiment.mockResolvedValueOnce(null);

    const result = await startExperiment();

    expect(result).toBeNull();
    expect(getExperimentState().activeSession).toBeNull();
  });

  it("pause/resume/cancel call api with active session", async () => {
    setActiveSessionViaSelect();

    api.pauseExperiment.mockResolvedValueOnce(true);
    api.fetchSessionState.mockResolvedValueOnce(null);
    await pauseExperiment();
    expect(api.pauseExperiment).toHaveBeenCalledWith("s1");

    api.resumeExperiment.mockResolvedValueOnce(true);
    await resumeExperiment();
    expect(api.resumeExperiment).toHaveBeenCalledWith("s1");

    api.cancelExperiment.mockResolvedValueOnce(true);
    await cancelExperiment();
    expect(api.cancelExperiment).toHaveBeenCalledWith("s1");
  });

  it("pauseExperiment returns false without active session", async () => {
    expect(await pauseExperiment()).toBe(false);
    expect(api.pauseExperiment).not.toHaveBeenCalled();
  });

  it("fetchRunChart returns null without active session", async () => {
    expect(await fetchRunChart(1, "RELIANCE")).toBeNull();
    expect(api.fetchRunChart).not.toHaveBeenCalled();
  });

  it("fetchRunChart delegates with active session", async () => {
    setActiveSessionViaSelect();
    const chartData = { symbol: "RELIANCE", candles: [], orb_zones: [], pivot_levels: [], week52_levels: [], trades: [], date_range: { start: "2026-01-01", end: "2026-01-02" }, total_candles: 0, total_trades: 0 };
    api.fetchRunChart.mockResolvedValueOnce(chartData);

    const result = await fetchRunChart(2, "RELIANCE");

    expect(result).toEqual(chartData);
    expect(api.fetchRunChart).toHaveBeenCalledWith("s1", 2, "RELIANCE");
  });

  it("selectRun sets selected run and fetches chart for first symbol", async () => {
    setActiveSessionViaSelect();
    const run = makeRun({ run: 3, symbols: ["RELIANCE", "TCS"] });
    const chartData = { symbol: "RELIANCE", candles: [], orb_zones: [], pivot_levels: [], week52_levels: [], trades: [], date_range: { start: "2026-01-01", end: "2026-01-02" }, total_candles: 0, total_trades: 0 };
    api.fetchRunChart.mockResolvedValueOnce(chartData);

    await selectRun(run);

    const state = getExperimentState();
    expect(state.selectedRun).toBe(run);
    expect(state.chartData).toEqual(chartData);
    expect(api.fetchRunChart).toHaveBeenCalledWith("s1", 3, "RELIANCE");
  });

  it("pollExperimentState returns true and stops on terminal status", async () => {
    const expState = { status: "completed", current: 4, total: 4, best_pf: 1.6, best_desc: "", last_result: null, strategy: "orb", symbols: [], tf: 5 };
    api.fetchSessionState.mockResolvedValueOnce(expState);

    const done = await pollExperimentState("s1");

    expect(done).toBe(true);
    expect(api.fetchSessionState).toHaveBeenCalledWith("s1");
  });

  it("pollExperimentState returns false for non-terminal status", async () => {
    const expState = { status: "running", current: 1, total: 4, best_pf: 1.0, best_desc: "", last_result: null, strategy: "orb", symbols: [], tf: 5 };
    api.fetchSessionState.mockResolvedValueOnce(expState);

    const done = await pollExperimentState("s1");

    expect(done).toBe(false);
    stopPolling();
  });

  it("pollExperimentState returns true and stops when fetch fails", async () => {
    api.fetchSessionState.mockResolvedValueOnce(null);

    expect(await pollExperimentState("s1")).toBe(true);
  });

  it("error handling: rejected api call clears loading flag", async () => {
    api.fetchSessions.mockRejectedValueOnce(new Error("network down"));

    await expect(fetchSessions()).rejects.toThrow("network down");

    expect(getExperimentState().loading.sessions).toBe(false);
  });
});

function setActiveSessionViaSelect() {
  const expState = { status: "completed", current: 4, total: 4, best_pf: 1.6, best_desc: "", last_result: null, strategy: "orb", symbols: [], tf: 5 };
  api.fetchSessionState.mockResolvedValue(expState);
  api.fetchResults.mockResolvedValue([]);
  void selectSession("s1");
}
