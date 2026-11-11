// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { OptionsPage } from "./OptionsPage";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";
import { renderWithProviders } from "../../test-utils/renderWithProviders";

vi.mock("./OptionChain/OptionChainPanel", () => ({
  OptionChainPanel: () => <div data-testid="options-chain-panel">Chain Panel</div>,
}));

vi.mock("./OptionPositions/PositionsPanel", () => ({
  PositionsPanel: () => <div data-testid="options-positions-panel">Positions Panel</div>,
}));

vi.mock("./PremiumTracker/PremiumTrackerPanel", () => ({
  PremiumTrackerPanel: () => <div data-testid="premium-tracker-panel">Premium Panel</div>,
}));

vi.mock("./Simulator/SimulatorPanel", () => ({
  SimulatorPanel: () => <div data-testid="simulator-panel">Simulator Panel</div>,
}));

beforeEach(() => setupBrowserMocks());
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const defaultProps = {
  activeTab: "chain",
  setActiveTab: vi.fn(),
  selectedUnderlying: "NIFTY",
  selectedExpiry: "25MAY",
  loading: false,
  error: null,
  filters: { optionType: "BOTH" as const, moneyness: "ALL" as const },
  spotPrice: 24500,
  setUnderlying: vi.fn(),
  setExpiry: vi.fn(),
  setFilters: vi.fn(),
  refreshChain: vi.fn(),
  availableUnderlyings: ["NIFTY", "BANKNIFTY"],
  availableExpiries: ["25MAY", "01JUN"],
  strikeMatrix: [],
  positions: [],
  timestamp: "2025-05-09T10:30:00Z",
  summary: { pcr: 1.0, max_pain: 24500, expected_move: null, total_ce_oi: 0, total_pe_oi: 0 },
};

describe("OptionsPage", () => {
  it("shows chain panel by default", () => {
    renderWithProviders(<OptionsPage {...defaultProps} />);
    expect(screen.getByTestId("options-chain-panel")).toBeInTheDocument();
  });

  it("shows positions panel when activeTab is positions", () => {
    renderWithProviders(<OptionsPage {...defaultProps} activeTab="positions" />);
    expect(screen.getByTestId("options-positions-panel")).toBeInTheDocument();
  });

  it("hides chain panel when positions tab is active", () => {
    renderWithProviders(<OptionsPage {...defaultProps} activeTab="positions" />);
    expect(screen.queryByTestId("options-chain-panel")).not.toBeInTheDocument();
  });

  it("shows premium panel when activeTab is premium", () => {
    renderWithProviders(<OptionsPage {...defaultProps} activeTab="premium" />);
    expect(screen.getByTestId("premium-tracker-panel")).toBeInTheDocument();
  });

  it("hides chain panel when premium tab is active", () => {
    renderWithProviders(<OptionsPage {...defaultProps} activeTab="premium" />);
    expect(screen.queryByTestId("options-chain-panel")).not.toBeInTheDocument();
  });

  it("renders simulator tab", () => {
    renderWithProviders(<OptionsPage {...defaultProps} />);
    expect(screen.getByText("Simulator")).toBeInTheDocument();
  });

  it("shows simulator panel when activeTab is simulator", () => {
    renderWithProviders(<OptionsPage {...defaultProps} activeTab="simulator" />);
    expect(screen.getByTestId("options-simulator-tab")).toBeInTheDocument();
    expect(screen.getByTestId("simulator-panel")).toBeInTheDocument();
  });

  it("hides chain panel when simulator tab is active", () => {
    renderWithProviders(<OptionsPage {...defaultProps} activeTab="simulator" />);
    expect(screen.queryByTestId("options-chain-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("simulator-panel")).toBeInTheDocument();
  });
});
