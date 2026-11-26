// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import { SectorHeatmapView, type ViewMode } from "./SectorHeatmapView";
import type { HeatmapStock } from "../../api/heatmap";
import type { SectorItem } from "../../types/sector";

const chartStub = vi.hoisted(() => ({
  handlers: {} as Record<string, (params: unknown) => void>,
  on: vi.fn(),
  setOption: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock("@/utils/loadEcharts", () => ({
  loadEcharts: vi.fn(async () => ({ init: vi.fn(() => chartStub) })),
}));

function stock(symbol: string, change_pct = 1): HeatmapStock {
  return {
    symbol,
    name: symbol,
    sector: "IT",
    market_cap: 100,
    pe_ratio: 20,
    pb_ratio: 3,
    dividend_yield: null,
    perf_1y: 10,
    roe: 15,
    high_52w: 100,
    low_52w: 50,
    price: 90,
    change_pct,
  };
}

const sector: SectorItem = {
  sector: "IT",
  avg_change: 1.2,
  stock_count: 50,
  advances: 30,
  declines: 20,
  avg_rsi: 55,
  avg_adx: 26,
  top_movers: "TCS(1.20%)",
};

function renderView(props: {
  viewMode: ViewMode;
  stocks?: HeatmapStock[];
  sectors?: SectorItem[];
  onSymbolClick?: (symbol: string) => void;
}) {
  return render(() => (
    <UIProvider>
      <SectorHeatmapView
        viewMode={props.viewMode}
        stocks={props.stocks ?? []}
        sectors={props.sectors ?? []}
        metric="change_pct"
        onSymbolClick={props.onSymbolClick}
      />
    </UIProvider>
  ));
}

beforeEach(() => {
  vi.clearAllMocks();
  chartStub.handlers = {};
  chartStub.on.mockImplementation((event: string, handler: (params: unknown) => void) => {
    chartStub.handlers[event] = handler;
  });
});

afterEach(() => {
  cleanup();
});

describe("SectorHeatmapView symbol clickability", () => {
  test("stock tiles are exposed as focusable buttons with Enter/Space and no raw chart href", () => {
    const onSymbolClick = vi.fn();
    renderView({ viewMode: "stock", stocks: [stock("TCS"), stock("INFY")], onSymbolClick });

    const rail = screen.getByTestId("sector-heatmap-symbol-rail");
    expect(rail).toHaveAttribute("role", "group");
    expect(rail.querySelector('a[href^="/chart/"]')).toBeNull();

    const tcs = screen.getByTestId("sector-heatmap-symbol-TCS");
    expect(tcs.tagName).toBe("BUTTON");
    expect(tcs).toHaveAttribute("aria-label", "Open TCS chart");

    fireEvent.click(tcs);
    expect(onSymbolClick).toHaveBeenCalledTimes(1);
    expect(onSymbolClick).toHaveBeenCalledWith("TCS");

    const infy = screen.getByTestId("sector-heatmap-symbol-INFY");
    fireEvent.keyDown(infy, { key: "Enter" });
    expect(onSymbolClick).toHaveBeenLastCalledWith("INFY");
    fireEvent.keyDown(infy, { key: " " });
    expect(onSymbolClick).toHaveBeenCalledTimes(3);
    expect(onSymbolClick).toHaveBeenLastCalledWith("INFY");
  });

  test("canvas tile click opens the same dock handler", async () => {
    const onSymbolClick = vi.fn();
    renderView({ viewMode: "stock", stocks: [stock("TCS")], onSymbolClick });

    await waitFor(() => expect(chartStub.on).toHaveBeenCalledWith("click", expect.any(Function)));
    chartStub.handlers.click?.({ name: "TCS" });

    expect(onSymbolClick).toHaveBeenCalledTimes(1);
    expect(onSymbolClick).toHaveBeenCalledWith("TCS");
  });

  test("sector view has no symbol rail and its sector tiles do not open charts", async () => {
    const onSymbolClick = vi.fn();
    renderView({ viewMode: "sector", sectors: [sector], onSymbolClick });

    expect(screen.queryByTestId("sector-heatmap-symbol-rail")).not.toBeInTheDocument();
    await waitFor(() => expect(chartStub.on).toHaveBeenCalled());
    chartStub.handlers.click?.({ name: "IT" });
    expect(onSymbolClick).not.toHaveBeenCalled();
  });

  test("the keyboard rail is capped so a full snapshot cannot mount hundreds of buttons", () => {
    const onSymbolClick = vi.fn();
    const stocks = Array.from({ length: 45 }, (_, i) => stock(`S${i}`, i));
    renderView({ viewMode: "stock", stocks, onSymbolClick });

    expect(screen.getAllByTestId(/^sector-heatmap-symbol-S/)).toHaveLength(40);
  });
});
