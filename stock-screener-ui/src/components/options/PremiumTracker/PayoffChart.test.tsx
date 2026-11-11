// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PayoffChart } from "./PayoffChart";
import { curveSpots } from "./payoff";
import type { PayoffLeg } from "./payoff";

const mocks = vi.hoisted(() => ({
  mockSetChartOption: vi.fn(),
}));

vi.mock("../../../hooks/useECharts", () => ({
  useECharts: () => ({
    chartRef: { current: null },
    setChartOption: mocks.mockSetChartOption,
  }),
}));

const legs: PayoffLeg[] = [
  { strike: 100, optionType: "CE", action: "BUY", qty: 1, entry: 5 },
];

function capturedOption() {
  return mocks.mockSetChartOption.mock.calls[0][0] as Record<string, unknown>;
}

describe("PayoffChart", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows empty-state text with no legs", () => {
    render(<PayoffChart legs={[]} spot={null} />);
    expect(screen.getByTestId("payoff-chart")).toBeInTheDocument();
    expect(screen.getByText("Add a leg to see payoff")).toBeInTheDocument();
  });

  it("hides ECharts background grid split lines while keeping markLine/markPoint", () => {
    render(<PayoffChart legs={legs} spot={100} />);
    const opt = capturedOption();
    expect(opt.xAxis.splitLine.show).toBe(false);
    expect(opt.yAxis.splitLine.show).toBe(false);
    // zero P&L markLine retained
    const mlData = (opt.series as { markLine: { data: unknown[] } }[])[0]
      .markLine.data;
    expect(
      mlData.some((m: Record<string, unknown>) => (m as { yAxis?: number }).yAxis === 0),
    ).toBe(true);
    // spot marker retained
    const mpData = (opt.series as { markPoint: { data: unknown[] } }[])[0]
      .markPoint.data;
    expect(mpData.length).toBeGreaterThan(0);
  });

  it("honors rangePct (wider plotted span than default)", () => {
    const defaultSpan =
      Math.max(...curveSpots(100, 8)) - Math.min(...curveSpots(100, 8));
    const wideSpan =
      Math.max(...curveSpots(100, 20)) - Math.min(...curveSpots(100, 20));
    expect(wideSpan).toBeGreaterThan(defaultSpan);

    render(<PayoffChart legs={legs} spot={100} rangePct={20} />);
    const opt = capturedOption();
    const spots = (opt.series as { data: [number, number][] }[])[0].data.map(
      (p) => p[0],
    );
    expect(Math.max(...spots) - Math.min(...spots)).toBeCloseTo(wideSpan);
    expect(spots[0]).toBeCloseTo(curveSpots(100, 20)[0]);
    expect(spots[spots.length - 1]).toBeCloseTo(
      curveSpots(100, 20)[curveSpots(100, 20).length - 1],
    );
  });
});
