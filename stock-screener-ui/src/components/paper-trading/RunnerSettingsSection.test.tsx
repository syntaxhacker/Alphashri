// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach, test } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { RunnerSettingsSection } from "./RunnerSettingsSection";
import type { StrategyConfig } from "../../types/strategies";
import { TestWrapper } from "../../test/test-utils";

describe("RunnerSettingsSection", () => {
  const mockOnChange = vi.fn();

  const createMockConfig = (overrides: Partial<StrategyConfig> = {}): StrategyConfig => ({
    id: "test-strategy",
    internal_id: 1,
    name: "Test Strategy",
    strategy_type: "orb",
    parent_id: null,
    is_template: false,
    is_active: true,
    is_default: false,
    description: "Test description",
    // ORB Parameters
    or_minutes: 15,
    sl_pct: 1.0,
    tp_pct: 2.0,
    min_or_range_pct: 0.5,
    max_or_range_pct: 2.0,
    // Risk Parameters
    max_positions: 5,
    max_capital_per_trade_pct: 5.0,
    max_daily_loss_pct: 5.0,
    max_total_exposure_pct: 50.0,
    risk_per_trade_pct: 1.0,
    min_trade_value: 10000,
    max_trade_value: 50000,
    // Runner Parameters
    cooldown_minutes: 60,
    max_distance_from_or_pct: 1.0,
    // 52W Chaser Parameters
    entry_threshold_pct: 0.5,
    enable_trailing_stop: false,
    trailing_stop_pct: 1.0,
    trailing_activation_pct: 0.5,
    max_holding_days: 3,
    cooldown_days: 1,
    enable_filters: true,
    // EMA Crossover Parameters
    ema_fast_period: 9,
    ema_slow_period: 21,
    // S/R Breakout Parameters
    pivot_type: "standard",
    breakout_buffer_pct: 0.3,
    // Cost Parameters
    brokerage_pct: 0.05,
    min_brokerage: 20,
    stt_pct: 0.025,
    exchange_pct: 0.003,
    sebi_pct: 0.0001,
    stamp_pct: 0.003,
    gst_pct: 0.18,
    // Timestamps
    created_at: null,
    updated_at: null,
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("rendering", () => {
    it("renders the root Stack with correct className and id", () => {
      const { container } = render(
        <RunnerSettingsSection config={createMockConfig()} onChange={mockOnChange} />,
        { wrapper: TestWrapper },
      );
      const stack = container.querySelector(".paper-settings-section");
      expect(stack).toBeInTheDocument();
      expect(stack).toHaveAttribute("id", "runner-section");
    });

    it("renders the header with correct text and styling", () => {
      render(<RunnerSettingsSection config={createMockConfig()} onChange={mockOnChange} />, {
        wrapper: TestWrapper,
      });
      const header = screen.getByText("Runner Configuration");
      expect(header).toBeInTheDocument();
      // Check inline styles for uppercase and font weight
      expect(header).toHaveStyle({ textTransform: "uppercase" });
      expect(header).toHaveStyle({ fontWeight: "600" });
    });

    it("renders Cooldown NumberInput with correct label and testid", () => {
      render(<RunnerSettingsSection config={createMockConfig()} onChange={mockOnChange} />, {
        wrapper: TestWrapper,
      });
      expect(screen.getByLabelText("Cooldown (min)")).toBeInTheDocument();
      expect(screen.getByTestId("config-cooldown")).toBeInTheDocument();
    });

    it("renders Max Distance NumberInput with correct label and testid", () => {
      render(<RunnerSettingsSection config={createMockConfig()} onChange={mockOnChange} />, {
        wrapper: TestWrapper,
      });
      expect(screen.getByLabelText("Max Distance from OR %")).toBeInTheDocument();
      expect(screen.getByTestId("config-max-distance")).toBeInTheDocument();
    });

    it("renders correct labels and descriptions for both inputs", () => {
      render(<RunnerSettingsSection config={createMockConfig()} onChange={mockOnChange} />, {
        wrapper: TestWrapper,
      });
      expect(screen.getByText("Cooldown (min)")).toBeInTheDocument();
      expect(screen.getByText("Cooldown between trades")).toBeInTheDocument();
      expect(screen.getByText("Max Distance from OR %")).toBeInTheDocument();
      expect(screen.getByText("Max distance from opening range")).toBeInTheDocument();
    });

    it("renders both inputs with data-testids", () => {
      render(<RunnerSettingsSection config={createMockConfig()} onChange={mockOnChange} />, {
        wrapper: TestWrapper,
      });
      expect(screen.getByTestId("config-cooldown")).toBeInTheDocument();
      expect(screen.getByTestId("config-max-distance")).toBeInTheDocument();
    });

    it("displays initial values from config", () => {
      render(<RunnerSettingsSection config={createMockConfig()} onChange={mockOnChange} />, {
        wrapper: TestWrapper,
      });
      const cooldownInput = screen.getByTestId("config-cooldown");
      const maxDistanceInput = screen.getByTestId("config-max-distance");
      expect(cooldownInput).toHaveValue("60");
      expect(maxDistanceInput).toHaveValue("1");
    });
  });

  describe("onChange behavior", () => {
    it("calls onChange with correct key and value when cooldown changes", async () => {
      const user = userEvent.setup();
      render(<RunnerSettingsSection config={createMockConfig()} onChange={mockOnChange} />, {
        wrapper: TestWrapper,
      });
      const cooldownInput = screen.getByTestId("config-cooldown");
      await user.clear(cooldownInput); await user.type(cooldownInput, "30");
      expect(mockOnChange).toHaveBeenCalledWith("cooldown_minutes", 30);
    });

    it("calls onChange with correct key and value when max_distance changes", async () => {
      const user = userEvent.setup();
      render(<RunnerSettingsSection config={createMockConfig()} onChange={mockOnChange} />, {
        wrapper: TestWrapper,
      });
      const maxDistanceInput = screen.getByTestId("config-max-distance");
      await user.clear(maxDistanceInput); await user.type(maxDistanceInput, "2.5");
      expect(mockOnChange).toHaveBeenCalledWith("max_distance_from_or_pct", 2.5);
    });

    it("converts cooldown value to number", async () => {
      const user = userEvent.setup();
      render(<RunnerSettingsSection config={createMockConfig()} onChange={mockOnChange} />, {
        wrapper: TestWrapper,
      });
      const cooldownInput = screen.getByTestId("config-cooldown");
      await user.clear(cooldownInput); await user.type(cooldownInput, "45");
      expect(mockOnChange).toHaveBeenCalledWith("cooldown_minutes", 45);
      // Verify it's a number not a string
      expect(typeof mockOnChange.mock.calls[0][1]).toBe("number");
    });

    it("converts max_distance value to number including decimals", async () => {
      const user = userEvent.setup();
      render(<RunnerSettingsSection config={createMockConfig()} onChange={mockOnChange} />, {
        wrapper: TestWrapper,
      });
      const maxDistanceInput = screen.getByTestId("config-max-distance");
      await user.clear(maxDistanceInput); await user.type(maxDistanceInput, "1.75");
      expect(mockOnChange).toHaveBeenCalledWith("max_distance_from_or_pct", 1.75);
      expect(typeof mockOnChange.mock.calls[0][1]).toBe("number");
    });
  });

  describe("edge cases - boundary values", () => {
    it("renders with zero cooldown (min boundary)", () => {
      render(
        <RunnerSettingsSection
          config={createMockConfig({ cooldown_minutes: 0 })}
          onChange={mockOnChange}
        />,
        { wrapper: TestWrapper },
      );
      const cooldownInput = screen.getByTestId("config-cooldown");
      expect(cooldownInput).toHaveValue("0");
    });

    it("renders with max cooldown value (120)", () => {
      render(
        <RunnerSettingsSection
          config={createMockConfig({ cooldown_minutes: 120 })}
          onChange={mockOnChange}
        />,
        { wrapper: TestWrapper },
      );
      const cooldownInput = screen.getByTestId("config-cooldown");
      expect(cooldownInput).toHaveValue("120");
    });

    it("renders with min max_distance (0.5)", () => {
      render(
        <RunnerSettingsSection
          config={createMockConfig({ max_distance_from_or_pct: 0.5 })}
          onChange={mockOnChange}
        />,
        { wrapper: TestWrapper },
      );
      const maxDistanceInput = screen.getByTestId("config-max-distance");
      expect(maxDistanceInput).toHaveValue("0.5");
    });

    it("renders with max max_distance value (5)", () => {
      render(
        <RunnerSettingsSection
          config={createMockConfig({ max_distance_from_or_pct: 5 })}
          onChange={mockOnChange}
        />,
        { wrapper: TestWrapper },
      );
      const maxDistanceInput = screen.getByTestId("config-max-distance");
      expect(maxDistanceInput).toHaveValue("5");
    });

    it("accepts fractional max_distance values like 0.5", async () => {
      const user = userEvent.setup();
      render(<RunnerSettingsSection config={createMockConfig()} onChange={mockOnChange} />, {
        wrapper: TestWrapper,
      });
      const maxDistanceInput = screen.getByTestId("config-max-distance");
      await user.clear(maxDistanceInput); await user.type(maxDistanceInput, "0.5");
      expect(mockOnChange).toHaveBeenCalledWith("max_distance_from_or_pct", 0.5);
    });

    test.each([
      ["1.5", 1.5],
      ["3.75", 3.75],
    ])("accepts fractional max_distance values like %s", async (inputVal, expected) => {
      const user = userEvent.setup();
      render(<RunnerSettingsSection config={createMockConfig()} onChange={mockOnChange} />, {
        wrapper: TestWrapper,
      });
      const maxDistanceInput = screen.getByTestId("config-max-distance");
      await user.clear(maxDistanceInput); await user.type(maxDistanceInput, String(inputVal));
      expect(mockOnChange).toHaveBeenCalledWith("max_distance_from_or_pct", expected);
    });
  });

  describe("component structure validation", () => {
    it("renders both inputs within Grid columns", () => {
      render(<RunnerSettingsSection config={createMockConfig()} onChange={mockOnChange} />, {
        wrapper: TestWrapper,
      });
      // Both inputs should be present
      expect(screen.getByTestId("config-cooldown")).toBeInTheDocument();
      expect(screen.getByTestId("config-max-distance")).toBeInTheDocument();
    });
  });
});
