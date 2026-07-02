// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { UIProvider } from "@/ui";
import { OrbSettingsSection } from "./OrbSettingsSection";
import type { StrategyConfig } from "../../types/strategies";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

function Wrapper({ children }: { children: React.ReactNode }) {
  return <UIProvider>{children}</UIProvider>;
}

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
    or_minutes: 15,
    sl_pct: 0.4,
    tp_pct: 1.2,
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
    brokerage_pct: 0.001,
    min_brokerage: 20,
    stt_pct: 0.001,
    exchange_pct: 0.0001,
    sebi_pct: 0.0001,
    stamp_pct: 0.0001,
    gst_pct: 0.18,
    // Timestamps
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

describe("OrbSettingsSection", () => {
  const mockOnChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const defaultProps = {
    config: mockConfig(),
    onChange: mockOnChange,
  };

  describe("rendering", () => {
    it("renders the section with correct className and id", () => {
      render(<OrbSettingsSection {...defaultProps} />, { wrapper: Wrapper });
      const section = document.querySelector(".paper-settings-section");
      expect(section).toBeInTheDocument();
      expect(section).toHaveAttribute("id", "orb-section");
    });

    it("renders the header text", () => {
      render(<OrbSettingsSection {...defaultProps} />, { wrapper: Wrapper });
      expect(screen.getByText("Opening Range Breakout")).toBeInTheDocument();
    });

    it("renders all 5 input fields with correct labels", () => {
      render(<OrbSettingsSection {...defaultProps} />, { wrapper: Wrapper });
      expect(screen.getByText("OR Minutes")).toBeInTheDocument();
      expect(screen.getByText("Stop Loss %")).toBeInTheDocument();
      expect(screen.getByText("Take Profit %")).toBeInTheDocument();
      expect(screen.getByText("Min OR Range %")).toBeInTheDocument();
      expect(screen.getByText("Max OR Range %")).toBeInTheDocument();
    });

    it("renders all descriptions", () => {
      render(<OrbSettingsSection {...defaultProps} />, { wrapper: Wrapper });
      expect(screen.getByText("Opening range in minutes")).toBeInTheDocument();
      expect(screen.getByText("Stop loss percentage")).toBeInTheDocument();
      expect(screen.getByText("Take profit percentage")).toBeInTheDocument();
      expect(screen.getByText("Minimum ORB range")).toBeInTheDocument();
      expect(screen.getByText("Maximum ORB range")).toBeInTheDocument();
    });

    it("renders all inputs with correct data-testids", () => {
      render(<OrbSettingsSection {...defaultProps} />, { wrapper: Wrapper });
      expect(screen.getByTestId("config-or-minutes")).toBeInTheDocument();
      expect(screen.getByTestId("config-sl-pct")).toBeInTheDocument();
      expect(screen.getByTestId("config-tp-pct")).toBeInTheDocument();
      expect(screen.getByTestId("config-min-or-range")).toBeInTheDocument();
      expect(screen.getByTestId("config-max-or-range")).toBeInTheDocument();
    });

    it("displays initial values correctly", () => {
      render(<OrbSettingsSection {...defaultProps} />, { wrapper: Wrapper });
      expect(screen.getByTestId("config-or-minutes")).toHaveValue("15");
      expect(screen.getByTestId("config-sl-pct")).toHaveValue("0.4");
      expect(screen.getByTestId("config-tp-pct")).toHaveValue("1.2");
      expect(screen.getByTestId("config-min-or-range")).toHaveValue("0.5");
      expect(screen.getByTestId("config-max-or-range")).toHaveValue("2");
    });
  });

  describe("onChange behavior", () => {
    it("passes or_minutes value as-is (Number from NumberInput)", () => {
      render(<OrbSettingsSection {...defaultProps} />, { wrapper: Wrapper });
      const input = screen.getByTestId("config-or-minutes");
      fireEvent.change(input, { target: { value: "30" } });
      expect(mockOnChange).toHaveBeenCalledWith("or_minutes", 30);
    });

    it("converts sl_pct string to Number", () => {
      render(<OrbSettingsSection {...defaultProps} />, { wrapper: Wrapper });
      const input = screen.getByTestId("config-sl-pct");
      fireEvent.change(input, { target: { value: "0.5" } });
      expect(mockOnChange).toHaveBeenCalledWith("sl_pct", 0.5);
    });

    it("converts tp_pct string to Number", () => {
      render(<OrbSettingsSection {...defaultProps} />, { wrapper: Wrapper });
      const input = screen.getByTestId("config-tp-pct");
      fireEvent.change(input, { target: { value: "2.5" } });
      expect(mockOnChange).toHaveBeenCalledWith("tp_pct", 2.5);
    });

    it("converts min_or_range_pct string to Number", () => {
      render(<OrbSettingsSection {...defaultProps} />, { wrapper: Wrapper });
      const input = screen.getByTestId("config-min-or-range");
      fireEvent.change(input, { target: { value: "1.0" } });
      expect(mockOnChange).toHaveBeenCalledWith("min_or_range_pct", 1.0);
    });

    it("converts max_or_range_pct string to Number", () => {
      render(<OrbSettingsSection {...defaultProps} />, { wrapper: Wrapper });
      const input = screen.getByTestId("config-max-or-range");
      fireEvent.change(input, { target: { value: "5.5" } });
      expect(mockOnChange).toHaveBeenCalledWith("max_or_range_pct", 5.5);
    });
  });

  describe("SL validation error", () => {
    it("shows error when sl_pct is less than 0.1", () => {
      const config = mockConfig({ sl_pct: 0.05 });
      render(<OrbSettingsSection config={config} onChange={mockOnChange} />, { wrapper: Wrapper });
      const errorElement = screen.getByTestId("config-sl-pct-error");
      expect(errorElement).toBeInTheDocument();
      expect(errorElement).toHaveTextContent("Invalid stop loss percentage");
    });

    it("shows error when sl_pct is greater than 5", () => {
      const config = mockConfig({ sl_pct: 5.5 });
      render(<OrbSettingsSection config={config} onChange={mockOnChange} />, { wrapper: Wrapper });
      const errorElement = screen.getByTestId("config-sl-pct-error");
      expect(errorElement).toBeInTheDocument();
      expect(errorElement).toHaveTextContent("Invalid stop loss percentage");
    });

    it("does not show error when sl_pct is 0.1 (lower boundary)", () => {
      const config = mockConfig({ sl_pct: 0.1 });
      render(<OrbSettingsSection config={config} onChange={mockOnChange} />, { wrapper: Wrapper });
      expect(screen.queryByTestId("config-sl-pct-error")).not.toBeInTheDocument();
    });

    it("does not show error when sl_pct is 5 (upper boundary)", () => {
      const config = mockConfig({ sl_pct: 5 });
      render(<OrbSettingsSection config={config} onChange={mockOnChange} />, { wrapper: Wrapper });
      expect(screen.queryByTestId("config-sl-pct-error")).not.toBeInTheDocument();
    });

    it("does not show error when sl_pct is within valid range", () => {
      const config = mockConfig({ sl_pct: 1.5 });
      render(<OrbSettingsSection config={config} onChange={mockOnChange} />, { wrapper: Wrapper });
      expect(screen.queryByTestId("config-sl-pct-error")).not.toBeInTheDocument();
    });
  });

  describe("boundary values", () => {
    it("accepts sl_pct boundary values (0.1 and 5)", () => {
      const { rerender } = render(<OrbSettingsSection {...defaultProps} />, { wrapper: Wrapper });
      const slInput = screen.getByTestId("config-sl-pct");

      // Lower boundary
      rerender(
        <OrbSettingsSection config={mockConfig({ sl_pct: 0.1 })} onChange={mockOnChange} />,
        { wrapper: Wrapper },
      );
      expect(slInput).toHaveValue("0.1");
      expect(screen.queryByTestId("config-sl-pct-error")).not.toBeInTheDocument();

      // Upper boundary
      rerender(<OrbSettingsSection config={mockConfig({ sl_pct: 5 })} onChange={mockOnChange} />, {
        wrapper: Wrapper,
      });
      expect(slInput).toHaveValue("5");
      expect(screen.queryByTestId("config-sl-pct-error")).not.toBeInTheDocument();
    });

    it("accepts min_or_range_pct boundary values (0.1 and 5)", () => {
      const { rerender } = render(<OrbSettingsSection {...defaultProps} />, { wrapper: Wrapper });
      const minInput = screen.getByTestId("config-min-or-range");

      rerender(
        <OrbSettingsSection
          config={mockConfig({ min_or_range_pct: 0.1 })}
          onChange={mockOnChange}
        />,
        { wrapper: Wrapper },
      );
      expect(minInput).toHaveValue("0.1");

      rerender(
        <OrbSettingsSection config={mockConfig({ min_or_range_pct: 5 })} onChange={mockOnChange} />,
        { wrapper: Wrapper },
      );
      expect(minInput).toHaveValue("5");
    });

    it("accepts max_or_range_pct boundary values (1 and 10)", () => {
      const { rerender } = render(<OrbSettingsSection {...defaultProps} />, { wrapper: Wrapper });
      const maxInput = screen.getByTestId("config-max-or-range");

      rerender(
        <OrbSettingsSection config={mockConfig({ max_or_range_pct: 1 })} onChange={mockOnChange} />,
        { wrapper: Wrapper },
      );
      expect(maxInput).toHaveValue("1");

      rerender(
        <OrbSettingsSection
          config={mockConfig({ max_or_range_pct: 10 })}
          onChange={mockOnChange}
        />,
        { wrapper: Wrapper },
      );
      expect(maxInput).toHaveValue("10");
    });

    it("accepts or_minutes boundary values (15 and 120)", () => {
      const { rerender } = render(<OrbSettingsSection {...defaultProps} />, { wrapper: Wrapper });
      const orInput = screen.getByTestId("config-or-minutes");

      rerender(
        <OrbSettingsSection config={mockConfig({ or_minutes: 15 })} onChange={mockOnChange} />,
        { wrapper: Wrapper },
      );
      expect(orInput).toHaveValue("15");

      rerender(
        <OrbSettingsSection config={mockConfig({ or_minutes: 120 })} onChange={mockOnChange} />,
        { wrapper: Wrapper },
      );
      expect(orInput).toHaveValue("120");
    });
  });

  describe("fractional steps", () => {
    it("accepts fractional step values for sl_pct (0.1 step)", () => {
      render(<OrbSettingsSection {...defaultProps} />, { wrapper: Wrapper });
      const input = screen.getByTestId("config-sl-pct");
      fireEvent.change(input, { target: { value: "0.25" } });
      expect(mockOnChange).toHaveBeenCalledWith("sl_pct", 0.25);
    });

    it("accepts fractional step values for tp_pct (0.1 step)", () => {
      render(<OrbSettingsSection {...defaultProps} />, { wrapper: Wrapper });
      const input = screen.getByTestId("config-tp-pct");
      fireEvent.change(input, { target: { value: "3.75" } });
      expect(mockOnChange).toHaveBeenCalledWith("tp_pct", 3.75);
    });

    it("accepts fractional step values for min_or_range_pct (0.1 step)", () => {
      render(<OrbSettingsSection {...defaultProps} />, { wrapper: Wrapper });
      const input = screen.getByTestId("config-min-or-range");
      fireEvent.change(input, { target: { value: "2.35" } });
      expect(mockOnChange).toHaveBeenCalledWith("min_or_range_pct", 2.35);
    });

    it("accepts fractional step values for max_or_range_pct (0.5 step)", () => {
      render(<OrbSettingsSection {...defaultProps} />, { wrapper: Wrapper });
      const input = screen.getByTestId("config-max-or-range");
      fireEvent.change(input, { target: { value: "3.5" } });
      expect(mockOnChange).toHaveBeenCalledWith("max_or_range_pct", 3.5);
    });
  });
});
