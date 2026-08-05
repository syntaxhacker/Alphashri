// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import { ExperimentsPage } from "./ExperimentsPage";
import type { ExperimentsState } from "../../state/experiments";
import type { ExperimentSession } from "../../types/experiments";

let currentState: ExperimentsState;

vi.mock("../../state/experiments", () => ({
  getExperimentState: vi.fn(() => currentState),
  subscribe: vi.fn(() => vi.fn()),
  fetchStrategies: vi.fn().mockResolvedValue([]),
  fetchSessions: vi.fn().mockResolvedValue([]),
  selectSession: vi.fn().mockResolvedValue(null),
  startPolling: vi.fn(),
  stopPolling: vi.fn(),
}));

vi.mock("./ExperimentsConfig", () => ({
  ExperimentsConfig: () => <div data-testid="mock-config">Config</div>,
}));

vi.mock("./ExperimentsProgress", () => ({
  ExperimentsProgress: () => <div data-testid="mock-progress">Progress</div>,
}));

vi.mock("./ExperimentsResultsTable", () => ({
  ExperimentsResultsTable: () => (
    <div data-testid="mock-results-table">ResultsTable</div>
  ),
}));

vi.mock("./ExperimentsChart", () => ({
  ExperimentsChart: () => <div data-testid="mock-chart">Chart</div>,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function Wrapper({ children }: { children: React.ReactNode }) {
  return <UIProvider>{children}</UIProvider>;
}

function makeSession(
  overrides: Partial<ExperimentSession> = {},
): ExperimentSession {
  return {
    session: "exp_orb_1",
    strategy: "orb",
    tf: 5,
    symbols: ["TCS", "RELIANCE"],
    runs: 4,
    status: "completed",
    ...overrides,
  };
}

function makeState(
  overrides: Partial<ExperimentsState> = {},
): ExperimentsState {
  return {
    strategies: [],
    strategiesLoading: false,
    sessions: [],
    sessionsLoading: false,
    activeSession: null,
    config: {
      strategy: "orb",
      symbols: [],
      tf: 5,
      dateStart: "",
      dateEnd: "",
      includeCosts: true,
      description: "",
    },
    fixedParams: {},
    sweeps: [],
    state: null,
    results: null,
    selectedRun: null,
    chartData: null,
    chartLoading: false,
    error: null,
    ...overrides,
  };
}

describe("ExperimentsPage", () => {
  beforeEach(() => {
    currentState = makeState();
  });

  it("calls fetchSessions on mount", async () => {
    render(<ExperimentsPage />, { wrapper: Wrapper });
    const { fetchSessions } = await import("../../state/experiments");
    expect(fetchSessions).toHaveBeenCalled();
  });

  it("calls fetchStrategies on mount", async () => {
    render(<ExperimentsPage />, { wrapper: Wrapper });
    const { fetchStrategies } = await import("../../state/experiments");
    expect(fetchStrategies).toHaveBeenCalled();
  });

  it("renders the session list with session info", () => {
    currentState = makeState({
      sessions: [
        makeSession(),
        makeSession({
          session: "exp_ema_2",
          strategy: "ema_cross",
          tf: 1,
          runs: 6,
          status: "running",
        }),
      ],
    });
    render(<ExperimentsPage />, { wrapper: Wrapper });
    expect(screen.getByTestId("experiments-page")).toBeInTheDocument();
    expect(screen.getByTestId("experiments-session-list")).toBeInTheDocument();
    expect(
      screen.getByTestId("experiments-session-exp_orb_1"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("experiments-session-exp_ema_2"),
    ).toBeInTheDocument();
    expect(screen.getByText("4 runs")).toBeInTheDocument();
    expect(screen.getByText("6 runs")).toBeInTheDocument();
    expect(screen.getByText("completed")).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
  });

  it("renders the results table and chart panels", () => {
    currentState = makeState({ sessions: [makeSession()] });
    render(<ExperimentsPage />, { wrapper: Wrapper });
    expect(screen.getByTestId("mock-results-table")).toBeInTheDocument();
    expect(screen.getByTestId("mock-chart")).toBeInTheDocument();
  });

  it("shows empty sessions message when there are none", () => {
    render(<ExperimentsPage />, { wrapper: Wrapper });
    expect(screen.getByText("No sessions yet")).toBeInTheDocument();
  });

  it("calls selectSession when a session row is clicked", async () => {
    const user = userEvent.setup();
    currentState = makeState({ sessions: [makeSession()] });
    render(<ExperimentsPage />, { wrapper: Wrapper });

    await user.click(screen.getByTestId("experiments-session-exp_orb_1"));
    const { selectSession } = await import("../../state/experiments");
    expect(selectSession).toHaveBeenCalledWith("exp_orb_1");
  });

  it("starts polling when an active session is present", async () => {
    currentState = makeState({
      sessions: [makeSession()],
      activeSession: "exp_orb_1",
    });
    render(<ExperimentsPage />, { wrapper: Wrapper });
    const { startPolling } = await import("../../state/experiments");
    expect(startPolling).toHaveBeenCalledWith("exp_orb_1");
  });

  it("does not start polling when no active session", async () => {
    render(<ExperimentsPage />, { wrapper: Wrapper });
    const { startPolling } = await import("../../state/experiments");
    expect(startPolling).not.toHaveBeenCalled();
  });

  it("stops polling on unmount", async () => {
    currentState = makeState({ activeSession: "exp_orb_1" });
    const { unmount } = render(<ExperimentsPage />, { wrapper: Wrapper });
    unmount();
    const { stopPolling } = await import("../../state/experiments");
    expect(stopPolling).toHaveBeenCalled();
  });

  it("renders an error alert when state.error is set", () => {
    currentState = makeState({ error: "Something went wrong" });
    render(<ExperimentsPage />, { wrapper: Wrapper });
    expect(screen.getByTestId("experiments-error")).toBeInTheDocument();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });
});
