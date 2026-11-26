// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import { BacktestToolbar } from "./BacktestToolbar";

const baseProps = {
  strategyLabel: "orb 2 symbols - 180d",
  symbolCount: 2,
  days: 180,
  isRunning: false,
  canRun: true,
  chartMode: "all" as const,
  onChartModeChange: vi.fn(),
  onRun: vi.fn(),
  onReset: vi.fn(),
};

function mount(overrides: Partial<typeof baseProps> = {}) {
  return render(() => (
    <UIProvider>
      <BacktestToolbar {...baseProps} {...overrides} />
    </UIProvider>
  ));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("BacktestToolbar responsive preset label", () => {
  it("keeps the full preset in a wrapping row with ellipsis and a title", () => {
    mount();
    const toolbar = screen.getByTestId("backtest-toolbar");
    expect(toolbar).toHaveClass("flex-wrap", "items-center", "min-w-0");

    const label = screen.getByTestId("backtest-preset-label");
    expect(label).toHaveTextContent("orb 2 symbols - 180d");
    expect(label).toHaveClass("min-w-0");
    expect(label.style.textOverflow).toBe("ellipsis");
    expect(label).toHaveAttribute(
      "title",
      "orb 2 symbols - 180d · 2 symbols · 180d",
    );
  });

  it("never reduces the preset to the bare symbol count when the strategy is unset", () => {
    mount({ strategyLabel: "" });
    expect(screen.getByTestId("backtest-preset-label")).toHaveTextContent("No strategy");
  });

  it("uses icon-only Reset and a compact Run at narrow widths", () => {
    mount();
    const reset = screen.getByTestId("toolbar-reset-layout");
    expect(reset).toHaveAttribute("aria-label", "Reset layout");
    const resetSpans = Array.from(reset.querySelectorAll("span"));
    expect(resetSpans.some((span) => span.className.includes("hidden sm:inline"))).toBe(true);

    const run = screen.getByTestId("toolbar-run-btn");
    expect(run).toHaveAttribute("aria-label", "Run backtest");
    expect(run).toHaveTextContent("Run");
    const runSpans = Array.from(run.querySelectorAll("span"));
    expect(runSpans.some((span) => span.className.includes("hidden sm:inline-flex"))).toBe(true);
  });

  it("keeps the actions and mode controls wired", () => {
    mount();
    fireEvent.click(screen.getByTestId("toolbar-run-btn"));
    fireEvent.click(screen.getByTestId("toolbar-reset-layout"));
    fireEvent.click(screen.getByTestId("chart-mode-trades"));
    expect(baseProps.onRun).toHaveBeenCalledTimes(1);
    expect(baseProps.onReset).toHaveBeenCalledTimes(1);
    expect(baseProps.onChartModeChange).toHaveBeenCalledWith("trades");
  });
});
