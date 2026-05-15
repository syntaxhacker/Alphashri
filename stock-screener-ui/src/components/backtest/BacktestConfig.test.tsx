// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { BacktestConfig } from "./BacktestConfig";
import type { Strategy, StrategyVariation } from "../../types/backtest";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MantineProvider>{children}</MantineProvider>;
}

function mockStrategy(overrides: Partial<Strategy> = {}): Strategy {
  return {
    id: "strategy-1",
    name: "ORB",
    params: [
      { key: "sl_pct", label: "SL %", type: "number", default: 1, min: 0.1, max: 10, step: 0.1 },
      { key: "tp_pct", label: "TP %", type: "number", default: 2, min: 0.1, max: 20, step: 0.1 },
    ],
    ...overrides,
  };
}

function mockVariation(overrides: Partial<StrategyVariation> = {}): StrategyVariation {
  return {
    id: "var-1",
    name: "ORB Base",
    strategy_type: "ORB",
    is_template: true,
    description: "Original ORB strategy",
    ...overrides,
  };
}

function defaultProps(overrides: Partial<BacktestConfigProps> = {}): BacktestConfigProps {
  return {
    strategies: [mockStrategy()],
    variations: [mockVariation()],
    selectedStrategy: "",
    selectedVariation: null,
    params: {},
    selectedSymbols: [],
    days: 90,
    includeCosts: false,
    isRunning: false,
    saveToHistory: false,
    onStrategyChange: vi.fn(),
    onVariationChange: vi.fn(),
    onParamChange: vi.fn(),
    onDaysChange: vi.fn(),
    onIncludeCostsChange: vi.fn(),
    onSaveToHistoryChange: vi.fn(),
    onSymbolsChange: vi.fn(),
    onReset: vi.fn(),
    onRun: vi.fn(),
    ...overrides,
  };
}

