// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";

const mockSearchSymbols = vi.fn();
vi.mock("../../api/symbols", () => ({
  searchSymbols: (...args: any[]) => mockSearchSymbols(...args),
}));

const mockSetSymbols = vi.fn();
const mockSetTimeframe = vi.fn();
const mockSetPeriod = vi.fn();
const mockSetPeriodUnit = vi.fn();
const mockFetchCorrelationData = vi.fn();

let mockSymbols: string[] = [];
let mockTimeframe = "daily";
let mockPeriod = 90;
let mockMatrix: number[][] | null = null;
let mockNormalized: Record<string, any[]> | null = null;
let mockMeta: any = null;
let mockIsLoading = false;
let mockError: string | null = null;

vi.mock("../../state/correlation", () => ({
  subscribe: vi.fn(() => vi.fn()),
  get symbols() { return mockSymbols; },
  get timeframe() { return mockTimeframe; },
  get period() { return mockPeriod; },
  get matrix() { return mockMatrix; },
  get normalized() { return mockNormalized; },
  get meta() { return mockMeta; },
  get isLoading() { return mockIsLoading; },
  get error() { return mockError; },
  setSymbols: (...args: any[]) => mockSetSymbols(...args),
  setTimeframe: (...args: any[]) => mockSetTimeframe(...args),
  setPeriod: (...args: any[]) => mockSetPeriod(...args),
  setPeriodUnit: (...args: any[]) => mockSetPeriodUnit(...args),
  fetchCorrelationData: (...args: any[]) => mockFetchCorrelationData(...args),
}));

vi.mock("../../hooks/useStoreSubscription", () => ({
  useStoreSubscription: vi.fn(),
}));

vi.mock("./CorrelationMatrix", () => ({
  CorrelationMatrix: (props: any) => (
    <div data-testid="correlation-matrix" data-matrix={!!props.matrix} data-loading={props.isLoading}>
      Matrix
    </div>
  ),
}));

vi.mock("./CorrelationChart", () => ({
  CorrelationChart: (props: any) => (
    <div data-testid="correlation-chart" data-normalized={!!props.normalized} data-loading={props.isLoading}>
      Chart
    </div>
  ),
}));

