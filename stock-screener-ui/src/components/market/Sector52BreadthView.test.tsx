// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { renderWithProviders } from "@/test-utils/renderWithProviders";
import { parseColor } from "@/utils/contrast";
import { VIZ_SCALE_PNL } from "@/ui/palette";
import type { MarketRow } from "@/types/marketScreener";
import {
  breadthBarColor,
  computeSectorBreadth,
  Sector52BreadthView,
} from "./Sector52BreadthView";

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

const row = (overrides: Partial<MarketRow>): MarketRow => ({ ...EMPTY_ROW, ...overrides });

/** Alpha: 2/3 near high, 1/3 near low. Beta: 1/3 near high, 2/3 near low. */
const ROWS = [
  row({ symbol: "A1", sector: "Alpha", change: 1, to52wHighPct: -2, from52wLowPct: 5 }),
  row({ symbol: "A2", sector: "Alpha", change: -1, to52wHighPct: -7, from52wLowPct: 20 }),
  row({ symbol: "A3", sector: "Alpha", change: 3, to52wHighPct: -4, from52wLowPct: 30 }),
  row({ symbol: "B1", sector: "Beta", change: 0.5, to52wHighPct: -1, from52wLowPct: 8 }),
  row({ symbol: "B2", sector: "Beta", change: -0.5, to52wHighPct: -10, from52wLowPct: 9 }),
  row({ symbol: "B3", sector: "Beta", change: 2, to52wHighPct: -6, from52wLowPct: 12 }),
];

const renderView = (rows: MarketRow[], onSymbolClick = vi.fn()) => {
  renderWithProviders(() => (
    <Sector52BreadthView rows={rows} onSymbolClick={onSymbolClick} />
  ));
  return onSymbolClick;
};

afterEach(cleanup);

