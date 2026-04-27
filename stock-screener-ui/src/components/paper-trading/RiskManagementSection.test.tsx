// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
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
  // Risk Validation
  min_rr_ratio: 1.5,
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
});

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
      expect(header).toHaveClass("mantine-Text-root");
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
    it("calls onChange with key and Number(v) for Max Positions (no conversion)", () => {
      const onChange = vi.fn();
      render(
        <TestWrapper>
          <RiskManagementSection config={mockConfig} onChange={onChange} />
        </TestWrapper>,
      );

      const input = screen.getByTestId("config-max-positions");
      fireEvent.change(input, { target: { value: "7" } });

      expect(onChange).toHaveBeenCalledWith("max_positions", 7);
    });

    it("calls onChange with key and Number(v) / 100 for Capital/Trade %", () => {
      const onChange = vi.fn();
      render(
        <TestWrapper>
          <RiskManagementSection config={mockConfig} onChange={onChange} />
        </TestWrapper>,
      );

      const input = screen.getByTestId("config-capital-per-trade");
      fireEvent.change(input, { target: { value: "15" } });

      expect(onChange).toHaveBeenCalledWith("max_capital_per_trade_pct", 0.15);
    });

    it("calls onChange with key and Number(v) / 100 for Daily Loss %", () => {
      const onChange = vi.fn();
      render(
        <TestWrapper>
          <RiskManagementSection config={mockConfig} onChange={onChange} />
        </TestWrapper>,
      );

      const input = screen.getByTestId("config-daily-loss");
      fireEvent.change(input, { target: { value: "5" } });

      expect(onChange).toHaveBeenCalledWith("max_daily_loss_pct", 0.05);
    });

    it("calls onChange with key and Number(v) / 100 for Max Exposure %", () => {
      const onChange = vi.fn();
      render(
        <TestWrapper>
          <RiskManagementSection config={mockConfig} onChange={onChange} />
        </TestWrapper>,
      );

      const input = screen.getByTestId("config-max-exposure");
      fireEvent.change(input, { target: { value: "80" } });

      expect(onChange).toHaveBeenCalledWith("max_total_exposure_pct", 0.8);
    });

    it("calls onChange with key and Number(v) / 100 for Risk/Trade %", () => {
      const onChange = vi.fn();
      render(
        <TestWrapper>
          <RiskManagementSection config={mockConfig} onChange={onChange} />
        </TestWrapper>,
      );

      const input = screen.getByTestId("config-risk-per-trade");
      fireEvent.change(input, { target: { value: "2" } });

      expect(onChange).toHaveBeenCalledWith("risk_per_trade_pct", 0.02);
    });

    it("calls onChange with Number(v) for Min Trade Value (no conversion)", () => {
      const onChange = vi.fn();
      render(
        <TestWrapper>
          <RiskManagementSection config={mockConfig} onChange={onChange} />
        </TestWrapper>,
      );

      const input = screen.getByTestId("config-min-trade");
      fireEvent.change(input, { target: { value: "15000" } });

      expect(onChange).toHaveBeenCalledWith("min_trade_value", 15000);
    });

    it("calls onChange with Number(v) for Max Trade Value (no conversion)", () => {
      const onChange = vi.fn();
      render(
        <TestWrapper>
          <RiskManagementSection config={mockConfig} onChange={onChange} />
        </TestWrapper>,
      );

      const input = screen.getByTestId("config-max-trade");
      fireEvent.change(input, { target: { value: "200000" } });

      expect(onChange).toHaveBeenCalledWith("max_trade_value", 200000);
    });
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

    it("converts percentage input 15 in Capital/Trade to decimal 0.15", () => {
      const onChange = vi.fn();
      render(
        <TestWrapper>
          <RiskManagementSection config={mockConfig} onChange={onChange} />
        </TestWrapper>,
      );

      fireEvent.change(screen.getByTestId("config-capital-per-trade"), {
        target: { value: "15" },
      });

      expect(onChange).toHaveBeenCalledWith("max_capital_per_trade_pct", 0.15);
    });
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

    it("handles entering zero in percentage inputs", () => {
      const onChange = vi.fn();
      render(
        <TestWrapper>
          <RiskManagementSection config={mockConfig} onChange={onChange} />
        </TestWrapper>,
      );

      fireEvent.change(screen.getByTestId("config-capital-per-trade"), {
        target: { value: "0" },
      });

      expect(onChange).toHaveBeenCalledWith("max_capital_per_trade_pct", 0);
    });
  });

  describe("component structure", () => {
    it("has correct Grid structure with two rows for risk parameters", () => {
      const { container } = render(
        <TestWrapper>
          <RiskManagementSection config={mockConfig} onChange={vi.fn()} />
        </TestWrapper>,
      );

      // Check that there are multiple Grid elements
      const grids = container.querySelectorAll(".mantine-Grid-root");
      expect(grids.length).toBeGreaterThanOrEqual(2);
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
      // Mantine Text converts fw, size, tt to CSS styles and classes
      expect(header).toHaveStyle({ "font-weight": "600" });
      expect(header).toHaveStyle({ "text-transform": "uppercase" });
    });
  });

  describe("decimal precision handling", () => {
    it("handles decimal percentage inputs correctly (e.g. 2.5%)", () => {
      const onChange = vi.fn();
      render(
        <TestWrapper>
          <RiskManagementSection config={mockConfig} onChange={onChange} />
        </TestWrapper>,
      );

      fireEvent.change(screen.getByTestId("config-risk-per-trade"), {
        target: { value: "2.5" },
      });

      expect(onChange).toHaveBeenCalledWith("risk_per_trade_pct", 0.025);
    });

    it("converts large percentage to correct decimal", () => {
      const onChange = vi.fn();
      render(
        <TestWrapper>
          <RiskManagementSection config={mockConfig} onChange={onChange} />
        </TestWrapper>,
      );

      fireEvent.change(screen.getByTestId("config-daily-loss"), {
        target: { value: "10" },
      });

      expect(onChange).toHaveBeenCalledWith("max_daily_loss_pct", 0.1);
    });
  });

  describe("trade value inputs", () => {
    it("Min Trade Value accepts valid values within range", () => {
      const onChange = vi.fn();
      render(
        <TestWrapper>
          <RiskManagementSection config={mockConfig} onChange={onChange} />
        </TestWrapper>,
      );

      const input = screen.getByTestId("config-min-trade");
      fireEvent.change(input, { target: { value: "25000" } });

      expect(onChange).toHaveBeenCalledWith("min_trade_value", 25000);
    });

    it("Max Trade Value accepts valid values within range", () => {
      const onChange = vi.fn();
      render(
        <TestWrapper>
          <RiskManagementSection config={mockConfig} onChange={onChange} />
        </TestWrapper>,
      );

      const input = screen.getByTestId("config-max-trade");
      fireEvent.change(input, { target: { value: "300000" } });

      expect(onChange).toHaveBeenCalledWith("max_trade_value", 300000);
    });
  });
});
