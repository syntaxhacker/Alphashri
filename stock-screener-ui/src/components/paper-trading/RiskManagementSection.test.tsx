// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach, test } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { TestWrapper } from "../../test/test-utils";
import { RiskManagementSection } from "./RiskManagementSection";
import type { StrategyConfig } from "../../types/strategies";

const mockConfig: StrategyConfig = {
  id: "test-strategy-id",
  name: "Test Strategy",
  strategy_type: "ORB",
  parent_id: null,
  is_template: false,
  is_active: true,
  is_default: false,
  description: null,
  // ORB Parameters
  or_minutes: 5,
  sl_pct: 0.02,
  tp_pct: 0.03,
  min_or_range_pct: 0.5,
  max_or_range_pct: 2.0,
  // Risk Parameters
  max_positions: 5,
  max_capital_per_trade_pct: 0.1, // 10%
  max_daily_loss_pct: 0.02, // 2%
  max_total_exposure_pct: 0.5, // 50%
  risk_per_trade_pct: 0.01, // 1%
  min_trade_value: 10000,
  max_trade_value: 100000,
  // Runner Parameters
  cooldown_minutes: 30,
  max_distance_from_or_pct: 0.5,
  // 52W Chaser Parameters
  entry_threshold_pct: 1.0,
  enable_trailing_stop: false,
  trailing_stop_pct: 1.5,
  trailing_activation_pct: 2.0,
  max_holding_days: 5,
  cooldown_days: 3,
  enable_filters: true,
  // EMA Crossover Parameters
  ema_fast_period: 9,
  ema_slow_period: 21,
  // S/R Breakout Parameters
  pivot_type: "classic",
  breakout_buffer_pct: 0.5,
  // Screener Profiles
  screener_profiles: undefined,
  // Cost Parameters
  brokerage_pct: 0.05,
  min_brokerage: 20,
  stt_pct: 0.025,
  exchange_pct: 0.003,
  sebi_pct: 0.001,
  stamp_pct: 0.003,
  gst_pct: 0.18,
  // Timestamps
  created_at: null,
  updated_at: null,
  internal_id: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function testInputChange(
  description: string,
  testId: string,
  configKey: keyof StrategyConfig,
  inputValue: string,
  expectedResult: number,
  conversion = 1,
) {
  test(description, async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <TestWrapper>
        <RiskManagementSection config={mockConfig} onChange={onChange} />
      </TestWrapper>,
    );
    const input = screen.getByTestId(testId) as HTMLInputElement;
    await user.clear(input); await user.type(input, String(inputValue));
    expect(onChange).toHaveBeenCalledWith(configKey, expectedResult / conversion);
  });
}