describe("Sector52BreadthView — 52-week breadth bars", () => {
  test("groups by sector and computes both shares, n and median, ranked by near-high", () => {
    const breadth = computeSectorBreadth(ROWS);
    expect(breadth.map((entry) => entry.sector)).toEqual(["Alpha", "Beta"]);
    expect(breadth[0]).toEqual({
      sector: "Alpha",
      n: 3,
      nearHighPct: (2 / 3) * 100,
      nearLowPct: (1 / 3) * 100,
      medianChange: 1,
    });
    expect(breadth[1]).toEqual({
      sector: "Beta",
      n: 3,
      nearHighPct: (1 / 3) * 100,
      nearLowPct: (2 / 3) * 100,
      medianChange: 0.5,
    });
  });

  test("renders one labelled bar per sector in ranked order with both percentages and a numeric title", () => {
    renderView(ROWS);
    const names = screen
      .getAllByTestId(/^sector-52w-row-/)
      .map((element) => element.getAttribute("data-testid"));
    expect(names).toEqual(["sector-52w-row-alpha", "sector-52w-row-beta"]);

    const alpha = screen.getByTestId("sector-52w-row-alpha");
    expect(alpha).toHaveTextContent("Alpha");
    expect(screen.getByTestId("sector-52w-pct-alpha")).toHaveTextContent("66.7%");
    expect(alpha).toHaveTextContent("3 · near-low 33.3%");
    expect(alpha.getAttribute("title")).toContain("near high 66.7%");
    expect(alpha.getAttribute("title")).toContain("near low 33.3%");
    expect(alpha.getAttribute("title")).toContain("median +1.00%");

    expect(screen.getByTestId("sector-52w-pct-beta")).toHaveTextContent("33.3%");
    expect(screen.getByTestId("sector-52w-row-beta")).toHaveTextContent("near-low 66.7%");
    expect(screen.getByTestId("sector-52w-breadth-count")).toHaveTextContent("2 sectors");
  });

  test("toggle switches the plotted measure and recolours bars green → red via VIZ_SCALE_PNL", () => {
    renderView(ROWS);
    const bar = screen.getByTestId("sector-52w-bar-alpha");
    const nearHigh = parseColor(bar.style.getPropertyValue("background-color"));
    expect(nearHigh.g).toBeGreaterThan(nearHigh.r);

    const toggle = screen.getByTestId("sector-52w-breadth-toggle");
    fireEvent.click(toggle.querySelector('[data-value="low"]') as HTMLButtonElement);

    expect(screen.getByTestId("sector-52w-pct-alpha")).toHaveTextContent("33.3%");
    const nearLow = parseColor(bar.style.getPropertyValue("background-color"));
    expect(nearLow.r).toBeGreaterThan(nearLow.g);
    expect(breadthBarColor("high", 1)).toBe(VIZ_SCALE_PNL[8]);
    expect(breadthBarColor("low", 1)).toBe(VIZ_SCALE_PNL[0]);
  });

  test("sector rows are non-clickable and never forward a sector name to onSymbolClick", () => {
    const onSymbolClick = renderView(ROWS);
    const alpha = screen.getByTestId("sector-52w-row-alpha");
    expect(alpha.tagName).toBe("DIV");
    fireEvent.click(alpha);
    fireEvent.click(screen.getByTestId("sector-52w-bar-beta"));
    expect(onSymbolClick).not.toHaveBeenCalled();
  });

  test("empty input shows the explicit empty state", () => {
    renderView([]);
    expect(screen.getByTestId("sector-52w-breadth-empty")).toHaveTextContent(
      "No 52-week breadth data.",
    );
    expect(screen.queryAllByTestId(/^sector-52w-row-/)).toHaveLength(0);
  });

  test("all-null readings yield no bars and no NaN anywhere in the DOM", () => {
    const nullRows = ROWS.map((source) => ({
      ...source,
      to52wHighPct: null,
      from52wLowPct: null,
      change: null,
    }));
    renderView(nullRows);
    expect(screen.queryAllByTestId(/^sector-52w-row-/)).toHaveLength(0);
    expect(screen.getByTestId("sector-52w-breadth-empty")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("NaN");
    expect(document.body.innerHTML).not.toContain("NaN");
  });
});

describe("Sector52BreadthView — narrow-viewport bar preservation", () => {
  test("sector label is responsive and truncates with a native title", () => {
    renderView(ROWS);
    const alpha = screen.getByTestId("sector-52w-row-alpha");
    const label = alpha.querySelector('[title="Alpha"]');
    expect(label).not.toBeNull();
    expect(label).toHaveClass("w-[96px]");
    expect(label).toHaveClass("sm:w-[140px]");
    expect(label).toHaveClass("truncate");
    expect(label).toHaveAttribute("title", "Alpha");
  });

  test("trailing n / near-low detail is hidden below sm and carries a title", () => {
    renderView(ROWS);
    const detail = screen.getByTestId("sector-52w-detail-alpha");
    expect(detail).toHaveClass("hidden");
    expect(detail).toHaveClass("sm:inline-flex");
    expect(detail.getAttribute("class")).toMatch(/\bhidden\b.*\bsm:/);
    expect(detail).toHaveAttribute("title");
    expect(detail.getAttribute("title")).toContain("near low 33.3%");
    expect(detail).toHaveTextContent("3 · near-low 33.3%");
  });

  test("the bar keeps a minimum width so it cannot collapse at 390px", () => {
    renderView(ROWS);
    const barWrap = screen.getByTestId("sector-52w-bar-alpha").parentElement;
    expect(barWrap).not.toBeNull();
    expect(barWrap).toHaveClass("flex-1");
    expect(barWrap).toHaveClass("min-w-[48px]");
    expect(barWrap).toHaveClass("min-w-0");
    expect(barWrap?.style.getPropertyValue("min-width")).toBe("48px");
  });

  test("the toolbar never clips its controls", () => {
    renderView(ROWS);
    const toolbar = screen.getByTestId("sector-52w-breadth-toolbar");
    expect(toolbar).not.toHaveClass("overflow-hidden");
  });

  test("segment labels use the short form and keep cutoffs in the group aria-label", () => {
    renderView(ROWS);
    const toggle = screen.getByTestId("sector-52w-breadth-toggle");
    const visibleLabels = Array.from(toggle.querySelectorAll("button")).map(
      (button) => button.textContent,
    );
    expect(visibleLabels).toEqual(["Near high", "Near low"]);
    expect(toggle.getAttribute("aria-label")).toContain("≤5%");
    expect(toggle.getAttribute("aria-label")).toContain("≤10%");
    expect(document.body.textContent).not.toContain("Near high (≤5%)");
  });
});
