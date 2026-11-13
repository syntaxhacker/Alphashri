// @vitest-environment happy-dom
import { describe, expect, test, afterEach } from "vitest";
import { createSignal } from "solid-js";
import { render, screen, cleanup } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import { BacktestChart } from "./BacktestChart";
import type { SymbolChartData } from "../../types/backtest";
import { normalizeTime } from "../../utils/ui-helpers";
import "@testing-library/jest-dom/vitest";

afterEach(() => {
  cleanup();
});

function Wrapper({ children }: { children: JSX.Element }) {
  return <UIProvider>{children}</UIProvider>;
}

describe("normalizeTime", () => {
  test("strips +00:00 suffix", () => {
    expect(normalizeTime("2026-01-28T09:45:00+00:00")).toBe("2026-01-28T09:45");
  });

  test("strips Z suffix", () => {
    expect(normalizeTime("2026-01-28T09:45:00Z")).toBe("2026-01-28T09:45");
  });

  test("strips +05:30 suffix", () => {
    expect(normalizeTime("2026-01-28T15:15:00+05:30")).toBe("2026-01-28T15:15");
  });

  test("handles empty string", () => {
    expect(normalizeTime("")).toBe("");
  });

  test("handles time without timezone suffix", () => {
    expect(normalizeTime("2026-01-28T09:45:00")).toBe("2026-01-28T09:45");
  });

  test("handles date-only format for daily candles", () => {
    expect(normalizeTime("2026-01-28")).toBe("2026-01-28");
  });

  test("truncates seconds and milliseconds", () => {
    expect(normalizeTime("2026-01-28T09:45:30+00:00")).toBe("2026-01-28T09:45");
    expect(normalizeTime("2026-01-28T09:45:30.123Z")).toBe("2026-01-28T09:45");
  });

  test("handles various date formats", () => {
    expect(normalizeTime("2025-12-31T23:59:00Z")).toBe("2025-12-31T23:59");
    expect(normalizeTime("2024-02-29T00:00:00+00:00")).toBe("2024-02-29T00:00");
  });
});

describe("BacktestChart reactivity", () => {
  test("switches from loading to empty when isLoading and chartData change", () => {
    const [isLoading, setIsLoading] = createSignal(true);
    const [chartData] = createSignal<SymbolChartData | null>(null);
    render(() => (
      <BacktestChart symbol="RELIANCE" chartData={chartData()} isLoading={isLoading()} />
    ), { wrapper: Wrapper });
    expect(screen.getByTestId("backtest-chart-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("backtest-chart-empty")).not.toBeInTheDocument();

    setIsLoading(false);
    expect(screen.queryByTestId("backtest-chart-loading")).not.toBeInTheDocument();
    expect(screen.getByTestId("backtest-chart-empty")).toBeInTheDocument();
    expect(screen.getByText("No chart data for RELIANCE")).toBeInTheDocument();
  });
});
