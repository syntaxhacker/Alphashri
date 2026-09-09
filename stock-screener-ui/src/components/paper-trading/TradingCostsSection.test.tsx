// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {render, screen, cleanup, within, fireEvent} from "@testing-library/react";
import { TradingCostsSection } from "./TradingCostsSection";
import type { StrategyConfig } from "../../types/strategies";
import { TestWrapper } from "../../test/test-utils";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function mockConfig(overrides: Partial<StrategyConfig> = {}): StrategyConfig {
  return {
    id: "test-config",
    name: "Test Config",
    strategy_type: "TEST",
    parent_id: null,
    is_template: false,
    is_active: true,
    is_default: false,
    description: null,
    // ORB Parameters
    or_minutes: 5,
    sl_pct: 1.0,
    tp_pct: 2.0,
    min_or_range_pct: 0.5,
    max_or_range_pct: 2.0,
    // Risk Parameters
    max_positions: 5,
    max_capital_per_trade_pct: 5.0,
    max_daily_loss_pct: 1.0,
    max_total_exposure_pct: 20.0,
    risk_per_trade_pct: 1.0,
    min_trade_value: 10000,
    max_trade_value: 100000,
    // Runner Parameters
    cooldown_minutes: 60,
    max_distance_from_or_pct: 0.5,
    // 52W Chaser Parameters
    entry_threshold_pct: 1.5,
    enable_trailing_stop: false,
    trailing_stop_pct: 0.5,
    trailing_activation_pct: 2.0,
    max_holding_days: 3,
    cooldown_days: 1,
    enable_filters: false,
    // EMA Crossover Parameters
    ema_fast_period: 12,
    ema_slow_period: 26,
    // S/R Breakout Parameters
    pivot_type: "high",
    breakout_buffer_pct: 0.3,
    // Screener Profiles
    screener_profiles: [],
    // Cost Parameters
    brokerage_pct: 0.001, // 0.1%
    min_brokerage: 20,
    stt_pct: 0.001, // 0.1%
    exchange_pct: 0.0001, // 0.01%
    sebi_pct: 0.0001, // 0.01%
    stamp_pct: 0.0001, // 0.01%
    gst_pct: 0.18, // 18%
    // Timestamps
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

describe("TradingCostsSection", () => {
  const mockOnChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const defaultProps = {
    config: mockConfig(),
    onChange: mockOnChange,
  };

  it("renders section with testid", () => {
    render(<TradingCostsSection {...defaultProps} />, { wrapper: TestWrapper });
    expect(screen.getByTestId("config-brokerage")).toBeInTheDocument();
    expect(screen.getByTestId("config-min-brokerage")).toBeInTheDocument();
    expect(screen.getByTestId("config-stt")).toBeInTheDocument();
    expect(screen.getByTestId("config-exchange")).toBeInTheDocument();
    expect(screen.getByTestId("config-sebi")).toBeInTheDocument();
    expect(screen.getByTestId("config-stamp")).toBeInTheDocument();
    expect(screen.getByTestId("config-gst")).toBeInTheDocument();
  });

  it("displays initial costs values as percentages", () => {
    render(<TradingCostsSection {...defaultProps} />, { wrapper: TestWrapper });
    // brokerage_pct: 0.001 => 0.1%
    expect(within(screen.getByTestId("config-brokerage")).getByRole("spinbutton")).toHaveValue(0.1);
    // stt_pct: 0.001 => 0.1%
    expect(within(screen.getByTestId("config-stt")).getByRole("spinbutton")).toHaveValue(0.1);
    // exchange_pct: 0.0001 => 0.01%
    expect(within(screen.getByTestId("config-exchange")).getByRole("spinbutton")).toHaveValue(0.01);
    // sebi_pct: 0.0001 => 0.01%
    expect(within(screen.getByTestId("config-sebi")).getByRole("spinbutton")).toHaveValue(0.01);
    // stamp_pct: 0.0001 => 0.01%
    expect(within(screen.getByTestId("config-stamp")).getByRole("spinbutton")).toHaveValue(0.01);
    // gst_pct: 18 => 18%
    expect(within(screen.getByTestId("config-gst")).getByRole("spinbutton")).toHaveValue(18);
  });

  it("displays min_brokerage as is", () => {
    render(<TradingCostsSection {...defaultProps} />, { wrapper: TestWrapper });
    expect(within(screen.getByTestId("config-min-brokerage")).getByRole("spinbutton")).toHaveValue(20);
  });

  it("calls onChange with key and converted value for brokerage", async () => {
      const user = userEvent.setup();
    render(<TradingCostsSection {...defaultProps} />, { wrapper: TestWrapper });
    const input = within(screen.getByTestId("config-brokerage")).getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "0.2" } });
    expect(mockOnChange).toHaveBeenCalledWith("brokerage_pct", 0.002); // 0.2/100
  });

  it("calls onChange for min_brokerage", async () => {
      const user = userEvent.setup();
    render(<TradingCostsSection {...defaultProps} />, { wrapper: TestWrapper });
    const input = within(screen.getByTestId("config-min-brokerage")).getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "50" } });
    expect(mockOnChange).toHaveBeenCalledWith("min_brokerage", 50);
  });

  it("calls onChange for stt", async () => {
      const user = userEvent.setup();
    render(<TradingCostsSection {...defaultProps} />, { wrapper: TestWrapper });
    const input = within(screen.getByTestId("config-stt")).getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "0.05" } });
    expect(mockOnChange).toHaveBeenCalledWith("stt_pct", 0.0005);
  });

  it("calls onChange for exchange", async () => {
      const user = userEvent.setup();
    render(<TradingCostsSection {...defaultProps} />, { wrapper: TestWrapper });
    const input = within(screen.getByTestId("config-exchange")).getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "0.02" } });
    expect(mockOnChange).toHaveBeenCalledWith("exchange_pct", 0.0002);
  });

  it("calls onChange for sebi", async () => {
      const user = userEvent.setup();
    render(<TradingCostsSection {...defaultProps} />, { wrapper: TestWrapper });
    const input = within(screen.getByTestId("config-sebi")).getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "0.015" } });
    expect(mockOnChange).toHaveBeenCalledWith("sebi_pct", 0.00015);
  });

  it("calls onChange for stamp", async () => {
      const user = userEvent.setup();
    render(<TradingCostsSection {...defaultProps} />, { wrapper: TestWrapper });
    const input = within(screen.getByTestId("config-stamp")).getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "0.02" } });
    expect(mockOnChange).toHaveBeenCalledWith("stamp_pct", 0.0002);
  });

  it("calls onChange for gst", async () => {
      const user = userEvent.setup();
    render(<TradingCostsSection {...defaultProps} />, { wrapper: TestWrapper });
    const input = within(screen.getByTestId("config-gst")).getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "20" } });
    expect(mockOnChange).toHaveBeenCalledWith("gst_pct", 0.2); // 20/100
  });

  it("renders labels correctly", () => {
    render(<TradingCostsSection {...defaultProps} />, { wrapper: TestWrapper });
    expect(screen.getByLabelText("Brokerage %")).toBeInTheDocument();
    expect(screen.getByLabelText("Min Brokerage")).toBeInTheDocument();
    expect(screen.getByLabelText("STT %")).toBeInTheDocument();
    expect(screen.getByLabelText("Exchange %")).toBeInTheDocument();
    expect(screen.getByLabelText("SEBI %")).toBeInTheDocument();
    expect(screen.getByLabelText("Stamp %")).toBeInTheDocument();
    expect(screen.getByLabelText("GST %")).toBeInTheDocument();
  });

  it("renders descriptions", () => {
    render(<TradingCostsSection {...defaultProps} />, { wrapper: TestWrapper });
    expect(screen.getByText("Brokerage percentage")).toBeInTheDocument();
    expect(screen.getByText("Minimum brokerage (₹)")).toBeInTheDocument();
    expect(screen.getByText("Securities transaction tax")).toBeInTheDocument();
    expect(screen.getByText("Exchange charges")).toBeInTheDocument();
    expect(screen.getByText("SEBI charges")).toBeInTheDocument();
    expect(screen.getByText("Stamp duty")).toBeInTheDocument();
    expect(screen.getByText("Goods and services tax")).toBeInTheDocument();
  });

  it("handles zero values", () => {
    const config = mockConfig({
      brokerage_pct: 0,
      min_brokerage: 0,
      stt_pct: 0,
      exchange_pct: 0,
      sebi_pct: 0,
      stamp_pct: 0,
      gst_pct: 0,
    });
    render(<TradingCostsSection config={config} onChange={mockOnChange} />, {
      wrapper: TestWrapper,
    });
    expect(within(screen.getByTestId("config-brokerage")).getByRole("spinbutton")).toHaveValue(0);
    expect(within(screen.getByTestId("config-min-brokerage")).getByRole("spinbutton")).toHaveValue(0);
    expect(within(screen.getByTestId("config-stt")).getByRole("spinbutton")).toHaveValue(0);
    expect(within(screen.getByTestId("config-gst")).getByRole("spinbutton")).toHaveValue(0);
  });

  it("handles fractional percentages correctly", () => {
    const config = mockConfig({
      brokerage_pct: 0.0005, // 0.05%
      exchange_pct: 0.00005, // 0.005%
    });
    render(<TradingCostsSection config={config} onChange={mockOnChange} />, {
      wrapper: TestWrapper,
    });
    expect(within(screen.getByTestId("config-brokerage")).getByRole("spinbutton")).toHaveValue(0.05);
    expect(within(screen.getByTestId("config-exchange")).getByRole("spinbutton")).toHaveValue(0.005);
  });
});
