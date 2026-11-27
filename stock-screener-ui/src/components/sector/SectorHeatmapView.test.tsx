// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import { lerpRgb } from "@/components/heatmap/heatmapUtils";
import { contrastRatio } from "@/utils/contrast";
import {
  SectorHeatmapView,
  sectorTileName,
  sectorTileTextColor,
  treemapLabelFits,
  type ViewMode,
} from "./SectorHeatmapView";
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

function sectorRow(name: string, avgChange: number, stockCount: number): SectorItem {
  return {
    sector: name,
    avg_change: avgChange,
    stock_count: stockCount,
    advances: Math.round(stockCount / 2),
    declines: stockCount - Math.round(stockCount / 2),
    avg_rsi: 55,
    avg_adx: 26,
    top_movers: `${name} leaders`,
  };
}

const SIX_SECTORS: SectorItem[] = [
  sectorRow("IT", 2.5, 50),
  sectorRow("Banking", -1.25, 40),
  sectorRow("Pharma", 0.4, 35),
  sectorRow("Auto", -0.35, 30),
  sectorRow("FMCG", 0, 25),
  sectorRow("Energy", 3.1, 20),
];

const SIX_SECTOR_TABLE = [
  ["IT", "+2.50%", 50],
  ["Banking", "-1.25%", 40],
  ["Pharma", "+0.40%", 35],
  ["Auto", "-0.35%", 30],
  ["FMCG", "0.00%", 25],
  ["Energy", "+3.10%", 20],
] as const;

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

type ChartTile = { name: string; label: { color: string }; itemStyle: { color: string } };

function lastChartTiles(): ChartTile[] {
  const calls = chartStub.setOption.mock.calls;
  const option = calls[calls.length - 1][0] as { series: Array<{ data: ChartTile[] }> };
  return option.series[0].data;
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

describe("SectorHeatmapView accessibility and label contrast", () => {
  test("sector heatmap exposes an accessible name, description and focus target", () => {
    renderView({ viewMode: "sector", sectors: SIX_SECTORS });

    const chart = screen.getByTestId("sector-heatmap-chart");
    expect(chart).toHaveAttribute("role", "img");
    expect(chart).toHaveAttribute("aria-label", "Sector performance heatmap");
    expect(chart).toHaveAttribute("tabindex", "0");

    const descriptionId = chart.getAttribute("aria-describedby");
    expect(descriptionId).toBeTruthy();
    const description = document.getElementById(descriptionId!);
    expect(description).not.toBeNull();
    expect(description).toHaveClass("sr-only");
    expect(description).toHaveTextContent("6 sectors");
    expect(description).toHaveTextContent(/average change/i);
    expect(description).toHaveTextContent(/text table/i);
    expect(description).toBe(screen.getByTestId("sector-heatmap-description"));
  });

  test("hidden data table lists every sector with its average change and stock count", () => {
    renderView({ viewMode: "sector", sectors: SIX_SECTORS });

    const table = screen.getByTestId("sector-heatmap-data");
    expect(table.tagName).toBe("TABLE");
    expect(table).toHaveClass("sr-only");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["Sector", "Average change", "Stocks"]);
    expect(within(table).getAllByRole("row")).toHaveLength(SIX_SECTORS.length + 1);

    for (const [name, avgChange, stockCount] of SIX_SECTOR_TABLE) {
      const row = within(table).getByText(name).closest("tr");
      expect(row, `${name} row`).not.toBeNull();
      expect(row).toHaveTextContent(avgChange);
      expect(row).toHaveTextContent(String(stockCount));
    }
  });

  test("uses compact tile labels that fit a phone tile", () => {
    expect(sectorTileName("Consumer Non-Durables", true)).toBe("NonDur");
    expect(sectorTileName("Communications", false)).toBe("Comms");
    expect(sectorTileName("Unknown Sector", true)).toBe("Unknown Sector");
  });

  test("keeps compact legend names unique", () => {
    const names = [
      "Technology Services",
      "Energy Minerals",
      "Non-Energy Minerals",
      "Commercial Services",
      "Producer Manufacturing",
      "Finance",
      "Health Technology",
      "Industrial Services",
      "Utilities",
      "Distribution Services",
      "Process Industries",
      "Electronic Technology",
      "Health Services",
      "Consumer Durables",
      "Communications",
      "Consumer Non-Durables",
      "Transportation",
      "Retail Trade",
      "Consumer Services",
      "Miscellaneous",
    ];
    const compact = names.map((name) => sectorTileName(name, true));
    expect(new Set(compact).size).toBe(compact.length);
    expect(sectorTileName("Health Technology", true)).toBe("HealthTech");
    expect(sectorTileName("Health Services", true)).toBe("HealthSvcs");
  });

  test("requires the real tile rect to fit both label lines", () => {
    // The 390 failure case: a 37px-wide Technology/Utilities tile.
    expect(treemapLabelFits("Tech", "4.02%", 37, 135)).toBe(false);
    expect(treemapLabelFits("Util.", "0.14%", 37, 86)).toBe(false);
    // A tall Finance tile carries the same two lines comfortably.
    expect(treemapLabelFits("Finance", "0.18%", 212, 143)).toBe(true);
    expect(treemapLabelFits("Cons. Non-Dur.", "-0.97%", 208, 68)).toBe(true);
  });

  test("shows a visible direct-label legend for sector tiles too small to label", () => {
    renderView({ viewMode: "sector", sectors: SIX_SECTORS });

    const legend = screen.getByTestId("sector-heatmap-legend");
    expect(screen.getAllByTestId(/^sector-heatmap-legend-/)).toHaveLength(SIX_SECTORS.length);
    for (const [name, avgChange] of SIX_SECTOR_TABLE) {
      expect(legend).toHaveTextContent(name === "FMCG" ? "FMCG" : name);
      expect(legend).toHaveTextContent(avgChange);
    }
    expect(within(legend).getByTestId("sector-heatmap-legend-FMCG")).toHaveTextContent(
      "0.00%",
    );
  });

  test("every rendered sector tile label ink clears 4.5:1 against its fill", async () => {
    renderView({ viewMode: "sector", sectors: SIX_SECTORS });
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());

    const tiles = lastChartTiles();
    expect(tiles).toHaveLength(SIX_SECTORS.length);

    for (const tile of tiles) {
      expect(tile.label.color, `${tile.name} ink`).toBe(sectorTileTextColor(tile.itemStyle.color));
      const ratio = contrastRatio(tile.label.color, tile.itemStyle.color);
      expect(
        ratio,
        `${tile.name}: ${tile.label.color} on ${tile.itemStyle.color} = ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("stock-mode tile labels also clear 4.5:1 against their fills", async () => {
    const stocks = [-10, -5, -2, 0, 2, 5, 10].map((change, i) => stock(`S${i}`, change));
    renderView({ viewMode: "stock", stocks });
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());

    const tiles = lastChartTiles();
    expect(tiles).toHaveLength(stocks.length);

    for (const tile of tiles) {
      expect(tile.label.color, `${tile.name} ink`).toBe(sectorTileTextColor(tile.itemStyle.color));
      const ratio = contrastRatio(tile.label.color, tile.itemStyle.color);
      expect(
        ratio,
        `${tile.name}: ${tile.label.color} on ${tile.itemStyle.color} = ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("tile label ink clears AA at every stop of the sector colour ramp", () => {
    for (let step = 0; step <= 100; step++) {
      const fill = lerpRgb(step);
      const ink = sectorTileTextColor(fill);
      const ratio = contrastRatio(ink, fill);
      expect(ratio, `${fill} -> ${ink} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
