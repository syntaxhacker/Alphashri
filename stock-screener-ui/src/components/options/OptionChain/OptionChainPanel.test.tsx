// @vitest-environment happy-dom
import { Show } from "solid-js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { OptionChainPanel } from "./OptionChainPanel";
import { CHAIN_POLL_INTERVAL_MS } from "../../../hooks/useChainLivePolling";
import { setupBrowserMocks } from "../../../test-utils/setupBrowser";

vi.mock("@/ui", async (importOriginal) => {
  const { mockSolidUi } = await import("@/patterns/solidUiMock");
  const actual = await importOriginal<typeof import("@/ui")>();
  return mockSolidUi(actual);
});

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
  OptionChainGuide: (props: any) => (
    <Show when={props.opened}>
      <div data-testid="options-chain-guide-modal">Guide</div>
    </Show>
  ),
}));

vi.mock("./LiveSpotChart", () => ({
  LiveSpotChart: (props: any) => (
    <div data-testid="options-live-spot-chart">Chart for {props.underlying}</div>
  ),
}));

beforeEach(() => setupBrowserMocks());
afterEach(() => cleanup());

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
    render(() => <OptionChainPanel {...defaultProps} />);
    expect(screen.getByTestId("options-chain-panel")).toBeInTheDocument();
  });

  it("renders spot info header row without redundant title text", () => {
    const strikeMatrix = [{ strike: 24500, ce: null, pe: null }];
    render(() => <OptionChainPanel {...defaultProps} strikeMatrix={strikeMatrix} />);
    expect(screen.getByTestId("options-chain-header")).toBeInTheDocument();
    expect(screen.queryByText("Option Chain")).not.toBeInTheDocument();
  });

  it("renders LiveSpotChart with underlying prop", () => {
    render(() => <OptionChainPanel {...defaultProps} selectedUnderlying="BANKNIFTY" />);
    expect(screen.getByTestId("options-live-spot-chart")).toHaveTextContent("Chart for BANKNIFTY");
  });

  it("renders timestamp badge showing HH:mm:ss", () => {
    render(() => <OptionChainPanel {...defaultProps} />);
    const badge = screen.getByTestId("options-chain-timestamp");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent(/^\d{2}:\d{2}:\d{2}$/);
  });

  it("does not render timestamp badge when loading", () => {
    render(() => <OptionChainPanel {...defaultProps} loading={true} />);
    expect(screen.queryByTestId("options-chain-timestamp")).not.toBeInTheDocument();
  });

  it("does not render timestamp badge when timestamp is undefined", () => {
    const rest = { ...defaultProps } as Record<string, any>;
    delete rest.timestamp;
    render(() => <OptionChainPanel {...rest} />);
    expect(screen.queryByTestId("options-chain-timestamp")).not.toBeInTheDocument();
  });

  it("shows underlying-expiry selection label", () => {
    render(() => <OptionChainPanel {...defaultProps} selectedUnderlying="BANKNIFTY" selectedExpiry="01JUN" />);
    expect(screen.getByTestId("options-chain-selection")).toHaveTextContent("BANKNIFTY · 01JUN");
  });

  it("calls refreshChain when refresh icon is clicked", () => {
    const refreshChain = vi.fn();
    render(() => <OptionChainPanel {...defaultProps} refreshChain={refreshChain} />);
    fireEvent.click(screen.getByTestId("refresh-chain-btn"));
    expect(refreshChain).toHaveBeenCalledTimes(1);
  });

  it("disables refresh button while loading", () => {
    render(() => <OptionChainPanel {...defaultProps} loading={true} />);
    const refreshBtn = screen.getByTestId("refresh-chain-btn");
    expect(refreshBtn).toBeDisabled();
  });

  it("enables refresh button when not loading", () => {
    render(() => <OptionChainPanel {...defaultProps} loading={false} />);
    const refreshBtn = screen.getByTestId("refresh-chain-btn");
    expect(refreshBtn).toBeEnabled();
  });

  it("renders Guide button and opens guide modal on click", () => {
    render(() => <OptionChainPanel {...defaultProps} />);
    const guideBtn = screen.getByTestId("open-guide-btn");
    expect(guideBtn).toBeInTheDocument();
    expect(screen.queryByTestId("options-chain-guide-modal")).not.toBeInTheDocument();
    fireEvent.click(guideBtn);
    expect(screen.getByTestId("options-chain-guide-modal")).toBeInTheDocument();
  });

  it("does not render header controls (moved to options toolbar)", () => {
    render(() => <OptionChainPanel {...defaultProps} />);
    expect(screen.queryByTestId("options-chain-header-controls")).not.toBeInTheDocument();
  });

  it("does not render filters (moved to options toolbar)", () => {
    render(() => <OptionChainPanel {...defaultProps} />);
    expect(screen.queryByTestId("options-chain-filters")).not.toBeInTheDocument();
  });

  describe("loading state", () => {
    it("shows loading spinner with text when loading and no data", () => {
      render(() => <OptionChainPanel {...defaultProps} loading={true} strikeMatrix={[]} />);
      expect(screen.getByTestId("chain-loading")).toBeInTheDocument();
      expect(screen.getByText("Loading option chain...")).toBeInTheDocument();
    });

    it("does not show alert or table when loading", () => {
      render(() => <OptionChainPanel {...defaultProps} loading={true} strikeMatrix={[]} />);
      expect(screen.queryByTestId("chain-error-alert")).not.toBeInTheDocument();
      expect(screen.queryByTestId("no-data-alert")).not.toBeInTheDocument();
    });
  });

  describe("error state", () => {
    it("shows red alert with error message", () => {
      render(() => <OptionChainPanel {...defaultProps} error="Failed to fetch chain data" />);
      expect(screen.getByTestId("chain-error-alert")).toBeInTheDocument();
      expect(screen.getByText("Failed to fetch chain data")).toBeInTheDocument();
    });
  });

  describe("empty state", () => {
    it("shows yellow alert when strikeMatrix is empty and not loading", () => {
      render(() => <OptionChainPanel {...defaultProps} strikeMatrix={[]} />);
      expect(screen.getByTestId("no-data-alert")).toBeInTheDocument();
      expect(
        screen.getByText("No options data available. Select an underlying and expiry to view the chain."),
      ).toBeInTheDocument();
    });
  });

  describe("data state", () => {
    it("renders chain summary and table when data is available", () => {
      const strikeMatrix = [{ strike: 24500, ce: null, pe: null }];
      render(() => <OptionChainPanel {...defaultProps} strikeMatrix={strikeMatrix} />);
      expect(screen.getByTestId("chain-summary")).toBeInTheDocument();
      expect(screen.getByTestId("options-chain-table")).toBeInTheDocument();
    });

    it("renders chain view tabs (Option Chain Table and Deep OI Analysis)", () => {
      const strikeMatrix = [{ strike: 24500, ce: null, pe: null }];
      render(() => <OptionChainPanel {...defaultProps} strikeMatrix={strikeMatrix} />);
      expect(screen.getByTestId("options-chain-view-tabs-list")).toBeInTheDocument();
      expect(screen.getByTestId("chain-tab-table")).toBeInTheDocument();
      expect(screen.getByTestId("chain-tab-analysis")).toBeInTheDocument();
    });
  });

  describe("live sync badge", () => {
    it("shows · LIVE next to the timestamp when the chain is fresh", () => {
      render(() => <OptionChainPanel {...defaultProps} timestamp={new Date().toISOString()} />);
      expect(screen.getByTestId("options-chain-timestamp")).toBeInTheDocument();
      expect(screen.getByTestId("options-chain-live-badge")).toHaveTextContent("· LIVE");
    });

    it("shows · STALE with age when the chain timestamp is old", () => {
      render(() => <OptionChainPanel {...defaultProps} />);
      const badge = screen.getByTestId("options-chain-live-badge");
      expect(badge).toHaveTextContent(/· STALE/);
      expect(badge).not.toHaveTextContent("LIVE");
    });

    it("hides the live badge together with the timestamp while loading", () => {
      render(() => <OptionChainPanel {...defaultProps} loading={true} />);
      expect(screen.queryByTestId("options-chain-live-badge")).not.toBeInTheDocument();
    });
  });

  describe("live sync polling", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("refetches the chain every 15s while the chain tab is mounted", async () => {
      const refreshChain = vi.fn();
      render(() => <OptionChainPanel {...defaultProps} refreshChain={refreshChain} />);
      expect(refreshChain).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(CHAIN_POLL_INTERVAL_MS);
      expect(refreshChain).toHaveBeenCalledTimes(1);
    });

    it("stops polling on unmount (positions/greeks tabs)", async () => {
      const refreshChain = vi.fn();
      const rendered = render(() => <OptionChainPanel {...defaultProps} refreshChain={refreshChain} />);
      await vi.advanceTimersByTimeAsync(CHAIN_POLL_INTERVAL_MS);
      expect(refreshChain).toHaveBeenCalledTimes(1);
      rendered.unmount();
      await vi.advanceTimersByTimeAsync(CHAIN_POLL_INTERVAL_MS * 3);
      expect(refreshChain).toHaveBeenCalledTimes(1);
    });

    it("manual refresh fetches immediately and resets the 15s timer", async () => {
      const refreshChain = vi.fn();
      render(() => <OptionChainPanel {...defaultProps} refreshChain={refreshChain} />);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(refreshChain).not.toHaveBeenCalled();
      screen.getByTestId("refresh-chain-btn").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      expect(refreshChain).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(refreshChain).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(refreshChain).toHaveBeenCalledTimes(2);
    });
  });
});
