// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MantineProvider } from "@mantine/core";
import { OptionsPage } from "./OptionsPage";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";

vi.mock("./OptionChain/OptionChainPanel", () => ({
  OptionChainPanel: () => <div data-testid="options-chain-panel">Chain Panel</div>,
}));

vi.mock("./OptionPositions/PositionsPanel", () => ({
  PositionsPanel: () => <div data-testid="options-positions-panel">Positions Panel</div>,
}));

vi.mock("./OptionGreeks/GreeksPanel", () => ({
  GreeksPanel: () => <div data-testid="options-greeks-panel">Greeks Panel</div>,
}));

beforeEach(() => setupBrowserMocks());
afterEach(() => cleanup());

function renderWithMantine(ui: React.ReactElement) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

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
  it("renders options nav", () => {
    renderWithMantine(<OptionsPage {...defaultProps} />);
    expect(screen.getByTestId("options-nav")).toBeInTheDocument();
  });

  it("shows chain panel by default", () => {
    renderWithMantine(<OptionsPage {...defaultProps} />);
    expect(screen.getByTestId("options-chain-panel")).toBeInTheDocument();
  });

  it("shows positions panel when activeTab is positions", () => {
    renderWithMantine(<OptionsPage {...defaultProps} activeTab="positions" />);
    expect(screen.getByTestId("options-positions-panel")).toBeInTheDocument();
  });

  it("shows greeks panel when activeTab is greeks", () => {
    renderWithMantine(<OptionsPage {...defaultProps} activeTab="greeks" />);
    expect(screen.getByTestId("options-greeks-panel")).toBeInTheDocument();
  });

  it("hides chain panel when positions tab is active", () => {
    renderWithMantine(<OptionsPage {...defaultProps} activeTab="positions" />);
    expect(screen.queryByTestId("options-chain-panel")).not.toBeInTheDocument();
  });

  it("hides chain panel when greeks tab is active", () => {
    renderWithMantine(<OptionsPage {...defaultProps} activeTab="greeks" />);
    expect(screen.queryByTestId("options-chain-panel")).not.toBeInTheDocument();
  });
});
