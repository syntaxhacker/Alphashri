// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@solidjs/testing-library";

const mocks = vi.hoisted(() => ({
  mockSetOption: vi.fn(),
  mockResize: vi.fn(),
  mockDispose: vi.fn(),
  mockInit: vi.fn(),
}));

vi.mock("../../utils/loadEcharts", () => ({
  loadEcharts: vi.fn(async () => {
    mocks.mockInit.mockImplementation(() => ({
      setOption: mocks.mockSetOption,
      resize: mocks.mockResize,
      dispose: mocks.mockDispose,
      on: vi.fn(),
    }));
    return { init: mocks.mockInit };
  }),
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
  test("renders the card, header and chart for an option trade", async () => {
    render(() => () => <OptionPayoffCard trade={optionTrade()} />);
    expect(screen.getByTestId("option-payoff-card")).toBeInTheDocument();
    expect(screen.getByTestId("option-payoff-chart")).toBeInTheDocument();
    expect(screen.getByText(/Payoff @ expiry/i)).toBeInTheDocument();
    expect(screen.getByText("LONG CE")).toBeInTheDocument();
    expect(screen.getAllByText("NIFTY").length).toBeGreaterThan(0);
    expect(screen.getByText("22,900")).toBeInTheDocument();
    await vi.waitFor(() => expect(mocks.mockSetOption).toHaveBeenCalled());
  });

  test("series data and markers (zero, strike, breakeven) reach ECharts", async () => {
    render(() => () => <OptionPayoffCard trade={optionTrade()} />);
    await vi.waitFor(() => expect(mocks.mockSetOption).toHaveBeenCalled());
    const opt = mocks.mockSetOption.mock.calls[0][0] as any;
    expect(opt.series[0].data.length).toBeGreaterThan(1);
    const markLines = opt.series[0].markLine.data;
    expect(markLines.some((m: any) => m.yAxis === 0)).toBe(true);
    expect(markLines.some((m: any) => m.xAxis === 22900)).toBe(true);
    // breakeven = strike + premium = 22900 + 120.5
    expect(markLines.some((m: any) => m.xAxis === 23020.5)).toBe(true);
  });

  test("renders SHORT badge for SELL side", () => {
    render(() => () => <OptionPayoffCard trade={optionTrade({ side: "SELL" })} />);
    expect(screen.getByText("SHORT CE")).toBeInTheDocument();
  });

  test("is hidden for equity trades", () => {
    render(() => () => <OptionPayoffCard trade={mockTrade()} />);
    expect(screen.queryByTestId("option-payoff-card")).not.toBeInTheDocument();
    expect(mocks.mockSetOption).not.toHaveBeenCalled();
  });

  test("toggle collapses and expands the chart", async () => {
    render(() => () => <OptionPayoffCard trade={optionTrade()} />);
    expect(screen.getByTestId("option-payoff-chart")).toBeInTheDocument();
    await fireEvent.click(screen.getByTestId("option-payoff-toggle"));
    // Collapse keeps children mounted (hidden) but the Collapse node gets aria-hidden
    const collapse = screen.getByTestId("option-payoff-chart").closest('[aria-hidden="true"]');
    expect(collapse).not.toBeNull();
  });
});

describe("OptionPayoffChart", () => {
  test("renders nothing for an empty series", () => {
    const { container } = render(() => () => <OptionPayoffChart series={[]} strike={100} breakeven={null} underlying="NIFTY" />);
    expect(container.querySelector('[data-testid="option-payoff-chart"]')).toBeNull();
    expect(mocks.mockSetOption).not.toHaveBeenCalled();
  });
});