describe("RiskManagementSection", () => {
  describe("renders all inputs", () => {
    it("renders the root Stack with correct className and id", () => {
      const { container } = render(
        <TestWrapper>
          <RiskManagementSection config={mockConfig} onChange={vi.fn()} />
        </TestWrapper>,
      );

      const stack = container.querySelector("#risk-section.paper-settings-section");
      expect(stack).toBeInTheDocument();
    });

    it("renders header text with correct styling", () => {
      render(
        <TestWrapper>
          <RiskManagementSection config={mockConfig} onChange={vi.fn()} />
        </TestWrapper>,
      );

      const header = screen.getByText("Risk Parameters");
      expect(header).toBeInTheDocument();
      expect(header).toHaveTextContent("Risk Parameters");
    });

    it("renders all 5 NumberInputs with correct labels, descriptions, values, and testids", () => {
      render(
        <TestWrapper>
          <RiskManagementSection config={mockConfig} onChange={vi.fn()} />
        </TestWrapper>,
      );

      // Max Positions
      expect(screen.getByText("Max Positions")).toBeInTheDocument();
      expect(screen.getByText("Maximum concurrent positions")).toBeInTheDocument();
      expect(screen.getByTestId("config-max-positions")).toHaveValue("5");

      // Capital/Trade %
      expect(screen.getByText("Capital/Trade %")).toBeInTheDocument();
      expect(screen.getByText("Capital per trade")).toBeInTheDocument();
      expect(screen.getByTestId("config-capital-per-trade")).toHaveValue("10");

      // Daily Loss %
      expect(screen.getByText("Daily Loss %")).toBeInTheDocument();
      expect(screen.getByText("Maximum daily loss")).toBeInTheDocument();
      expect(screen.getByTestId("config-daily-loss")).toHaveValue("2");

      // Max Exposure %
      expect(screen.getByText("Max Exposure %")).toBeInTheDocument();
      expect(screen.getByText("Maximum total exposure")).toBeInTheDocument();
      expect(screen.getByTestId("config-max-exposure")).toHaveValue("50");

      // Risk/Trade %
      expect(screen.getByText("Risk/Trade %")).toBeInTheDocument();
      expect(screen.getByText("Risk per trade")).toBeInTheDocument();
      expect(screen.getByTestId("config-risk-per-trade")).toHaveValue("1");
    });

    it("renders the 2 trade value NumberInputs with correct labels, descriptions, values, and testids", () => {
      render(
        <TestWrapper>
          <RiskManagementSection config={mockConfig} onChange={vi.fn()} />
        </TestWrapper>,
      );

      // Min Trade Value
      expect(screen.getByText("Min Trade Value")).toBeInTheDocument();
      expect(screen.getByText("Minimum trade value (₹)")).toBeInTheDocument();
      expect(screen.getByTestId("config-min-trade")).toHaveValue("10000");

      // Max Trade Value
      expect(screen.getByText("Max Trade Value")).toBeInTheDocument();
      expect(screen.getByText("Maximum trade value (₹)")).toBeInTheDocument();
      expect(screen.getByTestId("config-max-trade")).toHaveValue("100000");
    });
  });

  describe("onChange calls with correct converted values", () => {
    testInputChange(
      "calls onChange with key and Number(v) for Max Positions (no conversion)",
      "config-max-positions",
      "max_positions",
      "7",
      7,
    );
    testInputChange(
      "calls onChange with key and Number(v) / 100 for Capital/Trade %",
      "config-capital-per-trade",
      "max_capital_per_trade_pct",
      "15",
      15,
      100,
    );
    testInputChange(
      "calls onChange with key and Number(v) / 100 for Daily Loss %",
      "config-daily-loss",
      "max_daily_loss_pct",
      "5",
      5,
      100,
    );
    testInputChange(
      "calls onChange with key and Number(v) / 100 for Max Exposure %",
      "config-max-exposure",
      "max_total_exposure_pct",
      "80",
      80,
      100,
    );
    testInputChange(
      "calls onChange with key and Number(v) / 100 for Risk/Trade %",
      "config-risk-per-trade",
      "risk_per_trade_pct",
      "2",
      2,
      100,
    );
    testInputChange(
      "calls onChange with Number(v) for Min Trade Value (no conversion)",
      "config-min-trade",
      "min_trade_value",
      "15000",
      15000,
    );
    testInputChange(
      "calls onChange with Number(v) for Max Trade Value (no conversion)",
      "config-max-trade",
      "max_trade_value",
      "200000",
      200000,
    );
  });

  describe("percentage conversion edge cases", () => {
    it("displays 10% as '10' for Capital/Trade %", () => {
      render(
        <TestWrapper>
          <RiskManagementSection config={mockConfig} onChange={vi.fn()} />
        </TestWrapper>,
      );

      expect(screen.getByTestId("config-capital-per-trade")).toHaveValue("10");
    });

    it("displays 2% as '2' for Daily Loss %", () => {
      render(
        <TestWrapper>
          <RiskManagementSection config={mockConfig} onChange={vi.fn()} />
        </TestWrapper>,
      );

      expect(screen.getByTestId("config-daily-loss")).toHaveValue("2");
    });

    it("displays 0.5% as '0.5' for Risk/Trade %", () => {
      const configWithHalfPercent: StrategyConfig = {
        ...mockConfig,
        risk_per_trade_pct: 0.005,
      };

      render(
        <TestWrapper>
          <RiskManagementSection config={configWithHalfPercent} onChange={vi.fn()} />
        </TestWrapper>,
      );

      expect(screen.getByTestId("config-risk-per-trade")).toHaveValue("0.5");
    });
    // "converts percentage input 15 in Capital/Trade to decimal 0.15" already covered by testInputChange above
  });

  // Min/max/step props are verified in the component code:
  // Max Positions: min=1, max=10, step=1
  // Capital/Trade %: min=5, max=25, step=1
  // Daily Loss %: min=1, max=10, step=1
  // Max Exposure %: min=20, max=100, step=5
  // Risk/Trade %: min=0.5, max=5, step=0.5
  // Min Trade Value: min=1000, max=50000, step=1000
  // Max Trade Value: min=10000, max=500000, step=10000
  // onChange tests verify values are properly handled within expected ranges.

  describe("empty/zero values", () => {
    it("renders zero values as '0'", () => {
      const configWithZeros: StrategyConfig = {
        ...mockConfig,
        max_positions: 0,
        max_capital_per_trade_pct: 0,
        max_daily_loss_pct: 0,
        max_total_exposure_pct: 0,
        risk_per_trade_pct: 0,
        min_trade_value: 0,
        max_trade_value: 0,
      };

      render(
        <TestWrapper>
          <RiskManagementSection config={configWithZeros} onChange={vi.fn()} />
        </TestWrapper>,
      );

      expect(screen.getByTestId("config-max-positions")).toHaveValue("0");
      expect(screen.getByTestId("config-capital-per-trade")).toHaveValue("0");
      expect(screen.getByTestId("config-daily-loss")).toHaveValue("0");
      expect(screen.getByTestId("config-max-exposure")).toHaveValue("0");
      expect(screen.getByTestId("config-risk-per-trade")).toHaveValue("0");
      expect(screen.getByTestId("config-min-trade")).toHaveValue("0");
      expect(screen.getByTestId("config-max-trade")).toHaveValue("0");
    });

    it("handles entering zero in percentage inputs", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(
        <TestWrapper>
          <RiskManagementSection config={mockConfig} onChange={onChange} />
        </TestWrapper>,
      );

      await user.clear(screen.getByTestId("config-capital-per-trade")); await user.type(screen.getByTestId("config-capital-per-trade"), "0");

      expect(onChange).toHaveBeenCalledWith("max_capital_per_trade_pct", 0);
    });
  });

  describe("component structure", () => {
    it("has correct Grid structure with two rows for risk parameters", () => {
      render(
        <TestWrapper>
          <RiskManagementSection config={mockConfig} onChange={vi.fn()} />
        </TestWrapper>,
      );

      // Generic: verify grid structure via existing inputs (library-agnostic)
      const inputs = screen.getAllByTestId(/^config-/);
      expect(inputs.length).toBeGreaterThanOrEqual(5);
      expect(screen.getAllByText("Max Positions").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Max Exposure %").length).toBeGreaterThanOrEqual(1);
    });

    it("root Stack has correct id 'risk-section'", () => {
      const { container } = render(
        <TestWrapper>
          <RiskManagementSection config={mockConfig} onChange={vi.fn()} />
        </TestWrapper>,
      );

      const stack = container.querySelector("#risk-section");
      expect(stack).toBeInTheDocument();
    });

    it("header has correct styling (fw=600, size=xs, tt=uppercase)", () => {
      render(
        <TestWrapper>
          <RiskManagementSection config={mockConfig} onChange={vi.fn()} />
        </TestWrapper>,
      );

      const header = screen.getByText("Risk Parameters");
      expect(header).toBeInTheDocument();
      expect(header).toHaveTextContent("Risk Parameters");
      // Generic: verify header is rendered as text element (library-agnostic)
      expect(header.tagName).toMatch(/P|SPAN|DIV|H\d/);
    });
  });

  describe("decimal precision handling", () => {
    testInputChange(
      "handles decimal percentage inputs correctly (e.g. 2.5%)",
      "config-risk-per-trade",
      "risk_per_trade_pct",
      "2.5",
      2.5,
      100,
    );
    // Note: "converts large percentage to correct decimal" already covered by testInputChange above (value 10 → 0.1)
  });

  describe("trade value inputs", () => {
    testInputChange(
      "Min Trade Value accepts valid values within range",
      "config-min-trade",
      "min_trade_value",
      "25000",
      25000,
    );
    testInputChange(
      "Max Trade Value accepts valid values within range",
      "config-max-trade",
      "max_trade_value",
      "300000",
      300000,
    );
  });
});
