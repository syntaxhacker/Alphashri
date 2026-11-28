// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, test, vi } from "vitest";
import { renderWithProviders } from "@/test-utils/renderWithProviders";
import { VIZ_BG, VIZ_DOWN, VIZ_SCALE_PNL, VIZ_TEXT, VIZ_UP } from "@/ui/palette";
import { contrastRatio } from "@/utils/contrast";
import type { MarketRow } from "@/types/marketScreener";
import type { VisRenderProps } from "./MarketMapView";
import {
  REL_VOL_LIMIT,
  REL_VOL_THRESHOLD,
  RelVolView,
  filterRelVolRows,
  formatChange,
  formatRelVol,
  relVolColor,
  relVolPct,
  relVolTextColor,
  selectRelVolRows,
} from "./RelVolView";

function row(symbol: string, overrides: Partial<MarketRow> = {}): MarketRow {
  return {
    symbol,
    name: symbol,
    sector: "IT",
    exchange: "NSE",
    close: 100,
    change: 1,
    relativeVolume: 1,
    marketCapCr: 1000,
    capTier: "mid",
    rsi: 50,
    adx: 20,
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
    volume: 1_000_000,
    avgVolume: 500_000,
    gap: null,
    atr: null,
    high: null,
    low: null,
    valueTraded: 10_000_000,
    to52wHighPct: null,
    from52wLowPct: null,
    rangeVsAtr: null,
    fno: false,
    etf: false,
    ...overrides,
  };
}

/** 3.4× / 2.4× / 1.8× / 0.9× with mixed signs; a null rel-vol is also present. */
const ROWS: MarketRow[] = [
  row("AAA", { relativeVolume: 3.4, change: 2.5 }),
  row("BBB", { relativeVolume: 2.4, change: -1.5 }),
  row("CCC", { relativeVolume: 1.8, change: 0.5 }),
  row("DDD", { relativeVolume: 0.9, change: -3 }),
];

function renderView(rows: MarketRow[], onSymbolClick?: (symbol: string) => void) {
  const props: VisRenderProps = { rows, onSymbolClick };
  renderWithProviders(() => <RelVolView {...props} />);
}

const findRow = (symbol: string) => screen.getByTestId(`relvol-row-${symbol}`);

