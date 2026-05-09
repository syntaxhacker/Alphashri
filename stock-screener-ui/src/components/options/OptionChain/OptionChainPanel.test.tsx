// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MantineProvider } from "@mantine/core";
import { OptionChainPanel } from "./OptionChainPanel";
import { setupBrowserMocks } from "../../../test-utils/setupBrowser";

vi.mock("./OptionChainHeader", () => ({
  OptionChainHeader: () => <div data-testid="options-chain-header-controls">Header</div>,
}));

vi.mock("./OptionChainFilters", () => ({
  OptionChainFilters: () => <div data-testid="options-chain-filters">Filters</div>,
}));

vi.mock("./OptionChainTable", () => ({
  OptionChainTable: () => <div data-testid="options-chain-table">Table</div>,
}));

vi.mock("./ChainSummary", () => ({
  ChainSummary: () => <div data-testid="chain-summary">Summary</div>,
}));

vi.mock("./OIAnalysis", () => ({
  OIAnalysis: () => <div data-testid="oi-analysis">Analysis</div>,
}));

vi.mock("./OptionChainGuide", () => ({
  OptionChainGuide: ({ opened, onClose }: any) =>
    opened ? <div data-testid="options-chain-guide-modal">Guide</div> : null,
}));

vi.mock("./LiveSpotChart", () => ({
  LiveSpotChart: ({ underlying }: any) => (
    <div data-testid="options-live-spot-chart">Chart for {underlying}</div>
  ),
}));

beforeEach(() => setupBrowserMocks());
afterEach(() => cleanup());

function renderWithMantine(ui: React.ReactElement) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

const defaultProps = {
  selectedUnderlying: "NIFTY",
  selectedExpiry: "25MAY",
  loading: false,
  error: null as string | null,
  filters: { optionType: "BOTH" as const, moneyness: "ALL" as const },
  spotPrice: 24500,
  setUnderlying: vi.fn(),
  setExpiry: vi.fn(),
  setFilters: vi.fn(),
  refreshChain: vi.fn(),
  availableUnderlyings: ["NIFTY", "BANKNIFTY"],
  availableExpiries: ["25MAY", "01JUN"],
  strikeMatrix: [],
  timestamp: "2025-05-09T10:30:00Z",
  summary: { pcr: 1.0, max_pain: 24500, expected_move: null, total_ce_oi: 0, total_pe_oi: 0 },
};

