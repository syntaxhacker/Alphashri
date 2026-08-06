// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import { ExperimentsChart } from "./ExperimentsChart";
import type { ExperimentsState } from "../../state/experiments";
import type {
  ExperimentChartData,
  ExperimentRun,
} from "../../types/experiments";

let currentState: ExperimentsState;

vi.mock("../../state/experiments", () => ({
  getExperimentState: vi.fn(() => currentState),
  subscribe: vi.fn(() => vi.fn()),
  fetchRunChart: vi.fn(),
}));

vi.mock("../chart/TradingChart", () => ({
  TradingChart: () => <div data-testid="trading-chart-mock">TradingChart</div>,
}));

vi.mock("@/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/ui")>();
  return {
    ...actual,
    useColorScheme: () => ({ colorScheme: "dark", toggleColorScheme: vi.fn() }),
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

function makeRun(overrides: Partial<ExperimentRun> = {}): ExperimentRun {
  return {
    run: 3,
    metric: 1.8,
    metrics: {
      total_trades: 20,
      wins: 12,
      losses: 8,
      net_pnl: 15000,
      profit_factor: 1.8,
      win_rate: 60,
      tp_exits: 5,
      sl_exits: 12,
      eod_exits: 3,
    },
    per_symbol: {},
    config: { sl_pct: 1.0 },
    strategy: "orb",
    symbols: ["TCS", "RELIANCE"],
    tf: 5,
    status: "keep",
    description: "Baseline",
    timestamp: 1736000000000,
    ...overrides,
  };
}

function makeChartData(
  overrides: Partial<ExperimentChartData> = {},
): ExperimentChartData {
  return {
    symbol: "TCS",
    candles: [
      {
        time: "2026-01-05T09:30",
        date: "2026-01-05",
        time_str: "09:30",
        open: 100,
        high: 105,
        low: 99,
        close: 104,
        volume: 1000,
      },
      {
        time: "2026-01-05T09:35",
        date: "2026-01-05",
        time_str: "09:35",
        open: 104,
        high: 106,
        low: 103,
        close: 105,
        volume: 900,
      },
    ],
    orb_zones: [],
    pivot_levels: [],
    week52_levels: [],
    trades: [],
    date_range: { start: "2026-01-05", end: "2026-01-05" },
    total_candles: 2,
    total_trades: 0,
    ...overrides,
  };
}

function makeState(
  overrides: Partial<ExperimentsState> = {},
): ExperimentsState {
  return {
    strategies: [],
    sessions: [],
    activeSession: "exp_orb_1",
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
    loading: { strategies: false, sessions: false, chart: false },
    error: null,
    ...overrides,
  };
}

describe("ExperimentsChart", () => {
  beforeEach(() => {
    currentState = makeState();
  });

  it("renders empty state when no run is selected", () => {
    render(<ExperimentsChart />, { wrapper: Wrapper });
    expect(screen.getByTestId("experiments-chart")).toBeInTheDocument();
    expect(
      screen.getByText("Select a run to view its chart"),
    ).toBeInTheDocument();
  });

  it("renders header with run info, timeframe and symbol select", () => {
    currentState = makeState({
      selectedRun: makeRun(),
      chartData: makeChartData(),
    });
    render(<ExperimentsChart />, { wrapper: Wrapper });
    expect(
      screen.getByTestId("experiments-chart-symbol-select"),
    ).toBeInTheDocument();
    expect(screen.getByText("Run 3")).toBeInTheDocument();
    expect(screen.getByText("orb")).toBeInTheDocument();
    expect(screen.getByText("5m")).toBeInTheDocument();
  });

  it("renders chartData via TradingChart", () => {
    currentState = makeState({
      selectedRun: makeRun(),
      chartData: makeChartData(),
    });
    render(<ExperimentsChart />, { wrapper: Wrapper });
    expect(screen.getByTestId("trading-chart-mock")).toBeInTheDocument();
    expect(screen.getByTestId("experiments-chart-body")).toBeInTheDocument();
  });

  it("shows loading state while chart is loading with no data", () => {
    currentState = makeState({
      selectedRun: makeRun(),
      chartData: null,
      loading: { strategies: false, sessions: false, chart: true },
    });
    render(<ExperimentsChart />, { wrapper: Wrapper });
    expect(screen.getByTestId("experiments-chart-loading")).toBeInTheDocument();
  });

  it("shows empty state when selected but no chartData", () => {
    currentState = makeState({
      selectedRun: makeRun(),
      chartData: null,
    });
    render(<ExperimentsChart />, { wrapper: Wrapper });
    expect(screen.getByTestId("experiments-chart-empty")).toBeInTheDocument();
  });

  it("calls fetchRunChart when the symbol changes", async () => {
    const user = userEvent.setup();
    currentState = makeState({
      selectedRun: makeRun(),
      chartData: makeChartData(),
    });
    render(<ExperimentsChart />, { wrapper: Wrapper });

    await user.selectOptions(
      screen.getByTestId("experiments-chart-symbol-select"),
      "RELIANCE",
    );

    const { fetchRunChart } = await import("../../state/experiments");
    expect(fetchRunChart).toHaveBeenCalledWith(3, "RELIANCE");
  });
});