function normColor(value: string): string {
  const text = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{6})$/.exec(text);
  if (!hex) return text;
  const n = Number.parseInt(hex[1], 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

afterEach(cleanup);

describe("RelVolView", () => {
  test("renders top rows by relative volume descending, formatting values as N×", () => {
    renderView([...ROWS, row("NULL", { relativeVolume: null })]);
    const rows = screen.getByTestId("relvol-list").querySelectorAll("[data-symbol]");
    expect(Array.from(rows, (item) => item.getAttribute("data-symbol"))).toEqual([
      "AAA",
      "BBB",
      "CCC",
      "DDD",
    ]);
    expect(screen.queryByTestId("relvol-row-NULL")).not.toBeInTheDocument();
    expect(within(findRow("AAA")).getByTestId("relvol-value")).toHaveTextContent("3.4×");
    expect(within(findRow("BBB")).getByTestId("relvol-value")).toHaveTextContent("2.4×");
    expect(screen.getByTestId("relvol-count")).toHaveTextContent("showing 4 of 4");
  });

  test("the filter chips restrict to ≥2× and ≥3× and update the counter", () => {
    renderView(ROWS);
    const visible = () =>
      Array.from(
        screen.getByTestId("relvol-list").querySelectorAll("[data-symbol]"),
        (item) => item.getAttribute("data-symbol"),
      );

    expect(visible()).toEqual(["AAA", "BBB", "CCC", "DDD"]);
    fireEvent.click(screen.getByTestId("relvol-filter-gte2"));
    expect(visible()).toEqual(["AAA", "BBB"]);
    expect(screen.getByTestId("relvol-count")).toHaveTextContent("showing 2 of 2");
    expect(screen.getByTestId("relvol-filter-gte2")).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByTestId("relvol-filter-gte3"));
    expect(visible()).toEqual(["AAA"]);

    fireEvent.click(screen.getByTestId("relvol-filter-all"));
    expect(visible()).toEqual(["AAA", "BBB", "CCC", "DDD"]);
  });

  test("track and dot geometry scales to the max and the 2× reference line is placed", () => {
    renderView(ROWS);
    const dotPct = (symbol: string) =>
      within(findRow(symbol)).getByTestId("relvol-dot").getAttribute("data-dot-pct");
    const trackPct = (symbol: string) =>
      within(findRow(symbol)).getByTestId("relvol-track").getAttribute("data-track-pct");

    expect(dotPct("AAA")).toBe("100.000%");
    expect(trackPct("AAA")).toBe(dotPct("AAA"));
    expect(Number.parseFloat(dotPct("BBB")!)).toBeLessThan(Number.parseFloat(dotPct("AAA")!));
    expect(Number.parseFloat(dotPct("DDD")!)).toBeLessThan(Number.parseFloat(dotPct("CCC")!));
    expect(within(findRow("AAA")).getByTestId("relvol-dot")).toHaveStyle({
      left: "100.000%",
    });

    const threshold = screen.getAllByTestId("relvol-threshold")[0];
    expect(threshold).toHaveAttribute("data-threshold-pct", "58.824%");
    expect(screen.getByTestId("relvol-threshold-label")).toHaveTextContent("2×");
  });

  test("dot uses the P&L ramp but change text uses readable semantic ink", () => {
    renderView(ROWS);
    const dotColor = (symbol: string) =>
      within(findRow(symbol)).getByTestId("relvol-dot").getAttribute("data-dot-color");
    expect(dotColor("AAA")).toBe(VIZ_SCALE_PNL[7]);
    expect(dotColor("DDD")).toBe(VIZ_SCALE_PNL[0]);
    expect(dotColor("AAA")).not.toBe(dotColor("DDD"));

    const upChange = within(findRow("AAA")).getByTestId("relvol-change");
    const downChange = within(findRow("DDD")).getByTestId("relvol-change");
    expect(upChange).toHaveTextContent("+2.50%");
    expect(downChange).toHaveTextContent("-3.00%");
    expect(normColor(upChange.style.color)).toBe(normColor(VIZ_UP));
    expect(normColor(downChange.style.color)).toBe(normColor(VIZ_DOWN));
  });

  test("the 2× label clamps to half its width at the high rail edge", () => {
    renderView([row("EDGE", { relativeVolume: REL_VOL_THRESHOLD })]);
    const label = screen.getByTestId("relvol-threshold-label");
    expect(label).toHaveAttribute("data-threshold-label-pct", "94.000%");
    expect(label).toHaveStyle({ left: "94.000%" });
    expect(screen.getAllByTestId("relvol-threshold")[0]).toHaveAttribute("data-threshold-pct", "100.000%");
  });

  test("the 2× label clamps to half its width at the low rail edge", () => {
    renderView([row("HUGE", { relativeVolume: 200 })]);
    const label = screen.getByTestId("relvol-threshold-label");
    expect(label).toHaveAttribute("data-threshold-label-pct", "6.000%");
    expect(label).toHaveStyle({ left: "6.000%" });
    expect(screen.getAllByTestId("relvol-threshold")[0]).toHaveAttribute("data-threshold-pct", "1.000%");
  });

  test("the legend wraps and stacks its reference note on narrow viewports", () => {
    renderView(ROWS);
    expect(screen.getByTestId("relvol-legend")).toHaveClass("flex-wrap");
    expect(screen.getByTestId("relvol-legend-scale-group")).toBeInTheDocument();
    expect(screen.getByTestId("relvol-legend-reference")).toHaveClass("basis-full", "sm:basis-auto");
  });

  test("clicking a row forwards its symbol to onSymbolClick", () => {
    const onClick = vi.fn();
    renderView(ROWS, onClick);
    fireEvent.click(findRow("CCC"));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledWith("CCC");
  });

  test("null and non-finite relative volumes are excluded; the empty state is honest", () => {
    renderView([row("NO_RELVOL", { relativeVolume: null }), row("NAN", { relativeVolume: Number.NaN })]);
    expect(screen.getByTestId("relvol-empty")).toHaveTextContent(
      "No relative-volume data in the current filter.",
    );
    expect(screen.queryByTestId("relvol-list")).not.toBeInTheDocument();
  });

  test("an empty input shows the same empty state", () => {
    renderView([]);
    expect(screen.getByTestId("relvol-empty")).toHaveTextContent(
      "No relative-volume data in the current filter.",
    );
  });

  test("a filter with no matches shows the empty state", () => {
    renderView([row("LOW", { relativeVolume: 1.2 })]);
    fireEvent.click(screen.getByTestId("relvol-filter-gte2"));
    expect(screen.getByTestId("relvol-empty")).toBeInTheDocument();
  });
});

