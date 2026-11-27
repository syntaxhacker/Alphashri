// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import { emptyFixture, fullFixture, withoutBlocks } from "./fixtures";

const chartStub = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
vi.mock("@/utils/loadEcharts", () => ({
  loadEcharts: vi.fn(async () => ({ init: vi.fn(() => chartStub) })),
}));

import { LiquidityPillar } from "./LiquidityPillar";
import type { OptionsDashboardData } from "@/types/optionsDashboard";

const onExpiry = vi.fn();

function view(data: OptionsDashboardData = fullFixture(), selectedExpiry: string | null = "2026-11-26") {
  return render(() => (
    <UIProvider>
      <LiquidityPillar data={data} selectedExpiry={selectedExpiry} onExpiry={onExpiry} />
    </UIProvider>
  ));
}

const optionsFor = () => chartStub.setOption.mock.calls.map((call) => call[0] as any);
const optionWith = (name: string) =>
  optionsFor().find((option) => option.series?.some((s: any) => s.name === name));
const seriesNamed = (name: string) => optionWith(name)?.series?.find((s: any) => s.name === name);

afterEach(() => {
  cleanup();
  chartStub.setOption.mockClear();
  chartStub.dispose.mockClear();
  onExpiry.mockClear();
});

describe("LiquidityPillar", () => {
  test("renders two aria-labelled chart frames and the quote-quality badges", async () => {
    view();
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());

    for (const id of ["spread-heatmap-chart", "vol-oi-chart"]) {
      expect(screen.getByTestId(`${id}-frame`)).toHaveAttribute("role", "img");
      expect(screen.getByTestId(`${id}-frame`)).toHaveAttribute("aria-label");
      expect(screen.getByTestId(`${id}-desc`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("liquidity-badges")).toBeInTheDocument();
    expect(screen.getByTestId("liquidity-note")).toHaveTextContent("Blank cell = no two-sided quote");
  });

  test("plots a strike-by-expiry spread heatmap with a value scale", async () => {
    view();
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());

    const heatmap = seriesNamed("Spread");
    expect(heatmap.type).toBe("heatmap");
    expect(heatmap.data.length).toBe(9);
    const option = optionWith("Spread");
    expect(option.xAxis.type).toBe("category");
    expect(option.yAxis.type).toBe("category");
    expect(option.visualMap.inRange.color).toHaveLength(3);
    // The unquoted cell is omitted, never plotted as a zero spread.
    expect(heatmap.data.every((cell: number[]) => cell[2] > 0)).toBe(true);
  });

  test("drops the strike axis name and lifts the value scale above the grid", async () => {
    view();
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());

    const option = optionWith("Spread");
    // At 390 the 10px name sat on the "Tight"/"Wide" labels (x≈194-247 /
    // y≈175-180); the caption and the frame's aria label already name both
    // dimensions, so the canvas goes unnamed.
    expect(option.xAxis.name).toBe("");
    // The scale lives in the reserved top band, clear of the tick labels.
    expect(option.visualMap.top).toBe(4);
    expect(option.visualMap.bottom).toBeUndefined();
    expect(option.visualMap.right).toBe(8);
    expect(option.visualMap.orient).toBe("horizontal");
    expect(option.visualMap.text).toEqual(["Wide", "Tight"]);
    expect(option.grid.top).toBeGreaterThan(option.visualMap.top);
  });

  test("bars Vol/OI and prints median spread, illiquid count and peak", async () => {
    view();
    await waitFor(() => expect(screen.getByTestId("liq-metric-median-value")).toBeInTheDocument());

    expect(seriesNamed("Vol / OI").data.length).toBe(5);
    expect(screen.getByTestId("liquidity-median-badge")).toHaveTextContent("0.30");
    expect(screen.getByTestId("liquidity-illiquid-badge")).toHaveTextContent("1/10");
    expect(screen.getByTestId("liq-metric-median-value")).toHaveTextContent("0.30");
    expect(screen.getByTestId("liq-metric-illiquid-value")).toHaveTextContent("1/10");
    expect(screen.getByTestId("liq-metric-peak-value")).toHaveTextContent("0.72");
  });

  test("switches expiry through the chip row", async () => {
    view();
    fireEvent.click(screen.getByTestId("liquidity-expiry-2026-12-31"));
    expect(onExpiry).toHaveBeenCalledWith("2026-12-31");
  });

  test("renders real series with no fail-soft reason when the DTO carries the arrays", async () => {
    view();
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());

    for (const id of ["spread-heatmap-chart", "vol-oi-chart"]) {
      expect(screen.queryByTestId(`${id}-empty`)).not.toBeInTheDocument();
    }
    expect(seriesNamed("Spread").data.length).toBeGreaterThan(0);
    expect(seriesNamed("Vol / OI").data.length).toBeGreaterThan(0);
  });

  test("a shipped-DTO payload names both missing liquidity blocks", async () => {
    view(withoutBlocks());
    await waitFor(() => expect(screen.getByTestId("spread-heatmap-chart-empty")).toBeInTheDocument());

    expect(screen.getByTestId("spread-heatmap-chart-empty")).toHaveTextContent("No bid-ask quotes");
    expect(screen.getByTestId("vol-oi-chart-empty")).toHaveTextContent("No volume / OI data");
    expect(screen.getByTestId("liquidity-illiquid-badge")).toHaveTextContent("0/0");
  });

  test("a fully empty payload shows reasons and dashes without throwing", async () => {
    view(emptyFixture(), null);
    await waitFor(() => expect(screen.getByTestId("spread-heatmap-chart-empty")).toBeInTheDocument());

    expect(screen.getByTestId("vol-oi-chart-empty")).toBeInTheDocument();
    expect(screen.getByTestId("liq-metric-median-value")).toHaveTextContent("—");
    expect(screen.getByTestId("liquidity-median-badge")).toHaveTextContent("—");
  });
});
