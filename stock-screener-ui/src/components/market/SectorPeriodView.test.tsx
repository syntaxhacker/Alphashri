// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { renderWithProviders } from "@/test-utils/renderWithProviders";
import { contrastRatio, parseColor } from "@/utils/contrast";
import { VIZ_SCALE_PNL } from "@/ui/palette";
import type { MarketRow } from "@/types/marketScreener";
import {
  cellLabelInk,
  computeSectorPeriods,
  periodExtents,
  SECTOR_LABEL_MAX_CHARS,
  SectorPeriodView,
  sectorLabelLines,
  sectorPeriodColor,
} from "./SectorPeriodView";

const viewport = vi.hoisted(() => ({ narrow: false }));
vi.stubGlobal("matchMedia", (query: string) => ({
  matches: query.includes("min-width: 640px") ? !viewport.narrow : false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
}) as unknown as MediaQueryList);

const EMPTY_ROW: MarketRow = {
  symbol: "",
  name: "",
  sector: null,
  exchange: "NSE",
  close: 100,
  change: null,
  relativeVolume: null,
  marketCapCr: null,
  capTier: null,
  rsi: null,
  adx: null,
  sma20: null,
  sma50: null,
  sma200: null,
  perfW: null,
  perf1m: null,
  high52w: null,
  low52w: null,
  pos52w: null,
  peRatio: null,
  pbRatio: null,
  dividendYield: null,
  roe: null,
  psRatio: null,
  fcfYield: null,
  revenue: null,
  netIncome: null,
  debtToEquity: null,
  currentRatio: null,
  grossMargin: null,
  operatingMargin: null,
  revYoy: null,
  epsYoy: null,
  fno: false,
  etf: false,
  volume: null,
  avgVolume: null,
  gap: null,
  atr: null,
  high: null,
  low: null,
  valueTraded: null,
  to52wHighPct: null,
  from52wLowPct: null,
  rangeVsAtr: null,
};

const row = (symbol: string, overrides: Partial<MarketRow>): MarketRow => ({
  ...EMPTY_ROW,
  symbol,
  ...overrides,
});

/**
 * Alpha holds a +99% outlier so the median (2) differs from the mean (34);
 * A4 has no quotes at all and must not become a zero. Beta is the loss cohort.
 */
const ROWS: MarketRow[] = [
  row("A1", { sector: "Alpha", change: 1, perfW: 2, perf1m: 3 }),
  row("A2", { sector: "Alpha", change: 99, perfW: 4, perf1m: 5 }),
  row("A3", { sector: "Alpha", change: 2, perfW: null, perf1m: null }),
  row("A4", { sector: "Alpha", change: null, perfW: null, perf1m: null }),
  row("B1", { sector: "Beta", change: -1, perfW: -2, perf1m: -3 }),
  row("B2", { sector: "Beta", change: -3, perfW: -4, perf1m: null }),
];

const renderView = (rows: MarketRow[], onSymbolClick = vi.fn()) => {
  renderWithProviders(() => <SectorPeriodView rows={rows} onSymbolClick={onSymbolClick} />);
  return onSymbolClick;
};

beforeEach(() => {
  viewport.narrow = false;
});

afterEach(cleanup);

