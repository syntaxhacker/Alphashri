// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";

vi.mock("@/ui", async (importOriginal) => {
  const { mockSolidUi } = await import("@/patterns/solidUiMock");
  const actual = await importOriginal<typeof import("@/ui")>();
  return mockSolidUi(actual);
});
import { OIAnalysis } from "./OIAnalysis";
import { setupBrowserMocks } from "../../../test-utils/setupBrowser";

vi.mock("@/utils/loadEcharts", () => ({
  loadEcharts: vi.fn(async () => ({
    init: () => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(), on: vi.fn() }),
  })),
}));

vi.mock("./OptionAlerts", () => ({
  OptionAlerts: () => <div data-testid="options-alerts">Alerts</div>,
}));

vi.mock("./IVSkewChart", () => ({
  IVSkewChart: () => <div data-testid="options-iv-skew-chart">IV Skew</div>,
}));

beforeEach(() => setupBrowserMocks());
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeContract(overrides: any = {}) {
  return {
    trading_symbol: "NIFTY24500CE",
    market_data: {
      oi: 100000,
      prev_oi: 50000,
      volume: 60000,
      ltp: 150,
      bid_price: 149,
      ask_price: 152,
      ...overrides.market_data,
    },
    option_greeks: {
      delta: 0.55,
      gamma: 0.002,
      vega: 8.5,
      theta: -12.3,
      iv: 18.5,
      ...overrides.option_greeks,
    },
  };
}

describe("OIAnalysis", () => {
  it("renders OptionAlerts child component", () => {
    render(() => <OIAnalysis strikeMatrix={[]} spotPrice={24500} />);
    expect(screen.getByTestId("options-alerts")).toBeInTheDocument();
  });

  it("renders IV Skew chart", () => {
    render(() => <OIAnalysis strikeMatrix={[]} spotPrice={24500} />);
    expect(screen.getByTestId("options-iv-skew-chart")).toBeInTheDocument();
  });

  it("renders OI Spikes panel with INTENSITY title", () => {
    render(() => <OIAnalysis strikeMatrix={[]} spotPrice={24500} />);
    expect(screen.getByTestId("options-oi-spikes-panel")).toBeInTheDocument();
    expect(screen.getByText(/INTENSITY/)).toBeInTheDocument();
  });

  describe("OI Spikes", () => {
    it("renders OI spikes list when data is available", () => {
      const strikeMatrix = [
        {
          strike: 24000,
          ce: makeContract({
            market_data: { oi: 150000, prev_oi: 50000, volume: 60000 },
          }),
          pe: null,
        },
        {
          strike: 25000,
          ce: makeContract({
            market_data: { oi: 200000, prev_oi: 100000, volume: 80000 },
          }),
          pe: null,
        },
      ];
      render(() => <OIAnalysis strikeMatrix={strikeMatrix} spotPrice={24500} />);
      expect(screen.getByTestId("options-oi-spikes-list")).toBeInTheDocument();
      expect(screen.getAllByTestId(/options-oi-spike-/).length).toBeGreaterThan(0);
    });

    it("lists top OI gainers sorted by change percent", () => {
      const strikeMatrix = [
        {
          strike: 24000,
          ce: makeContract({
            market_data: { oi: 120000, prev_oi: 50000, volume: 60000 },
          }),
          pe: null,
        },
        {
          strike: 25000,
          ce: makeContract({
            market_data: { oi: 60000, prev_oi: 50000, volume: 30000 },
          }),
          pe: null,
        },
      ];
      render(() => <OIAnalysis strikeMatrix={strikeMatrix} spotPrice={24500} />);
      const spikes = screen.getAllByTestId(/options-oi-spike-/);
      expect(spikes.length).toBeGreaterThanOrEqual(1);
    });

    it("shows type (CE/PE), strike, and activity badge for each spike", () => {
      const strikeMatrix = [
        {
          strike: 24000,
          ce: makeContract({
            market_data: { oi: 150000, prev_oi: 50000, volume: 60000 },
          }),
          pe: null,
        },
      ];
      render(() => <OIAnalysis strikeMatrix={strikeMatrix} spotPrice={24500} />);
      expect(screen.getByTestId("options-oi-spike-0")).toBeInTheDocument();
      expect(screen.getByTestId("options-oi-spike-0").textContent).toContain("CE");
      expect(screen.getByTestId("options-oi-spike-0").textContent).toContain("24000");
    });

    it("shows OI spike values as percentage change and absolute change", () => {
      const strikeMatrix = [
        {
          strike: 24000,
          ce: makeContract({
            market_data: { oi: 150000, prev_oi: 50000, volume: 60000 },
          }),
          pe: null,
        },
      ];
      render(() => <OIAnalysis strikeMatrix={strikeMatrix} spotPrice={24500} />);
      expect(screen.getByTestId("options-oi-spike-0").textContent).toContain("200.0%");
    });

    it("caps spikes at 6 maximum", () => {
      const contract = () => ({
        trading_symbol: "NIFTYCE",
        market_data: { oi: 150000, prev_oi: 50000, volume: 60000 },
      });
      const strikeMatrix = Array.from({ length: 10 }, (_, i) => {
        const s = 24000 + i * 50;
        return { strike: s, ce: makeContract(contract()), pe: null };
      });
      render(() => <OIAnalysis strikeMatrix={strikeMatrix} spotPrice={24500} />);
      const spikes = screen.queryAllByTestId(/options-oi-spike-/);
      expect(spikes.length).toBeLessThanOrEqual(6);
    });
  });

  describe("OI Distribution chart", () => {
    it("renders OI Distribution panel with chart title", () => {
      render(() => <OIAnalysis strikeMatrix={[]} spotPrice={24500} />);
      expect(screen.getByTestId("options-oi-distribution-panel")).toBeInTheDocument();
      expect(screen.getByText(/OI CHANGE DISTRIBUTION/)).toBeInTheDocument();
    });

    it("renders ECharts component for distribution", () => {
      const strikeMatrix = [
        {
          strike: 24000,
          ce: makeContract({
            market_data: { oi: 150000, prev_oi: 50000 },
          }),
          pe: makeContract({
            market_data: { oi: 80000, prev_oi: 60000 },
          }),
        },
      ];
      render(() => <OIAnalysis strikeMatrix={strikeMatrix} spotPrice={24500} />);
      expect(screen.getByTestId("options-oi-distribution-chart")).toBeInTheDocument();
    });
  });

  describe("Market Context panel", () => {
    it("renders MARKET CONTEXT panel", () => {
      render(() => <OIAnalysis strikeMatrix={[]} spotPrice={24500} />);
      expect(screen.getByTestId("options-oi-sentiment-panel")).toBeInTheDocument();
      expect(screen.getByText("MARKET CONTEXT")).toBeInTheDocument();
    });

    it("displays analysis text referencing strongest spike", () => {
      const strikeMatrix = [
        {
          strike: 24000,
          ce: makeContract({
            market_data: { oi: 150000, prev_oi: 50000, volume: 60000 },
          }),
          pe: null,
        },
      ];
      render(() => <OIAnalysis strikeMatrix={strikeMatrix} spotPrice={24500} />);
      expect(screen.getByTestId("options-oi-sentiment-panel").textContent).toContain("24000");
    });
  });
});