describe("BacktestConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the config form", () => {
    render(<BacktestConfig {...defaultProps()} />, { wrapper: Wrapper });
    expect(screen.getByTestId("strategy-config")).toBeInTheDocument();
  });

  it("renders variation select", () => {
    render(<BacktestConfig {...defaultProps()} />, { wrapper: Wrapper });
    expect(screen.getByTestId("variation-select")).toBeInTheDocument();
  });

  it("shows description when variation has description", () => {
    const variation = mockVariation({ description: "Test description" });
    render(
      <BacktestConfig
        {...defaultProps({ selectedVariation: variation.id, variations: [variation] })}
      />,
      { wrapper: Wrapper },
    );
    expect(screen.getByText("Test description")).toBeInTheDocument();
  });

  it("renders SymbolChips with selected symbols", () => {
    render(<BacktestConfig {...defaultProps({ selectedSymbols: ["TCS", "INFY"] })} />, {
      wrapper: Wrapper,
    });
    expect(screen.getByTestId("symbol-multiselect")).toBeInTheDocument();
    expect(screen.getByTestId("chip-TCS")).toBeInTheDocument();
    expect(screen.getByTestId("chip-INFY")).toBeInTheDocument();
  });

  it("renders param inputs when strategy selected and variation selected", () => {
    const strategy = mockStrategy();
    render(
      <BacktestConfig
        {...defaultProps({
          selectedStrategy: strategy.id,
          selectedVariation: "var-1",
          strategies: [strategy],
          variations: [mockVariation()],
        })}
      />,
      { wrapper: Wrapper },
    );
    expect(screen.getByTestId("param-sl_pct")).toBeInTheDocument();
    expect(screen.getByTestId("param-tp_pct")).toBeInTheDocument();
  });

  it("shows placeholder text when no variation selected", () => {
    render(<BacktestConfig {...defaultProps({ selectedVariation: null })} />, { wrapper: Wrapper });
    expect(screen.getByText("Select a strategy to configure parameters")).toBeInTheDocument();
  });

  it("displays days input with correct value", () => {
    render(<BacktestConfig {...defaultProps({ days: 60 })} />, { wrapper: Wrapper });
    expect(screen.getByTestId("days-input")).toHaveValue("60");
  });

  it("renders include costs checkbox and reflects prop", () => {
    render(<BacktestConfig {...defaultProps({ includeCosts: true })} />, { wrapper: Wrapper });
    expect(screen.getByTestId("include-costs-checkbox")).toBeChecked();
  });

  it("run button disabled when isRunning true", () => {
    render(<BacktestConfig {...defaultProps({ isRunning: true })} />, { wrapper: Wrapper });
    expect(screen.getByTestId("run-backtest-btn")).toBeDisabled();
  });

  it("run button disabled when no symbols selected", () => {
    render(<BacktestConfig {...defaultProps({ selectedSymbols: [] })} />, { wrapper: Wrapper });
    expect(screen.getByTestId("run-backtest-btn")).toBeDisabled();
  });

  it("run button enabled when not running and symbols selected", () => {
    render(<BacktestConfig {...defaultProps({ isRunning: false, selectedSymbols: ["TCS"] })} />, {
      wrapper: Wrapper,
    });
    expect(screen.getByTestId("run-backtest-btn")).not.toBeDisabled();
  });

  it("clicking run button calls onRun", () => {
    const onRun = vi.fn();
    render(<BacktestConfig {...defaultProps({ onRun, selectedSymbols: ["TCS"] })} />, {
      wrapper: Wrapper,
    });
    screen.getByTestId("run-backtest-btn").click();
    expect(onRun).toHaveBeenCalled();
  });

  it("run menu button opens menu with correct items", async () => {
    render(<BacktestConfig {...defaultProps({ selectedSymbols: ["TCS"] })} />, {
      wrapper: Wrapper,
    });
    const menuBtn = screen.getByTestId("run-menu-btn");
    menuBtn.click();
    await waitFor(() => {
      expect(screen.getByTestId("menu-run-backtest")).toBeInTheDocument();
    });
    expect(screen.getByTestId("menu-run-save")).toBeInTheDocument();
    expect(screen.getByTestId("reset-btn")).toBeInTheDocument();
  });

  it("selecting 'Run & Save to History' calls onSaveToHistoryChange and onRun", async () => {
    const onRun = vi.fn();
    const onSaveToHistoryChange = vi.fn();
    render(
      <BacktestConfig
        {...defaultProps({ onRun, onSaveToHistoryChange, selectedSymbols: ["TCS"] })}
      />,
      { wrapper: Wrapper },
    );
    screen.getByTestId("run-menu-btn").click();
    const menuItem = await screen.findByTestId("menu-run-save");
    menuItem.click();
    expect(onSaveToHistoryChange).toHaveBeenCalledWith(true);
    expect(onRun).toHaveBeenCalled();
  });

  it("selecting 'Reset Config' calls onReset", async () => {
    const onReset = vi.fn();
    render(<BacktestConfig {...defaultProps({ onReset, selectedSymbols: ["TCS"] })} />, {
      wrapper: Wrapper,
    });
    screen.getByTestId("run-menu-btn").click();
    const resetBtn = await screen.findByTestId("reset-btn");
    resetBtn.click();
    expect(onReset).toHaveBeenCalled();
  });

  it("Ctrl+Enter triggers onRun when conditions met", () => {
    const onRun = vi.fn();
    render(
      <BacktestConfig {...defaultProps({ onRun, selectedSymbols: ["TCS"], isRunning: false })} />,
      { wrapper: Wrapper },
    );
    const event = new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true });
    document.dispatchEvent(event);
    expect(onRun).toHaveBeenCalled();
  });

  it("Ctrl+Enter does not run when isRunning true", () => {
    const onRun = vi.fn();
    render(
      <BacktestConfig {...defaultProps({ onRun, selectedSymbols: ["TCS"], isRunning: true })} />,
      { wrapper: Wrapper },
    );
    const event = new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true });
    document.dispatchEvent(event);
    expect(onRun).not.toHaveBeenCalled();
  });

  it("Ctrl+Enter does not run when no symbols", () => {
    const onRun = vi.fn();
    render(<BacktestConfig {...defaultProps({ onRun, selectedSymbols: [], isRunning: false })} />, {
      wrapper: Wrapper,
    });
    const event = new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true });
    document.dispatchEvent(event);
    expect(onRun).not.toHaveBeenCalled();
  });
});
