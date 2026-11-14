// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSignal } from "solid-js";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { OptionsPage } from "./OptionsPage";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";

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
    render(() => <OptionsPage {...defaultProps} />);
    expect(screen.getByTestId("options-chain-panel")).toBeInTheDocument();
  });

  it("shows positions panel when activeTab is positions", () => {
    render(() => <OptionsPage {...defaultProps} activeTab="positions" />);
    expect(screen.getByTestId("options-positions-panel")).toBeInTheDocument();
  });

  it("hides chain panel when positions tab is active", () => {
    render(() => <OptionsPage {...defaultProps} activeTab="positions" />);
    expect(screen.queryByTestId("options-chain-panel")).not.toBeInTheDocument();
  });

  it("shows premium panel when activeTab is premium", () => {
    render(() => <OptionsPage {...defaultProps} activeTab="premium" />);
    expect(screen.getByTestId("premium-tracker-panel")).toBeInTheDocument();
  });

  it("hides chain panel when premium tab is active", () => {
    render(() => <OptionsPage {...defaultProps} activeTab="premium" />);
    expect(screen.queryByTestId("options-chain-panel")).not.toBeInTheDocument();
  });

  it("renders simulator tab", () => {
    render(() => <OptionsPage {...defaultProps} />);
    expect(screen.getByText("Simulator")).toBeInTheDocument();
  });

  it("shows simulator panel when activeTab is simulator", () => {
    render(() => <OptionsPage {...defaultProps} activeTab="simulator" />);
    expect(screen.getByTestId("options-simulator-tab")).toBeInTheDocument();
    expect(screen.getByTestId("simulator-panel")).toBeInTheDocument();
  });

  it("hides chain panel when simulator tab is active", () => {
    render(() => <OptionsPage {...defaultProps} activeTab="simulator" />);
    expect(screen.queryByTestId("options-chain-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("simulator-panel")).toBeInTheDocument();
  });

  it("reacts to a signal-backed activeTab after mutation", () => {
    const [activeTab, setActiveTab] = createSignal("chain");
    const { container } = render(() => <OptionsPage {...defaultProps} activeTab={activeTab()} />);

    expect(screen.getByTestId("options-chain-panel")).toBeInTheDocument();
    expect(container.querySelector("#options-chain-controls-bar")).not.toBeNull();

    setActiveTab("positions");

    expect(screen.queryByTestId("options-chain-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("options-positions-panel")).toBeInTheDocument();

    setActiveTab("simulator");

    expect(screen.queryByTestId("options-positions-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("simulator-panel")).toBeInTheDocument();
    expect(container.querySelector("#options-chain-controls-bar")).toBeNull();

    setActiveTab("chain");

    expect(screen.getByTestId("options-chain-panel")).toBeInTheDocument();
    expect(container.querySelector("#options-chain-controls-bar")).not.toBeNull();
  });

  describe("context band", () => {
    const band = () => document.querySelector("#options-chain-controls-bar");

    it("holds the filters and the actions on one row", () => {
      render(() => <OptionsPage {...defaultProps} />);
      const bar = band()!;
      const testids = Array.from(bar.querySelectorAll("[data-testid]")).map((el) =>
        el.getAttribute("data-testid"),
      );
      for (const id of [
        "underlying-select",
        "expiry-select",
        "option-type-select",
        "moneyness-select",
        "strike-min-input",
        "strike-max-input",
        "open-guide-btn",
        "refresh-chain-btn",
      ]) {
        expect(testids).toContain(id);
      }
    });

    it("pushes the actions cluster right, not onto its own row", () => {
      render(() => <OptionsPage {...defaultProps} />);
      const bar = band()!;
      expect(bar).toHaveClass("flex-nowrap");
      expect(screen.getByTestId("options-chain-actions")).toHaveClass("ml-auto");
    });

    it("calls refreshChain when the refresh action is clicked", () => {
      const refreshChain = vi.fn();
      render(() => <OptionsPage {...defaultProps} refreshChain={refreshChain} />);
      fireEvent.click(screen.getByTestId("refresh-chain-btn"));
      expect(refreshChain).toHaveBeenCalledTimes(1);
    });

    it("disables the refresh action while loading and enables it after", () => {
      render(() => <OptionsPage {...defaultProps} loading={true} />);
      expect(screen.getByTestId("refresh-chain-btn")).toBeDisabled();
      cleanup();
      render(() => <OptionsPage {...defaultProps} loading={false} />);
      expect(screen.getByTestId("refresh-chain-btn")).toBeEnabled();
    });

    it("opens the guide modal from the band", () => {
      render(() => <OptionsPage {...defaultProps} />);
      expect(screen.queryByTestId("options-chain-guide-modal")).not.toBeInTheDocument();
      fireEvent.click(screen.getByTestId("open-guide-btn"));
      expect(screen.getByTestId("options-chain-guide-modal")).toBeInTheDocument();
    });

    it("hides the actions on the positions tab", () => {
      render(() => <OptionsPage {...defaultProps} activeTab="positions" />);
      expect(screen.queryByTestId("options-chain-actions")).not.toBeInTheDocument();
    });
  });
});
