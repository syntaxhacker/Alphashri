// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithMantine } from "../../test-utils/renderWithMantine";
import { ExperimentsConfig } from "./ExperimentsConfig";
import type { ExperimentStrategy } from "../../types/experiments";

vi.mock("../../api/experiments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/experiments")>();
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
  resetExperimentState,
  fetchStrategies as storeFetchStrategies,
  setConfig,
  addSweepParam,
  setSweep,
  setSessionState,
} from "../../state/experiments";

const api = vi.mocked(await import("../../api/experiments"));

function makeStrategies(): ExperimentStrategy[] {
  return [
    {
      key: "orb",
      params: [
        { key: "or_minutes", label: "OR Minutes", type: "number", default: 45, min: 5, max: 120 },
        { key: "sl_pct", label: "Stop Loss %", type: "number", default: 1.0, min: 0.1, max: 10, step: 0.1 },
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

async function seedStrategies() {
  api.fetchStrategies.mockResolvedValue(makeStrategies());
  api.fetchSessions.mockResolvedValue([]);
  await act(async () => {
    await storeFetchStrategies();
  });
}

afterEach(cleanup);

describe("ExperimentsConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetExperimentState();
  });

  it("renders strategy select, symbol chips, and timeframe select", async () => {
    await seedStrategies();
    renderWithMantine(<ExperimentsConfig />);
    expect(screen.getByTestId("experiments-strategy-select")).toBeInTheDocument();
    expect(screen.getByTestId("experiments-symbol-chips")).toBeInTheDocument();
    expect(screen.getByTestId("experiments-tf-select")).toBeInTheDocument();
  });

  it("renders fixed param inputs for every param of the selected strategy", async () => {
    await seedStrategies();
    renderWithMantine(<ExperimentsConfig />);
    expect(screen.getByTestId("fixed-param-or_minutes")).toBeInTheDocument();
    expect(screen.getByTestId("fixed-param-sl_pct")).toBeInTheDocument();
    expect(screen.getByTestId("fixed-param-enable_shorts")).toBeInTheDocument();
    expect(screen.getByTestId("fixed-param-pivot_type")).toBeInTheDocument();
  });

  it("shows placeholder when no strategies loaded", () => {
    renderWithMantine(<ExperimentsConfig />);
    expect(screen.getByText("Select a strategy to configure sweep parameters")).toBeInTheDocument();
  });

  it("start button disabled without symbols and without sweep values", async () => {
    await seedStrategies();
    renderWithMantine(<ExperimentsConfig />);
    expect(screen.getByTestId("experiments-start-btn")).toBeDisabled();
  });

  it("start button disabled with symbols but no sweep values", async () => {
    await seedStrategies();
    setConfig({ symbols: ["RELIANCE"] });
    renderWithMantine(<ExperimentsConfig />);
    expect(screen.getByTestId("experiments-start-btn")).toBeDisabled();
  });

  it("start button disabled when experiment is running", async () => {
    await seedStrategies();
    setConfig({ symbols: ["RELIANCE"] });
    addSweepParam("sl_pct");
    act(() => {
      setSessionState({
        status: "running",
        current: 1,
        total: 4,
        best_pf: 1.2,
        best_desc: "",
        last_result: null,
        strategy: "orb",
        symbols: ["RELIANCE"],
        tf: 5,
      });
    });
    renderWithMantine(<ExperimentsConfig />);
    expect(screen.getByTestId("experiments-start-btn")).toBeDisabled();
  });

  it("adding a sweep value increases the candidates count and enables start", async () => {
    const user = userEvent.setup();
    await seedStrategies();
    setConfig({ symbols: ["RELIANCE", "TCS"] });
    renderWithMantine(<ExperimentsConfig />);

    expect(screen.getByTestId("experiments-candidates-count")).toHaveTextContent(
      "candidates = 1 x 2 symbols = 2",
    );

    await user.click(screen.getByTestId("sweep-add-sl_pct"));
    expect(screen.getByTestId("sweep-value-sl_pct-0")).toBeInTheDocument();
    expect(screen.getByTestId("experiments-start-btn")).not.toBeDisabled();

    await user.click(screen.getByTestId("sweep-value-add-sl_pct"));
    expect(screen.getByTestId("sweep-value-sl_pct-1")).toBeInTheDocument();
    expect(screen.getByTestId("experiments-candidates-count")).toHaveTextContent(
      "candidates = 2 x 2 symbols = 4",
    );
  });

  it("removing a sweep value shrinks the candidates count", async () => {
    const user = userEvent.setup();
    await seedStrategies();
    setConfig({ symbols: ["RELIANCE", "TCS"] });
    addSweepParam("sl_pct");
    setSweep("sl_pct", [1.0, 2.0, 3.0]);
    renderWithMantine(<ExperimentsConfig />);

    expect(screen.getByTestId("experiments-candidates-count")).toHaveTextContent(
      "candidates = 3 x 2 symbols = 6",
    );

    await user.click(screen.getByTestId("sweep-value-remove-sl_pct-1"));
    expect(screen.getByTestId("experiments-candidates-count")).toHaveTextContent(
      "candidates = 2 x 2 symbols = 4",
    );
  });

  it("moving a param back out of the sweep restores its fixed input", async () => {
    const user = userEvent.setup();
    await seedStrategies();
    setConfig({ symbols: ["RELIANCE"] });
    addSweepParam("sl_pct");
    renderWithMantine(<ExperimentsConfig />);

    expect(screen.getByTestId("sweep-value-sl_pct-0")).toBeInTheDocument();

    await user.click(screen.getByTestId("sweep-remove-sl_pct"));
    expect(screen.queryByTestId("sweep-value-sl_pct-0")).not.toBeInTheDocument();
    expect(screen.getByTestId("fixed-param-sl_pct")).toBeInTheDocument();
  });

  it("shows a warning badge when candidates exceed 500", async () => {
    await seedStrategies();
    setConfig({ symbols: ["A", "B", "C", "D", "E"] });
    addSweepParam("sl_pct");
    setSweep("sl_pct", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    addSweepParam("or_minutes");
    setSweep("or_minutes", [5, 10, 15, 20, 25, 30, 35, 40, 45, 50]);
    renderWithMantine(<ExperimentsConfig />);

    expect(screen.getByTestId("experiments-candidates-warning")).toBeInTheDocument();
    expect(screen.getByTestId("experiments-candidates-count")).toHaveTextContent(
      "candidates = 110 x 5 symbols = 550",
    );
  });

  it("does not show warning badge under 500 candidates", async () => {
    await seedStrategies();
    setConfig({ symbols: ["RELIANCE"] });
    addSweepParam("sl_pct");
    setSweep("sl_pct", [1.0, 2.0]);
    renderWithMantine(<ExperimentsConfig />);
    expect(screen.queryByTestId("experiments-candidates-warning")).not.toBeInTheDocument();
  });

  it("start calls startExperiment with the configured grid", async () => {
    const user = userEvent.setup();
    await seedStrategies();
    setConfig({ symbols: ["RELIANCE", "TCS"] });
    addSweepParam("sl_pct");
    setSweep("sl_pct", [1.0, 2.0]);
    api.startExperiment.mockResolvedValue({ session: "exp_orb_1" });
    renderWithMantine(<ExperimentsConfig />);

    await user.click(screen.getByTestId("experiments-start-btn"));

    await waitFor(() => {
      expect(api.startExperiment).toHaveBeenCalledTimes(1);
    });
    expect(api.startExperiment).toHaveBeenCalledWith(
      expect.objectContaining({
        strategy: "orb",
        symbols: ["RELIANCE", "TCS"],
        tf: 5,
        param_space: expect.objectContaining({ sl_pct: [1.0, 2.0] }),
      }),
    );
  });

  it("reset restores default config", async () => {
    const user = userEvent.setup();
    await seedStrategies();
    setConfig({ symbols: ["RELIANCE", "TCS"], description: "sweep run" });
    addSweepParam("sl_pct");
    renderWithMantine(<ExperimentsConfig />);

    await user.click(screen.getByTestId("experiments-reset-btn"));

    expect(screen.getByTestId("experiments-candidates-count")).toHaveTextContent(
      "candidates = 1 x 0 symbols = 0",
    );
  });
});
