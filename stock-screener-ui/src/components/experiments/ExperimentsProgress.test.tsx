// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithMantine } from "../../test-utils/renderWithMantine";
import { ExperimentsProgress } from "./ExperimentsProgress";
import type { ExperimentState } from "../../types/experiments";

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

import { resetExperimentState, setActiveSession, setSessionState } from "../../state/experiments";

const api = vi.mocked(await import("../../api/experiments"));

function makeState(overrides: Partial<ExperimentState> = {}): ExperimentState {
  return {
    status: "running",
    current: 14,
    total: 72,
    best_pf: 1.83,
    best_desc: "",
    last_result: { description: "sl 1.0 pf 1.83" },
    strategy: "orb",
    symbols: ["RELIANCE", "TCS"],
    tf: 5,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ExperimentsProgress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetExperimentState();
  });

  it("shows empty state when no active experiment", () => {
    renderWithMantine(<ExperimentsProgress />);
    expect(screen.getByTestId("experiments-progress-empty")).toHaveTextContent(
      "No active experiment",
    );
  });

  it("renders status, progress counter, progress bar, and best PF", () => {
    setActiveSession("exp_orb_1");
    setSessionState(makeState());
    renderWithMantine(<ExperimentsProgress />);

    expect(screen.getByTestId("experiments-progress-status")).toHaveTextContent("running");
    expect(screen.getByTestId("experiments-progress-counter")).toHaveTextContent("14/72");
    expect(screen.getByTestId("experiments-progress-bar")).toBeInTheDocument();
    expect(screen.getByTestId("experiments-progress-best-pf")).toHaveTextContent("best PF 1.83");
    expect(screen.getByTestId("experiments-progress-session")).toHaveTextContent("exp_orb_1");
  });

  it("renders last result description", () => {
    setActiveSession("exp_orb_1");
    setSessionState(makeState());
    renderWithMantine(<ExperimentsProgress />);
    expect(screen.getByTestId("experiments-progress-last-result")).toHaveTextContent(
      "sl 1.0 pf 1.83",
    );
  });

  it("falls back to best_desc when last_result has no description", () => {
    setActiveSession("exp_orb_1");
    setSessionState(makeState({ last_result: null, best_desc: "baseline sweep" }));
    renderWithMantine(<ExperimentsProgress />);
    expect(screen.getByTestId("experiments-progress-last-result")).toHaveTextContent(
      "baseline sweep",
    );
  });

  it("shows pause and cancel while running, and pause calls pauseExperiment", async () => {
    const user = userEvent.setup();
    setActiveSession("exp_orb_1");
    setSessionState(makeState());
    api.pauseExperiment.mockResolvedValue(true);
    api.fetchSessionState.mockResolvedValue(null);
    renderWithMantine(<ExperimentsProgress />);

    expect(screen.getByTestId("experiments-pause-btn")).toBeInTheDocument();
    expect(screen.queryByTestId("experiments-resume-btn")).not.toBeInTheDocument();
    expect(screen.getByTestId("experiments-cancel-btn")).toBeInTheDocument();

    await user.click(screen.getByTestId("experiments-pause-btn"));
    await waitFor(() => {
      expect(api.pauseExperiment).toHaveBeenCalledWith("exp_orb_1");
    });
  });

  it("shows resume and cancel while paused, and resume calls resumeExperiment", async () => {
    const user = userEvent.setup();
    setActiveSession("exp_orb_1");
    setSessionState(makeState({ status: "paused" }));
    api.resumeExperiment.mockResolvedValue(true);
    api.fetchSessionState.mockResolvedValue(null);
    renderWithMantine(<ExperimentsProgress />);

    expect(screen.getByTestId("experiments-resume-btn")).toBeInTheDocument();
    expect(screen.queryByTestId("experiments-pause-btn")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("experiments-resume-btn"));
    await waitFor(() => {
      expect(api.resumeExperiment).toHaveBeenCalledWith("exp_orb_1");
    });
  });

  it("cancel calls cancelExperiment", async () => {
    const user = userEvent.setup();
    setActiveSession("exp_orb_1");
    setSessionState(makeState());
    api.cancelExperiment.mockResolvedValue(true);
    api.fetchSessionState.mockResolvedValue(null);
    renderWithMantine(<ExperimentsProgress />);

    await user.click(screen.getByTestId("experiments-cancel-btn"));
    await waitFor(() => {
      expect(api.cancelExperiment).toHaveBeenCalledWith("exp_orb_1");
    });
  });

  it("hides control buttons once completed", () => {
    setActiveSession("exp_orb_1");
    setSessionState(makeState({ status: "completed", current: 72, total: 72, best_pf: 1.83 }));
    renderWithMantine(<ExperimentsProgress />);

    expect(screen.getByTestId("experiments-progress-status")).toHaveTextContent("completed");
    expect(screen.queryByTestId("experiments-pause-btn")).not.toBeInTheDocument();
    expect(screen.queryByTestId("experiments-resume-btn")).not.toBeInTheDocument();
    expect(screen.queryByTestId("experiments-cancel-btn")).not.toBeInTheDocument();
  });

  it("renders error status badge", () => {
    setActiveSession("exp_orb_1");
    setSessionState(makeState({ status: "error" }));
    renderWithMantine(<ExperimentsProgress />);
    expect(screen.getByTestId("experiments-progress-status")).toHaveTextContent("error");
  });
});