describe("OptionChainPanel", () => {
  it("renders panel container", () => {
    renderWithMantine(<OptionChainPanel {...defaultProps} />);
    expect(screen.getByTestId("options-chain-panel")).toBeInTheDocument();
  });

  it("displays Option Chain title", () => {
    renderWithMantine(<OptionChainPanel {...defaultProps} />);
    expect(screen.getByText("Option Chain")).toBeInTheDocument();
  });

  it("renders LiveSpotChart with underlying prop", () => {
    renderWithMantine(<OptionChainPanel {...defaultProps} selectedUnderlying="BANKNIFTY" />);
    expect(screen.getByTestId("options-live-spot-chart")).toHaveTextContent("Chart for BANKNIFTY");
  });

  it("renders timestamp badge showing HH:mm:ss", () => {
    renderWithMantine(<OptionChainPanel {...defaultProps} />);
    const badge = screen.getByTestId("options-chain-timestamp");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent(/^\d{2}:\d{2}:\d{2}$/);
  });

  // Mantine Tooltip content renders in a Portal only on hover — needs browser interaction
  it.skip("renders timestamp badge with tooltip containing full date", () => {
    renderWithMantine(<OptionChainPanel {...defaultProps} />);
    const badge = screen.getByTestId("options-chain-timestamp");
    expect(badge).toBeInTheDocument();
    const tooltip = screen.getByText(/Data as of/);
    expect(tooltip).toBeInTheDocument();
    expect(tooltip.textContent).toContain("09 May 2025");
  });

  it("does not render timestamp badge when loading", () => {
    renderWithMantine(<OptionChainPanel {...defaultProps} loading={true} />);
    expect(screen.queryByTestId("options-chain-timestamp")).not.toBeInTheDocument();
  });

  it("does not render timestamp badge when timestamp is undefined", () => {
    renderWithMantine(<OptionChainPanel {...defaultProps} timestamp={undefined} />);
    expect(screen.queryByTestId("options-chain-timestamp")).not.toBeInTheDocument();
  });

  it("shows underlying-expiry selection label", () => {
    renderWithMantine(
      <OptionChainPanel {...defaultProps} selectedUnderlying="BANKNIFTY" selectedExpiry="01JUN" />,
    );
    expect(screen.getByTestId("options-chain-selection")).toHaveTextContent("BANKNIFTY · 01JUN");
  });

  it("calls refreshChain when refresh icon is clicked", () => {
    const refreshChain = vi.fn();
    renderWithMantine(<OptionChainPanel {...defaultProps} refreshChain={refreshChain} />);
    fireEvent.click(screen.getByTestId("refresh-chain-btn"));
    expect(refreshChain).toHaveBeenCalledTimes(1);
  });

  it("disables refresh icon (dimmed) while loading", () => {
    renderWithMantine(<OptionChainPanel {...defaultProps} loading={true} />);
    const refreshBtn = screen.getByTestId("refresh-chain-btn");
    expect(refreshBtn.style.opacity).toBe("0.5");
  });

  it("enables refresh icon when not loading", () => {
    renderWithMantine(<OptionChainPanel {...defaultProps} loading={false} />);
    const refreshBtn = screen.getByTestId("refresh-chain-btn");
    expect(refreshBtn.style.opacity).toBe("1");
  });

  it("renders Guide button and opens guide modal on click", () => {
    renderWithMantine(<OptionChainPanel {...defaultProps} />);
    const guideBtn = screen.getByTestId("open-guide-btn");
    expect(guideBtn).toBeInTheDocument();
    expect(screen.queryByTestId("options-chain-guide-modal")).not.toBeInTheDocument();
    fireEvent.click(guideBtn);
    expect(screen.getByTestId("options-chain-guide-modal")).toBeInTheDocument();
  });

  it("renders header controls", () => {
    renderWithMantine(<OptionChainPanel {...defaultProps} />);
    expect(screen.getByTestId("options-chain-header-controls")).toBeInTheDocument();
  });

  it("renders filters", () => {
    renderWithMantine(<OptionChainPanel {...defaultProps} />);
    expect(screen.getByTestId("options-chain-filters")).toBeInTheDocument();
  });

  describe("loading state", () => {
    it("shows loading spinner with text when loading and no data", () => {
      renderWithMantine(<OptionChainPanel {...defaultProps} loading={true} strikeMatrix={[]} />);
      expect(screen.getByTestId("chain-loading")).toBeInTheDocument();
      expect(screen.getByText("Loading option chain...")).toBeInTheDocument();
    });

    it("does not show alert or table when loading", () => {
      renderWithMantine(<OptionChainPanel {...defaultProps} loading={true} strikeMatrix={[]} />);
      expect(screen.queryByTestId("chain-error-alert")).not.toBeInTheDocument();
      expect(screen.queryByTestId("no-data-alert")).not.toBeInTheDocument();
    });
  });

  describe("error state", () => {
    it("shows red alert with error message", () => {
      renderWithMantine(<OptionChainPanel {...defaultProps} error="Failed to fetch chain data" />);
      expect(screen.getByTestId("chain-error-alert")).toBeInTheDocument();
      expect(screen.getByText("Failed to fetch chain data")).toBeInTheDocument();
    });
  });

  describe("empty state", () => {
    it("shows yellow alert when strikeMatrix is empty and not loading", () => {
      renderWithMantine(<OptionChainPanel {...defaultProps} strikeMatrix={[]} />);
      expect(screen.getByTestId("no-data-alert")).toBeInTheDocument();
      expect(
        screen.getByText("No options data available. Select an underlying and expiry to view the chain."),
      ).toBeInTheDocument();
    });
  });

  describe("data state", () => {
    it("renders chain summary and table when data is available", () => {
      const strikeMatrix = [{ strike: 24500, ce: null, pe: null }];
      renderWithMantine(
        <OptionChainPanel {...defaultProps} strikeMatrix={strikeMatrix} />,
      );
      expect(screen.getByTestId("chain-summary")).toBeInTheDocument();
      expect(screen.getByTestId("options-chain-table")).toBeInTheDocument();
    });

    it("renders chain view tabs (Option Chain Table and Deep OI Analysis)", () => {
      const strikeMatrix = [{ strike: 24500, ce: null, pe: null }];
      renderWithMantine(
        <OptionChainPanel {...defaultProps} strikeMatrix={strikeMatrix} />,
      );
      expect(screen.getByTestId("options-chain-view-tabs-list")).toBeInTheDocument();
      expect(screen.getByTestId("chain-tab-table")).toBeInTheDocument();
      expect(screen.getByTestId("chain-tab-analysis")).toBeInTheDocument();
    });
  });
});
