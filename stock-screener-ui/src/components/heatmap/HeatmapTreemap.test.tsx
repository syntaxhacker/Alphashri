// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import { HeatmapTreemap } from "./HeatmapTreemap";
import type { HeatmapStock } from "../../api/heatmap";

const mockOn = vi.fn();
const mockChartInstance = {
  setOption: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
  on: mockOn,
};

vi.mock("../../utils/loadEcharts", () => ({
  loadEcharts: vi.fn(() => Promise.resolve({ init: vi.fn(() => mockChartInstance) })),
}));

function r(jsx: () => any) {
  return render(() => <UIProvider>{jsx()}</UIProvider>);
}

const stock: HeatmapStock = {
  symbol: "RELIANCE",
  name: "Reliance Industries",
  sector: "Energy",
  market_cap: 15_000_000_000_000,
  pe_ratio: 22.5,
  pb_ratio: 2.5,
  dividend_yield: 0.8,
  perf_1y: 12.3,
  roe: 15.2,
  high_52w: 3000,
  low_52w: 2400,
  price: 2850,
  change_pct: 1.234,
};

describe("HeatmapTreemap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  test("clicking a tile calls onSymbolClick with the symbol", async () => {
    const onSymbolClick = vi.fn();
    r(() => (
      <HeatmapTreemap stocks={[stock]} metric="roe" onSymbolClick={onSymbolClick} />
    ));
    await vi.waitFor(() => expect(mockOn).toHaveBeenCalledWith("click", expect.any(Function)));
    const clickHandler = mockOn.mock.calls.find(([evt]) => evt === "click")?.[1];
    expect(clickHandler).toBeDefined();
    clickHandler({ name: "RELIANCE" });
    expect(onSymbolClick).toHaveBeenCalledWith("RELIANCE");
  });

  test("does not register a click handler when onSymbolClick is not provided", async () => {
    r(() => <HeatmapTreemap stocks={[stock]} metric="roe" />);
    await vi.waitFor(() => expect(mockChartInstance.setOption).toHaveBeenCalled());
    expect(mockOn).not.toHaveBeenCalledWith("click", expect.any(Function));
  });
});