describe("rel-vol helpers", () => {
  test("selection drops nulls and limits to the top 50", () => {
    const rows = Array.from({ length: REL_VOL_LIMIT + 2 }, (_, i) =>
      row(`S${String(i).padStart(3, "0")}`, { relativeVolume: i + 1 }),
    ).concat(row("NULL", { relativeVolume: null }));
    const selected = selectRelVolRows(rows);
    expect(selected).toHaveLength(REL_VOL_LIMIT);
    expect(selected[0].relativeVolume).toBe(REL_VOL_LIMIT + 2);
    expect(selected.every((item) => (item.relativeVolume ?? 0) >= 3)).toBe(true);
  });

  test("filter thresholds use ≥ and 'all' is a no-op", () => {
    expect(filterRelVolRows(ROWS, "gte2").map((r) => r.symbol)).toEqual(["AAA", "BBB"]);
    expect(filterRelVolRows(ROWS, "gte3").map((r) => r.symbol)).toEqual(["AAA"]);
    expect(filterRelVolRows(ROWS, "all")).toEqual(ROWS);
  });

  test("formatting and geometry helpers are finite and clamped", () => {
    expect(formatRelVol(3.42)).toBe("3.4×");
    expect(formatRelVol(null)).toBe("n/a");
    expect(formatChange(-0.0001)).toBe("0.00%");
    expect(formatChange(1.25)).toBe("+1.25%");
    expect(formatChange(null)).toBe("—");
    expect(relVolPct(3.4, 3.4)).toBe(100);
    expect(relVolPct(5, 3.4)).toBe(100);
    expect(relVolPct(null, 3.4)).toBe(0);
  });

  test("the P&L ramp never inverts gain/loss and null change is neutral", () => {
    expect(relVolColor(5, 5)).toBe(VIZ_SCALE_PNL[8]);
    expect(relVolColor(-5, 5)).toBe(VIZ_SCALE_PNL[0]);
    expect(relVolColor(0, 5)).toBe(VIZ_SCALE_PNL[4]);
    expect(relVolColor(null, 5)).toBe(VIZ_SCALE_PNL[4]);
    expect(normColor(VIZ_UP)).not.toBe(normColor(VIZ_DOWN));
  });

  test("text ink uses semantic tokens while the dot keeps its ramp hue", () => {
    expect(relVolTextColor(2.5)).toBe(VIZ_UP);
    expect(relVolTextColor(-3)).toBe(VIZ_DOWN);
    expect(relVolTextColor(0)).toBe(VIZ_TEXT);
    expect(relVolTextColor(null)).toBe(VIZ_TEXT);
    expect(relVolColor(2.5, 3)).toBe(VIZ_SCALE_PNL[7]);
    expect(relVolColor(-3, 3)).toBe(VIZ_SCALE_PNL[0]);
  });

  test("each change-text ink clears the 4.5:1 floor on VIZ_BG", () => {
    const inks = [
      ["gain", VIZ_UP],
      ["loss", VIZ_DOWN],
      ["flat", VIZ_TEXT],
    ] as const;
    for (const [name, ink] of inks) {
      const ratio = contrastRatio(ink, VIZ_BG);
      expect(ratio, `${name} ${ink} on ${VIZ_BG} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
