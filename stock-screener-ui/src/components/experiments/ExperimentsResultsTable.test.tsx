// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import { ExperimentsResultsTable } from "./ExperimentsResultsTable";
import type { ExperimentsState } from "../../state/experiments";
import type { ExperimentRun } from "../../types/experiments";

let currentState: ExperimentsState;

vi.mock("../../state/experiments", () => ({
  getExperimentState: vi.fn(() => currentState),
  subscribe: vi.fn(() => vi.fn()),
  selectRun: vi.fn(),
}));

vi.mock("@/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/ui")>();
  return {
    ...actual,
    Select: ({
      value,
      onChange,
      data,
      "data-testid": testId,
      ...rest
    }: any) => (
      <select
        data-testid={testId}
        value={value ?? ""}
        onChange={(e) => onChange?.(e.target.value || null)}
        {...rest}
      >
        {data.map((opt: any) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    ),
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function Wrapper({ children }: { children: React.ReactNode }) {
  return <UIProvider>{children}</UIProvider>;
}

function makeMetrics(
  overrides: Partial<ExperimentRun["metrics"]> = {},
): ExperimentRun["metrics"] {
  return {
    total_trades: 20,
    wins: 12,
    losses: 8,
    net_pnl: 15000,
    profit_factor: 1.5,
    win_rate: 60,
    tp_exits: 5,
    sl_exits: 12,
    eod_exits: 3,
    ...overrides,
  };
}

function makeRun(overrides: Partial<ExperimentRun> = {}): ExperimentRun {
  return {
    run: 1,
    metric: 1.5,
    metrics: makeMetrics(),
    per_symbol: {
      TCS: makeMetrics({
        net_pnl: 9000,
        profit_factor: 1.8,
        win_rate: 66,
        total_trades: 12,
      }),
      RELIANCE: makeMetrics({
        net_pnl: 6000,
        profit_factor: 1.2,
        win_rate: 50,
        total_trades: 8,
      }),
    },
    config: { sl_pct: 1.0, tp_pct: 1.5 },
    strategy: "orb",
    symbols: ["TCS", "RELIANCE"],
    tf: 5,
    status: "keep",
    description: "Baseline ORB",
    timestamp: 1736000000000,
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

describe("ExperimentsResultsTable", () => {
  beforeEach(() => {
    currentState = makeState();
  });

  it("renders empty state when no results", () => {
    render(<ExperimentsResultsTable />, { wrapper: Wrapper });
    expect(screen.getByTestId("experiments-results-empty")).toBeInTheDocument();
  });

  it("renders a row per run with status badges", () => {
    currentState = makeState({
      results: [
        makeRun(),
        makeRun({ run: 2, status: "discard", description: "Wide SL" }),
      ],
    });
    render(<ExperimentsResultsTable />, { wrapper: Wrapper });
    expect(screen.getByTestId("experiments-run-row-1")).toBeInTheDocument();
    expect(screen.getByTestId("experiments-run-row-2")).toBeInTheDocument();
    expect(screen.getByTestId("experiments-status-1")).toHaveTextContent(
      "✅ Keep",
    );
    expect(screen.getByTestId("experiments-status-2")).toHaveTextContent(
      "❌ Discard",
    );
    expect(screen.getByText("Baseline ORB")).toBeInTheDocument();
    expect(screen.getByText("Wide SL")).toBeInTheDocument();
  });

  it("shows config summary when description is empty", () => {
    currentState = makeState({
      results: [makeRun({ description: "" })],
    });
    render(<ExperimentsResultsTable />, { wrapper: Wrapper });
    expect(screen.getByText(/sl_pct=1/)).toBeInTheDocument();
  });

  it("highlights the best PF row", () => {
    const best = makeRun({
      run: 2,
      metrics: makeMetrics({ profit_factor: 2.4 }),
    });
    currentState = makeState({ results: [makeRun(), best] });
    render(<ExperimentsResultsTable />, { wrapper: Wrapper });
    const row = screen.getByTestId("experiments-run-row-2");
    expect(row.getAttribute("style")).toContain(
      "var(--mantine-color-teal-light)",
    );
    expect(
      screen.getByTestId("experiments-run-row-1").getAttribute("style"),
    ).not.toContain("var(--mantine-color-teal-light)");
  });

  it("highlights the selected run row", () => {
    currentState = makeState({
      results: [makeRun(), makeRun({ run: 2 })],
      selectedRun: makeRun({ run: 2 }),
    });
    render(<ExperimentsResultsTable />, { wrapper: Wrapper });
    expect(
      screen.getByTestId("experiments-run-row-2").getAttribute("style"),
    ).toContain("var(--mantine-color-blue-light)");
  });

  it("shows low-sample warning badge for runs under 10 trades", () => {
    currentState = makeState({
      results: [
        makeRun({ run: 1, metrics: makeMetrics({ total_trades: 8 }) }),
        makeRun({ run: 2, metrics: makeMetrics({ total_trades: 42 }) }),
      ],
    });
    render(<ExperimentsResultsTable />, { wrapper: Wrapper });
    expect(screen.getByTestId("experiments-low-sample-1")).toHaveTextContent(
      "⚠ Low sample",
    );
    expect(
      screen.queryByTestId("experiments-low-sample-2"),
    ).not.toBeInTheDocument();
  });

  it("expands a run to show per-symbol rows", async () => {
    const user = userEvent.setup();
    currentState = makeState({ results: [makeRun()] });
    render(<ExperimentsResultsTable />, { wrapper: Wrapper });
    expect(
      screen.queryByTestId("experiments-symbol-row-1-TCS"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByTestId("experiments-expand-1"));

    expect(
      screen.getByTestId("experiments-symbol-row-1-TCS"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("experiments-symbol-row-1-RELIANCE"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("experiments-symbol-row-1-TCS")).getByText(
        "TCS",
      ),
    ).toBeInTheDocument();
  });

  it("expanding does not select the run", async () => {
    const user = userEvent.setup();
    currentState = makeState({ results: [makeRun()] });
    render(<ExperimentsResultsTable />, { wrapper: Wrapper });
    await user.click(screen.getByTestId("experiments-expand-1"));
    const { selectRun } = await import("../../state/experiments");
    expect(selectRun).not.toHaveBeenCalled();
  });

  it("filters runs by symbol via the symbol filter", async () => {
    const user = userEvent.setup();
    const run1 = makeRun({ run: 1, symbols: ["TCS", "RELIANCE"] });
    const run2 = makeRun({
      run: 2,
      symbols: ["INFY"],
      description: "INFY only",
    });
    currentState = makeState({ results: [run1, run2] });
    render(<ExperimentsResultsTable />, { wrapper: Wrapper });

    expect(screen.getByTestId("experiments-run-row-1")).toBeInTheDocument();
    expect(screen.getByTestId("experiments-run-row-2")).toBeInTheDocument();

    await user.selectOptions(
      screen.getByTestId("experiments-symbol-filter"),
      "TCS",
    );

    expect(screen.getByTestId("experiments-run-row-1")).toBeInTheDocument();
    expect(
      screen.queryByTestId("experiments-run-row-2"),
    ).not.toBeInTheDocument();
  });

  it("filters per-symbol rows by the selected symbol", async () => {
    const user = userEvent.setup();
    currentState = makeState({ results: [makeRun()] });
    render(<ExperimentsResultsTable />, { wrapper: Wrapper });
    await user.click(screen.getByTestId("experiments-expand-1"));
    expect(
      screen.getByTestId("experiments-symbol-row-1-RELIANCE"),
    ).toBeInTheDocument();

    await user.selectOptions(
      screen.getByTestId("experiments-symbol-filter"),
      "TCS",
    );

    expect(
      screen.getByTestId("experiments-symbol-row-1-TCS"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("experiments-symbol-row-1-RELIANCE"),
    ).not.toBeInTheDocument();
  });

  it("calls selectRun when a row is clicked", async () => {
    const user = userEvent.setup();
    const run1 = makeRun({ run: 1 });
    currentState = makeState({ results: [run1, makeRun({ run: 2 })] });
    render(<ExperimentsResultsTable />, { wrapper: Wrapper });

    await user.click(screen.getByTestId("experiments-run-row-1"));
    const { selectRun } = await import("../../state/experiments");
    expect(selectRun).toHaveBeenCalledWith(run1);
  });

  it("sorts by a column and toggles direction", async () => {
    const user = userEvent.setup();
    currentState = makeState({
      results: [
        makeRun({ run: 1, metrics: makeMetrics({ net_pnl: 15000 }) }),
        makeRun({ run: 2, metrics: makeMetrics({ net_pnl: 40000 }) }),
        makeRun({ run: 3, metrics: makeMetrics({ net_pnl: 8000 }) }),
      ],
    });
    render(<ExperimentsResultsTable />, { wrapper: Wrapper });

    await user.click(screen.getByTestId("experiments-sort-net_pnl"));
    const rows = screen.getAllByTestId(/experiments-run-row-/);
    expect(rows[0].textContent).toContain("2");

    await user.click(screen.getByTestId("experiments-sort-net_pnl"));
    const rowsAsc = screen.getAllByTestId(/experiments-run-row-/);
    expect(rowsAsc[0].textContent).toContain("3");
  });

  it("renders TP/SL/EOD and formatted net P&L", () => {
    currentState = makeState({ results: [makeRun()] });
    render(<ExperimentsResultsTable />, { wrapper: Wrapper });
    expect(screen.getByText("5/12/3")).toBeInTheDocument();
    expect(screen.getByText("+₹15.0K")).toBeInTheDocument();
  });
});