vi.mock("../common/compact", () => ({
  CompactPanel: ({ children, title, testId }: any) => (
    <div data-testid={testId || "compact-panel"} data-title={title}>{children}</div>
  ),
  CompactStatGrid: ({ children }: any) => <div data-testid="compact-stat-grid">{children}</div>,
  CompactStat: ({ label, value }: any) => (
    <div data-testid={`stat-${label}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  ),
}));

import { CorrelationTab } from "./CorrelationTab";

const renderWithProvider = (ui: ReactElement) =>
  render(
    <MemoryRouter>
      <UIProvider>{ui}</UIProvider>
    </MemoryRouter>,
  );

describe("CorrelationTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSymbols = [];
    mockTimeframe = "daily";
    mockPeriod = 90;
    mockMatrix = null;
    mockNormalized = null;
    mockMeta = null;
    mockIsLoading = false;
    mockError = null;
    mockSearchSymbols.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it("renders main container with data-testid", () => {
    renderWithProvider(<CorrelationTab />);
    expect(screen.getByTestId("correlation-tab")).toBeInTheDocument();
  });

  it("renders MultiSelect for symbols", () => {
    renderWithProvider(<CorrelationTab />);
    expect(screen.getByText("Symbols")).toBeInTheDocument();
  });

  it("calls searchSymbols on search input", async () => {
      const user = userEvent.setup();
    mockSearchSymbols.mockResolvedValueOnce([
      { symbol: "RELIANCE", name: "Reliance Industries" },
    ]);
    renderWithProvider(<CorrelationTab />);
    const input = screen.getByPlaceholderText("Search and select symbols");
    await act(async () => {
      await user.clear(input); await user.type(input, "REL");
    });
    await waitFor(() => {
      expect(mockSearchSymbols).toHaveBeenCalledWith("REL", 10);
    });
  });

  it("renders timeframe SegmentedControl with Daily / Intraday", () => {
    renderWithProvider(<CorrelationTab />);
    expect(screen.getByTestId("correlation-timeframe")).toBeInTheDocument();
    expect(screen.getByText("Daily")).toBeInTheDocument();
    expect(screen.getByText("Intraday")).toBeInTheDocument();
  });

  it("period Select changes options based on timeframe", () => {
    renderWithProvider(<CorrelationTab />);
    const select = screen.getByTestId("correlation-period");
    expect(select).toBeInTheDocument();
    // Daily timeframe shows 30d, 90d, 180d, 1Y options
    expect(screen.getByText("30d")).toBeInTheDocument();
    expect(screen.getByText("90d")).toBeInTheDocument();
  });

  it("Calculate button triggers fetchCorrelationData", async () => {
      const user = userEvent.setup();
    mockSymbols = ["RELIANCE", "TCS"];
    renderWithProvider(<CorrelationTab />);
    const calcBtn = screen.getByRole("button", { name: /Calculate/ });
    await user.click(calcBtn);
    expect(mockFetchCorrelationData).toHaveBeenCalled();
  });

  it("Calculate button is disabled when less than 2 symbols", () => {
    mockSymbols = ["RELIANCE"];
    renderWithProvider(<CorrelationTab />);
    expect(screen.getByRole("button", { name: /Calculate/ })).toBeDisabled();
  });

  it("shows loading state on calculate button", () => {
    mockSymbols = ["RELIANCE", "TCS"];
    mockIsLoading = true;
    renderWithProvider(<CorrelationTab />);
    expect(screen.getByRole("button", { name: /Calculate/ })).toBeDisabled();
  });

  it("shows error Alert when error is set", () => {
    mockError = "Failed to fetch data";
    renderWithProvider(<CorrelationTab />);
    expect(screen.getByText("Failed to fetch data")).toBeInTheDocument();
  });

  it("shows meta stats when meta exists", () => {
    mockMeta = { start_date: "2024-01-01", end_date: "2024-12-31", data_points: 365 };
    mockSymbols = ["RELIANCE", "TCS"];
    renderWithProvider(<CorrelationTab />);
    expect(screen.getByTestId("compact-stat-grid")).toBeInTheDocument();
    expect(screen.getByTestId("stat-Date Range")).toBeInTheDocument();
    expect(screen.getByTestId("stat-Data Points")).toBeInTheDocument();
    expect(screen.getByTestId("stat-Symbols")).toBeInTheDocument();
    expect(screen.getByTestId("stat-Timeframe")).toBeInTheDocument();
  });

  it("renders CorrelationMatrix panel", () => {
    renderWithProvider(<CorrelationTab />);
    expect(screen.getByTestId("correlation-matrix")).toBeInTheDocument();
  });

  it("renders CorrelationChart panel", () => {
    renderWithProvider(<CorrelationTab />);
    expect(screen.getByTestId("correlation-chart")).toBeInTheDocument();
  });

  describe("URL search params", () => {
    it("initializes symbols/timeframe/period from URL search params", async () => {
      const { MemoryRouter } = await import("react-router-dom");
      render(
        <MemoryRouter initialEntries={["/?symbols=RELIANCE,TCS&timeframe=daily&period=90"]}>
          <UIProvider>
            <CorrelationTab />
          </UIProvider>
        </MemoryRouter>,
      );
      await waitFor(() => {
        expect(mockSetSymbols).toHaveBeenCalledWith(["RELIANCE", "TCS"]);
      });
      expect(mockSetTimeframe).toHaveBeenCalledWith("daily");
      expect(mockFetchCorrelationData).toHaveBeenCalled();
    });

    it("initializes with intraday timeframe from URL", async () => {
      const { MemoryRouter } = await import("react-router-dom");
      render(
        <MemoryRouter initialEntries={["/?symbols=INFY,WIPRO&timeframe=intraday&period=1"]}>
          <UIProvider>
            <CorrelationTab />
          </UIProvider>
        </MemoryRouter>,
      );
      await waitFor(() => {
        expect(mockSetSymbols).toHaveBeenCalledWith(["INFY", "WIPRO"]);
      });
      expect(mockSetTimeframe).toHaveBeenCalledWith("intraday");
      expect(mockSetPeriod).toHaveBeenCalledWith(1);
    });

    it("updates URL search params on calculate", async () => {
      const user = userEvent.setup();
      mockSymbols = ["RELIANCE", "TCS", "INFY"];
      const { MemoryRouter, useSearchParams } = await import("react-router-dom");
      render(
        <MemoryRouter initialEntries={["/"]}>
          <UIProvider>
            <CorrelationTab />
          </UIProvider>
        </MemoryRouter>,
      );
      await user.click(screen.getByRole("button", { name: /Calculate/ }));
      await waitFor(() => {
        expect(mockFetchCorrelationData).toHaveBeenCalled();
      });
    });
  });
});
