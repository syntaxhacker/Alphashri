// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import { renderWithProviders } from "../../test-utils/renderWithProviders";

const mocks = vi.hoisted(() => ({
  mockSetChartOption: vi.fn(),
}));

vi.mock("../../hooks/useECharts", () => ({
  useECharts: vi.fn(() => ({
    chartRef: { current: null },
    chartInstance: { current: null },
    setChartOption: mocks.mockSetChartOption,
  })),
}));

import { OptionPayoffCard, OptionPayoffChart } from "./OptionPayoffChart";
import { mockTrade } from "./testFixtures";
import type { PaperTrade } from "../../types/paperTrading";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function optionTrade(overrides: Partial<PaperTrade> = {}) {
  return mockTrade({
    trade_id: "opt-1",
    symbol: "NIFTY 2026-10-19 22900CE",
    side: "BUY",
    quantity: 75,
    entry_price: 120.5,
    source: "options_paper",
    ...overrides,
  });
}

describe("OptionPayoffCard", () => {
  test("renders the card, header and chart for an option trade", () => {
    renderWithProviders(<OptionPayoffCard trade={optionTrade()} />);
    expect(screen.getByTestId("option-payoff-card")).toBeInTheDocument();
    expect(screen.getByTestId("option-payoff-chart")).toBeInTheDocument();
    expect(screen.getByText(/Payoff @ expiry/i)).toBeInTheDocument();
    expect(screen.getByText("LONG CE")).toBeInTheDocument();
    expect(screen.getAllByText("NIFTY").length).toBeGreaterThan(0);
    expect(screen.getByText("22,900")).toBeInTheDocument();
    expect(mocks.mockSetChartOption).toHaveBeenCalled();
  });

  test("series data and markers (zero, strike, breakeven) reach ECharts", () => {
    renderWithProviders(<OptionPayoffCard trade={optionTrade()} />);
    const opt = mocks.mockSetChartOption.mock.calls[0][0] as any;
    expect(opt.series[0].data.length).toBeGreaterThan(1);
    const markLines = opt.series[0].markLine.data;
    expect(markLines.some((m: any) => m.yAxis === 0)).toBe(true);
    expect(markLines.some((m: any) => m.xAxis === 22900)).toBe(true);
    // breakeven = strike + premium = 22900 + 120.5
    expect(markLines.some((m: any) => m.xAxis === 23020.5)).toBe(true);
  });

  test("renders SHORT badge for SELL side", () => {
    renderWithProviders(
      <OptionPayoffCard trade={optionTrade({ side: "SELL" })} />,
    );
    expect(screen.getByText("SHORT CE")).toBeInTheDocument();
  });

  test("is hidden for equity trades", () => {
    renderWithProviders(<OptionPayoffCard trade={mockTrade()} />);
    expect(screen.queryByTestId("option-payoff-card")).not.toBeInTheDocument();
    expect(mocks.mockSetChartOption).not.toHaveBeenCalled();
  });

  test("toggle collapses and expands the chart", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    renderWithProviders(<OptionPayoffCard trade={optionTrade()} />);
    expect(screen.getByTestId("option-payoff-chart")).toBeInTheDocument();
    await user.click(screen.getByTestId("option-payoff-toggle"));
    // Collapse keeps children mounted (hidden) but the MUI Collapse node gets aria-hidden
    const collapse = screen.getByTestId("option-payoff-chart").closest('[aria-hidden="true"]');
    expect(collapse).not.toBeNull();
  });
});

describe("OptionPayoffChart", () => {
  test("renders nothing for an empty series", () => {
    const { container } = renderWithProviders(
      <OptionPayoffChart series={[]} strike={100} breakeven={null} />,
    );
    expect(container.querySelector('[data-testid="option-payoff-chart"]')).toBeNull();
    expect(mocks.mockSetChartOption).not.toHaveBeenCalled();
  });
});