describe("SectorPeriodView — sector × period heatmap", () => {
  test("medians ignore nulls and outliers, count finite names, and sort by 1D desc", () => {
    const sectors = computeSectorPeriods(ROWS);
    expect(sectors.map((entry) => entry.sector)).toEqual(["Alpha", "Beta"]);
    expect(sectors[0]).toEqual({
      sector: "Alpha",
      n: 4,
      cells: [
        { period: "1D", median: 2, n: 3 },
        { period: "1W", median: 3, n: 2 },
        { period: "1M", median: 4, n: 2 },
      ],
    });
    expect(sectors[1]).toEqual({
      sector: "Beta",
      n: 2,
      cells: [
        { period: "1D", median: -2, n: 2 },
        { period: "1W", median: -3, n: 2 },
        { period: "1M", median: -3, n: 1 },
      ],
    });
    expect(periodExtents(sectors)).toEqual({ "1D": 2, "1W": 3, "1M": 4 });
  });

  test("renders three labelled columns per sector with medians, n and a full title", () => {
    renderView(ROWS);
    expect(screen.getByTestId("sector-period-head-1D")).toHaveTextContent("1D");
    expect(screen.getByTestId("sector-period-head-1W")).toHaveTextContent("1W");
    expect(screen.getByTestId("sector-period-head-1M")).toHaveTextContent("1M");

    const rows = screen.getAllByTestId(/^sector-period-row-/);
    expect(rows.map((element) => element.getAttribute("data-testid"))).toEqual([
      "sector-period-row-alpha",
      "sector-period-row-beta",
    ]);
    expect(screen.getByTestId("sector-period-n-alpha")).toHaveTextContent("n 4");
    expect(screen.getByTestId("sector-period-count")).toHaveTextContent("2 sectors · 6 stocks");

    const alpha1d = screen.getByTestId("sector-period-cell-alpha-1D");
    expect(alpha1d).toHaveAttribute("data-median", "2.0000");
    expect(alpha1d).toHaveAttribute("data-n", "3");
    expect(screen.getByTestId("sector-period-value-alpha-1D")).toHaveTextContent("+2.00%");
    expect(screen.getByTestId("sector-period-value-beta-1M")).toHaveTextContent("-3.00%");
    expect(screen.getAllByTestId(/^sector-period-cell-/)).toHaveLength(6);

    const title = screen.getByTestId("sector-period-row-alpha").getAttribute("title");
    expect(title).toContain("n 4");
    expect(title).toContain("1D median +2.00% (n 3)");
    expect(title).toContain("1W median +3.00% (n 2)");
    expect(title).toContain("1M median +4.00% (n 2)");
  });

  test("fills cells from VIZ_SCALE_PNL: gains green, losses red, √ scale keeps +1% visible", () => {
    renderView(ROWS);
    const alpha = parseColor(screen.getByTestId("sector-period-cell-alpha-1D").style.getPropertyValue("background-color"));
    const beta = parseColor(screen.getByTestId("sector-period-cell-beta-1D").style.getPropertyValue("background-color"));
    expect(alpha.g).toBeGreaterThan(alpha.r);
    expect(beta.r).toBeGreaterThan(beta.g);

    // Each column's max median reaches its own saturated end of the ramp.
    expect(sectorPeriodColor(2, 2)).toBe(VIZ_SCALE_PNL[8]);
    expect(sectorPeriodColor(-2, 2)).toBe(VIZ_SCALE_PNL[0]);
    expect(sectorPeriodColor(null, 2)).toBe(VIZ_SCALE_PNL[4]);
    // Extent floor 0.5 makes a modest +1% a clearly green stop, not neutral.
    expect(sectorPeriodColor(1, 0.5)).toBe(VIZ_SCALE_PNL[8]);
    expect(sectorPeriodColor(0, 0.5)).toBe(VIZ_SCALE_PNL[4]);
  });

  test("cell labels clear 4.5:1 with pickTextColor plus a scrim only when needed", () => {
    renderView(ROWS);
    const fill = screen.getByTestId("sector-period-cell-beta-1M").style.getPropertyValue("background-color");
    const { ink, scrim } = cellLabelInk(fill);
    expect(contrastRatio(ink, scrim ?? fill)).toBeGreaterThanOrEqual(4.5);
    expect(screen.getByTestId("sector-period-value-beta-1M").style.color).toBe(ink);

    // The neutral mid-stop needs the scrim; the darkest red does not.
    expect(cellLabelInk(VIZ_SCALE_PNL[4]!).scrim).not.toBeNull();
    expect(cellLabelInk(VIZ_SCALE_PNL[0]!).scrim).toBeNull();
  });

  test("sector rows never forward a click to onSymbolClick", () => {
    const onSymbolClick = renderView(ROWS);
    expect(screen.getByTestId("sector-period-row-alpha").tagName).toBe("DIV");
    fireEvent.click(screen.getByTestId("sector-period-row-alpha"));
    fireEvent.click(screen.getByTestId("sector-period-cell-beta-1D"));
    expect(onSymbolClick).not.toHaveBeenCalled();
  });

  test("empty input, or rows with no sector, shows the explicit empty state", () => {
    renderView([]);
    expect(screen.getByTestId("sector-period-empty")).toHaveTextContent("No sector period data.");
    expect(screen.queryAllByTestId(/^sector-period-cell-/)).toHaveLength(0);
    cleanup();

    renderView([row("X1", { change: 1, perfW: 2, perf1m: 3 })]);
    expect(screen.getByTestId("sector-period-empty")).toBeInTheDocument();
  });

  test("narrow legend stacks the ramp/labels and the n note without clipping either", () => {
    viewport.narrow = true;
    renderView(ROWS);

    const legend = screen.getByTestId("sector-period-legend");
    expect(legend).toHaveClass("flex-col");
    expect(legend).not.toHaveClass("overflow-hidden");

    const ramp = screen.getByTestId("sector-period-legend-ramp");
    const labels = screen.getByTestId("sector-period-legend-text");
    const note = screen.getByTestId("sector-period-legend-note");
    expect(ramp.parentElement).toBe(labels.parentElement);
    expect(ramp.parentElement).toBe(legend.firstElementChild);
    expect(note.parentElement).toBe(legend);
    expect(note).toBe(legend.lastElementChild);
    expect(note).toHaveTextContent("median by sector · n = quoted names");
    expect(screen.queryByText("loss ← 0 → gain")).toBeInTheDocument();
  });

  test("wide legend stays on one line and drops the clip", () => {
    renderView(ROWS);
    const legend = screen.getByTestId("sector-period-legend");
    expect(legend).toHaveClass("flex-nowrap");
    expect(legend).not.toHaveClass("overflow-hidden");
    expect(screen.getByTestId("sector-period-legend-note")).toBeInTheDocument();
  });

  test("cells pair their aria-label with an img role and keep the full title", () => {
    renderView(ROWS);
    const cell = screen.getByTestId("sector-period-cell-alpha-1D");
    expect(cell).toHaveAttribute("role", "img");
    expect(cell).toHaveAttribute("aria-label", "Alpha 1D median +2.00% of 3");
    expect(cell).toHaveAttribute("title", "Alpha · 1D median +2.00% (n 3)");
  });

  test("sector label lines break only at spaces at the 390px column budget", () => {
    expect(SECTOR_LABEL_MAX_CHARS).toBe(14);
    expect(sectorLabelLines("Producer Manufacturing", SECTOR_LABEL_MAX_CHARS)).toEqual([
      "Producer",
      "Manufacturing",
    ]);
    expect(sectorLabelLines("Communications", SECTOR_LABEL_MAX_CHARS)).toEqual(["Communications"]);

    const names = [
      "Producer Manufacturing",
      "Communications",
      "Electronic Technology",
      "Consumer Non-Durables",
      "Retail Trade",
    ];
    for (const name of names) {
      const lines = sectorLabelLines(name, SECTOR_LABEL_MAX_CHARS);
      // Re-joining on a space must reproduce the name: a mid-word cut would
      // insert a space inside a word and fail this equality.
      expect(lines.join(" ")).toBe(name);
      for (const line of lines) {
        expect(name).toContain(line);
        expect(line.length).toBeGreaterThan(0);
      }
    }
  });

  test("rendered label cells wrap with break-normal, never break-words, and keep the full row title", () => {
    renderView(ROWS);
    const label = screen.getByTestId("sector-period-label-alpha");
    expect(label).not.toHaveClass("break-words");
    expect(label).toHaveClass("break-normal", "whitespace-normal");
    expect(label.querySelectorAll("span.block")).toHaveLength(1);

    const row = screen.getByTestId("sector-period-row-alpha");
    expect(row).toHaveAttribute(
      "title",
      "Alpha · n 4 · 1D median +2.00% (n 3) · 1W median +3.00% (n 2) · 1M median +4.00% (n 2)",
    );
  });
});
