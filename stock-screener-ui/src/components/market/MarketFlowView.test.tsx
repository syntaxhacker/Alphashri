// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { renderWithProviders } from "@/test-utils/renderWithProviders";
import { contrastRatio } from "@/utils/contrast";
import { VIZ_DOWN, VIZ_SCALE_PNL, VIZ_UP } from "@/ui/palette";
import type { MarketRow } from "@/types/marketScreener";
import {
  aggregateSectorFlow,
  flowExtent,
  flowSentence,
  formatAmount,
  MarketFlowView,
  placeRingLabels,
  railAppearance,
  rectsOverlap,
  shortSectorName,
  tileAppearance,
  type RingLabelRect,
} from "./MarketFlowView";

const blank: MarketRow = {
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
  ...blank,
  symbol,
  name: symbol,
  ...overrides,
});

/** Alpha has a +99 outlier so the median (2) differs from the mean (34). */
const ROWS: MarketRow[] = [
  row("A1", { sector: "Alpha", change: 1, valueTraded: 1000, close: 100 }),
  row("A2", { sector: "Alpha", change: 99, valueTraded: 1000, close: 100 }),
  row("A3", { sector: "Alpha", change: 2, valueTraded: 1000, close: 100 }),
  row("A4", { sector: "Alpha", change: null, valueTraded: 5000, close: 100 }),
  row("B1", { sector: "Beta", change: -1, valueTraded: 500, close: 100 }),
  row("B2", { sector: "Beta", change: -3, valueTraded: 500, close: 100 }),
  row("C1", { sector: null, change: -0.5, valueTraded: 100, close: 100 }),
  // volume × close fallback, and a row that has neither turnover source.
  row("D1", { sector: "Delta", change: 0.5, valueTraded: null, volume: 10, close: 20 }),
  row("E1", { sector: "Epsilon", change: 0.2, valueTraded: null, volume: null, close: 20 }),
];

const renderView = (rows: MarketRow[], onSymbolClick = vi.fn()) => {
  renderWithProviders(() => (
    <MarketFlowView rows={rows} onSymbolClick={onSymbolClick} currency="INR" />
  ));
  return onSymbolClick;
};

afterEach(cleanup);

describe("MarketFlowView — aggregation", () => {
  test("median beats mean; non-finite changes, null sectors and turnover fallbacks are honoured", () => {
    const groups = aggregateSectorFlow(ROWS);
    expect(groups.map((group) => group.sector)).toEqual([
      "Alpha",
      "Beta",
      "Delta",
      "Unclassified",
      "Epsilon",
    ]);
    expect(groups[0]).toMatchObject({
      sector: "Alpha",
      members: 3,
      turnover: 3000,
      signedTurnover: 3000,
      change: 2,
      advances: 3,
      declines: 0,
      missingTurnover: 0,
    });
    expect(groups[1]).toMatchObject({
      sector: "Beta",
      members: 2,
      turnover: 1000,
      signedTurnover: -1000,
      change: -2,
      advances: 0,
      declines: 2,
    });
    expect(groups[2]).toMatchObject({
      sector: "Delta",
      turnover: 200,
      signedTurnover: 200,
      change: 0.5,
    });
    expect(groups[3]).toMatchObject({
      sector: "Unclassified",
      members: 1,
      turnover: 100,
      signedTurnover: -100,
      change: -0.5,
    });
    expect(groups[4]).toMatchObject({
      sector: "Epsilon",
      members: 1,
      turnover: 0,
      signedTurnover: 0,
      missingTurnover: 1,
    });
    // A4's 5,000 never enters any sum and can never skew the median.
    expect(groups.reduce((sum, group) => sum + group.turnover, 0)).toBe(4300);
  });

  test("blank/whitespace sectors join Unclassified; NaN and Infinity changes are ignored", () => {
    const groups = aggregateSectorFlow([
      row("X1", { sector: "   ", change: 1, valueTraded: 10 }),
      row("X2", { sector: "Beta", change: Number.NaN, valueTraded: 1000 }),
      row("X3", { sector: "Beta", change: Number.POSITIVE_INFINITY, valueTraded: 1000 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.sector).toBe("Unclassified");
    expect(groups[0]!.signedTurnover).toBe(10);
  });

  test("signed turnover is sign-weighted, and the proxy is named honestly everywhere", () => {
    const groups = aggregateSectorFlow([
      row("M1", { sector: "Mix", change: 2, valueTraded: 100 }),
      row("M2", { sector: "Mix", change: -0.01, valueTraded: 900 }),
    ]);
    expect(groups[0]!.turnover).toBe(1000);
    expect(groups[0]!.signedTurnover).toBeCloseTo(-800);
    expect(groups[0]!.change).toBeCloseTo(0.995);
    const sentence = flowSentence(groups[0]!, "INR");
    expect(sentence).toContain("signed turnover (proxy)");
    expect(sentence).toContain("outflow");
    expect(sentence).not.toMatch(/net flow/i);
  });

  test("ramp extent has a floor and rail magnitude is independent of colour sign", () => {
    expect(flowExtent([])).toBe(0.5);
    // The domain is the max |median|, so the +99 outlier cannot flatten it.
    expect(flowExtent(aggregateSectorFlow(ROWS))).toBe(2);
    const up = railAppearance(100, 1000);
    const down = railAppearance(-100, 1000);
    expect(up.direction).toBe("in");
    expect(down.direction).toBe("out");
    expect(up.color).toBe(VIZ_UP);
    expect(down.color).toBe(VIZ_DOWN);
    expect(up.width).toBeCloseTo(down.width);
    expect(railAppearance(1000, 1000).width).toBeGreaterThan(railAppearance(1, 1000).width);
  });

  test("tile ink always clears 4.5:1, capping fill alpha when it would not", () => {
    const extent = flowExtent(aggregateSectorFlow(ROWS));
    const moves = [-99, -7.61, -0.05, 0, 0.01, 1.45, 7.61, 99];
    const worst = Math.min(
      ...moves.map((move) => {
        const look = tileAppearance(move, extent);
        return contrastRatio(look.fill, look.ink);
      }),
    );
    expect(worst).toBeGreaterThanOrEqual(4.5);
    expect(tileAppearance(0.01, extent).alpha).toBeLessThan(tileAppearance(7.61, extent).alpha);
  });

  test("unknown long names are abbreviated by initials, not ellipsis-truncated", () => {
    expect(shortSectorName("Producer Manufacturing")).toBe("Producer Mfg");
    expect(shortSectorName("Biotechnology Equipment")).toBe("BE");
  });
});

describe("MarketFlowView — ring", () => {
  test("renders one focusable, titled arc per group", () => {
    renderView(ROWS);
    const sectors = document.querySelectorAll("g.mf-sector");
    expect(sectors).toHaveLength(5);
    for (const sector of Array.from(sectors)) {
      expect(sector.getAttribute("tabindex")).toBe("0");
      expect(sector.getAttribute("role")).toBe("img");
      const title = sector.querySelector("title");
      expect(title).not.toBeNull();
      expect(title!.textContent).toContain("signed turnover (proxy)");
    }
    expect(document.querySelectorAll("path.mf-arc")).toHaveLength(5);
    expect(document.querySelectorAll("path.mf-rail")).toHaveLength(5);
    expect(document.querySelectorAll("[data-testid^='market-flow-arrow-']")).toHaveLength(5);
    expect(screen.getByTestId("market-flow-centre")).toHaveTextContent("MARKET");
    expect(screen.getByTestId("market-flow-session")).toHaveTextContent("SESSION");
  });

  test("positive change + negative signed turnover = green fill with an outflow rail", () => {
    renderView([
      row("M1", { sector: "Mix", change: 2, valueTraded: 100 }),
      row("M2", { sector: "Mix", change: -0.01, valueTraded: 900 }),
    ]);
    const arc = document.querySelector("g.mf-sector") as SVGGElement;
    const fill = arc.getAttribute("data-fill")!;
    // VIZ_SCALE_PNL is loss red → neutral → gain green.
    expect(VIZ_SCALE_PNL.indexOf(fill)).toBeGreaterThan(4);
    expect(arc.getAttribute("data-direction")).toBe("out");
    const rail = screen.getByTestId("market-flow-rail-0");
    expect(rail).toHaveClass("mf-rail", "mf-out");
    expect(rail).not.toHaveClass("mf-in");
    expect(rail.getAttribute("stroke")).toBe(VIZ_DOWN);
    expect(screen.getByTestId("market-flow-arrow-0").getAttribute("fill")).toBe(VIZ_DOWN);
  });

  test("rail CSS is static and the SVG is responsive", () => {
    renderView(ROWS);
    const style = screen.getByTestId("market-flow-css");
    expect(style.textContent).not.toContain("@keyframes");
    expect(style.textContent).not.toContain("animation");
    expect(style.textContent).not.toContain("prefers-reduced-motion");
    expect(style.textContent).toContain(".mf-rail { fill: none; stroke-linecap: round; stroke-dasharray: 5 7; }");
    const layoutCss = style.textContent!;
    expect(layoutCss).toContain("@media (min-width: 900px)");
    expect(layoutCss).toContain("max-width: 1080px");
    const svg = screen.getByTestId("market-flow-svg");
    expect(svg).toHaveAttribute("viewBox", "0 0 440 440");
    expect(svg).toHaveAttribute("preserveAspectRatio", "xMidYMid meet");
    expect(svg.style.width).toBe("100%");
    expect(svg.style.height).toBe("100%");
  });

  test("fit-to-screen structure uses a flex canvas and flexible heatmap rows", () => {
    renderView(ROWS);
    const css = screen.getByTestId("market-flow-css").textContent!;
    expect(css).toContain(".mf-canvas { flex: 1; min-width: 0; min-height: 0;");
    expect(css).toContain("grid-auto-rows: minmax(0, 1fr)");
    expect(css).not.toMatch(/grid-auto-rows:\s*\d+(?:px|rem)/);
    expect(css).toContain(".mf-tile span { line-height: 14px; }");
    expect(css).toContain("@media (max-width: 899px)");
    expect(css).toContain("max-width: 260px");
    expect(css).toContain("repeat(2, minmax(0, 1fr))");
    expect(css).toContain("overflow-y: auto");
    expect(screen.getByTestId("market-flow-canvas")).toHaveClass("mf-canvas", "flex-1", "min-h-0");
    expect(screen.getByTestId("market-flow-count").textContent).toContain("↓ scroll");
    expect(screen.getByTestId("market-flow-tile-turnover-0")).toBeInTheDocument();
    expect(screen.getByTestId("market-flow-ring-panel")).toHaveClass("min-h-0");
    expect(screen.getByTestId("market-flow-layout")).toHaveClass("flex-1", "min-h-0");
    expect(screen.getByTestId("market-flow-heat")).toHaveClass("mf-heat-grid", "flex-1", "min-h-0");
    for (const tile of Array.from(document.querySelectorAll(".mf-tile"))) {
      expect(tile).toHaveClass("p-1");
      expect(tile).not.toHaveClass("p-2");
    }
  });

  test("rails are static but keep width, direction and a correctly pointing arrowhead", () => {
    renderView(ROWS);
    const rails = Array.from(document.querySelectorAll<SVGPathElement>("path.mf-rail"));
    expect(rails).toHaveLength(5);
    for (const rail of rails) {
      expect(rail.hasAttribute("style")).toBe(false);
      expect(rail.style.animationDuration).toBe("");
      expect(rail.hasAttribute("data-duration")).toBe(false);
      expect(rail.getAttribute("data-width")).toMatch(/^\d+\.\d{2}$/);
      expect(
        rail.classList.contains("mf-in") || rail.classList.contains("mf-out"),
      ).toBe(true);
    }
    expect(screen.getByTestId("market-flow-rail-0")).toHaveClass("mf-in");
    expect(screen.getByTestId("market-flow-rail-1")).toHaveClass("mf-out");

    // The arrow path is `M tip L base L base Z`; compare radii from the ring
    // centre so the check is about direction, not screen coordinates.
    const radii = (testId: string): [number, number] => {
      const path = screen.getByTestId(testId).getAttribute("d")!;
      const [tip, base] = path.replace(/[MLZ]/g, " ").trim().split(/\s+/);
      const radius = (point: string) => {
        const [x, y] = point.split(",").map(Number);
        return Math.hypot(x! - 220, y! - 220);
      };
      return [radius(tip!), radius(base!)];
    };
    const [inTip, inBase] = radii("market-flow-arrow-0");
    const [outTip, outBase] = radii("market-flow-arrow-1");
    expect(inTip!).toBeLessThan(inBase!);
    expect(outTip!).toBeGreaterThan(outBase!);
  });

  test("ring label carries the full sector name, never an ellipsis", () => {
    renderView([row("P1", { sector: "Finance", change: 1, valueTraded: 10 })]);
    expect(screen.getByTestId("market-flow-label-0")).toHaveTextContent("Finance");
    expect(screen.getByTestId("market-flow-label-0").textContent).not.toContain("…");
    const arc = document.querySelector("g.mf-sector")!;
    expect(arc.getAttribute("aria-label")).toContain("Finance");
    expect(arc.querySelector("title")!.textContent).toContain("Finance");
  });
});

describe("MarketFlowView — heatmap, states and interaction", () => {
  test("tile count equals group count and follows the ring order", () => {
    renderView(ROWS);
    const arcs = Array.from(document.querySelectorAll("g.mf-sector")).map((node) =>
      node.getAttribute("data-sector"),
    );
    const tiles = Array.from(document.querySelectorAll(".mf-tile")).map((node) =>
      node.getAttribute("data-sector"),
    );
    expect(tiles).toHaveLength(5);
    expect(tiles).toEqual(arcs);
    expect(screen.getByTestId("market-flow-heat")).toHaveClass("mf-heat-grid", "min-h-0");
    expect(screen.getByTestId("market-flow-tile-change-0")).toHaveTextContent("+2.00%");
    expect(screen.getByTestId("market-flow-tile-signed-0")).toHaveTextContent("inflow");
    expect(screen.getByTestId("market-flow-tile-turnover-0")).toHaveTextContent("turnover");
  });

  test("every rendered tile clears 4.5:1 text contrast on its composited fill", () => {
    renderView(ROWS);
    const ratios = Array.from(document.querySelectorAll<HTMLElement>(".mf-tile")).map((tile) =>
      contrastRatio(tile.dataset.fill!, tile.dataset.ink!),
    );
    expect(ratios).toHaveLength(5);
    expect(Math.min(...ratios)).toBeGreaterThanOrEqual(4.5);
  });

  test("empty state is explicit and has no arcs or tiles", () => {
    renderView([]);
    expect(screen.getByTestId("market-flow-empty")).toHaveTextContent(
      "No sector data in the current filter.",
    );
    expect(document.querySelectorAll("g.mf-sector")).toHaveLength(0);
    expect(document.querySelectorAll(".mf-tile")).toHaveLength(0);
    expect(screen.getByTestId("market-flow-note")).toBeInTheDocument();
  });

  test("a single-member group still renders in both the ring and the heatmap", () => {
    renderView([row("S1", { sector: "Solo", change: 1, valueTraded: 1 })]);
    expect(document.querySelectorAll("g.mf-sector")).toHaveLength(1);
    expect(document.querySelectorAll(".mf-tile")).toHaveLength(1);
  });

  test("clicking a sector sets the shared selection without navigating or firing onSymbolClick", () => {
    const onSymbolClick = renderView(ROWS);
    const href = window.location.href;
    fireEvent.click(document.querySelector("g.mf-sector")!);
    expect(window.location.href).toBe(href);
    expect(onSymbolClick).not.toHaveBeenCalled();
    expect(screen.getByTestId("market-flow-selected")).toHaveTextContent("Selected: Alpha");
    expect(screen.getByTestId("market-flow-tile-0")).toHaveClass("mf-active");

    fireEvent.mouseEnter(document.querySelectorAll(".mf-tile")[1]!);
    expect(screen.getByTestId("market-flow-selected")).toHaveTextContent("Selected: Beta");
    expect(screen.getByTestId("market-flow-tile-1")).toHaveClass("mf-active");
    expect(screen.getByTestId("market-flow-tile-0")).not.toHaveClass("mf-active");
  });

  test("390 layout uses no overflow-x class and no horizontal scroll affordance", () => {
    renderView(ROWS);
    const offenders = Array.from(document.querySelectorAll<HTMLElement>("*")).filter((node) =>
      Array.from(node.classList).some((name) => name.includes("overflow-x")),
    );
    expect(offenders).toHaveLength(0);
    expect(screen.getByTestId("market-flow-layout")).toHaveClass("mf-layout", "min-w-0");
  });

  test("legend and honesty note never blend a 5m figure into the session number", () => {
    renderView([row("A1", { sector: "Alpha", change: 1, change5m: -4, valueTraded: 10 })]);
    const text = document.body.textContent ?? "";
    expect(text).toContain("loss ← change → gain");
    expect(text).toContain("rail width ∝ |signed turnover (proxy)| · arrow = direction");
    expect(text).toContain(
      "Signed turnover is Σ(value traded × sign(change)) — a directional proxy, not measured buy/sell flow.",
    );
    expect(text).not.toContain("blended");
    expect(text).not.toMatch(/net flow/i);
    expect(screen.getByTestId("market-flow-tile-change-0")).toHaveTextContent("+1.00%");
  });
});

const REAL_SECTORS = [
  "Finance",
  "Producer Manufacturing",
  "Technology Services",
  "Non-Energy Minerals",
  "Electronic Technology",
  "Consumer Durables",
  "Health Technology",
  "Utilities",
  "Miscellaneous",
  "Energy Minerals",
  "Process Industries",
  "Consumer Non-Durables",
  "Transportation",
  "Industrial Services",
  "Communications",
  "Retail Trade",
  "Consumer Services",
  "Distribution Services",
  "Health Services",
  "Commercial Services",
  "Unclassified",
];

/** Screenshot sectors converging over the top ~120° of the ring. */
const CROWDED_TOP = [
  "Semiconductors",
  "Consumer Durables",
  "Electronic Technology",
  "Health Technology",
  "Utilities",
  "Miscellaneous",
  "Process Industries",
];

const asSectors = (names: readonly string[]) =>
  names.map((sector, index) => ({ sector, turnover: 1000 - index * 7 }));

function firstOverlap(rects: readonly RingLabelRect[]): [RingLabelRect, RingLabelRect] | null {
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      if (rectsOverlap(rects[i]!, rects[j]!)) return [rects[i]!, rects[j]!];
    }
  }
  return null;
}

describe("MarketFlowView — ring label collision pass", () => {
  test("21 real sector names have zero pairwise label intersections at 440 and at a narrow view", () => {
    const counts: number[] = [];
    for (const width of [440, 320]) {
      const { placed, suppressed } = placeRingLabels(asSectors(REAL_SECTORS), width);
      expect(firstOverlap(placed.map((label) => label.rect))).toBeNull();
      expect(
        placed.every(
          (label) =>
            label.rect.x >= 0 &&
            label.rect.y >= 0 &&
            label.rect.x + label.rect.width <= 440 &&
            label.rect.y + label.rect.height <= 440,
        ),
      ).toBe(true);
      expect(placed.length + suppressed.length).toBe(REAL_SECTORS.length);
      expect(placed.length).toBeGreaterThan(0);
      counts.push(placed.length);
    }
    // A narrow view keeps fewer labels rather than stacking overlapping ones.
    expect(counts[1]!).toBeLessThanOrEqual(counts[0]!);
  });

  test("crowded top labels are suppressed, but their full names stay in the heatmap and on the arc", () => {
    // The seven names converge because they are neighbours in the *full*
    // 21-sector ring (≈17° apart), not because they are the only seven arcs.
    const { placed, suppressed } = placeRingLabels(asSectors(REAL_SECTORS), 440);
    const crowdedSuppressed = suppressed.filter((label) => CROWDED_TOP.includes(label.sector));
    expect(crowdedSuppressed.length).toBeGreaterThan(0);
    expect(placed.every((label) => !label.sector.includes("…"))).toBe(true);
    expect(suppressed.every((label) => !label.sector.includes("…"))).toBe(true);

    renderView(REAL_SECTORS.map((sector, index) =>
      row(`C${index}`, { sector, change: 1, valueTraded: 100 - index }),
    ));
    const tileNames = Array.from(
      document.querySelectorAll('[data-testid^="market-flow-tile-name-"]'),
    ).map((node) => node.textContent);
    for (const { sector } of suppressed) {
      expect(tileNames).toContain(sector);
      const arc = Array.from(document.querySelectorAll("g.mf-sector")).find(
        (node) => node.getAttribute("data-sector") === sector,
      );
      expect(arc).toBeDefined();
      expect(arc!.querySelector("title")!.textContent).toContain(sector);
      expect(arc!.querySelector("title")!.textContent).toContain("signed turnover (proxy)");
      expect(arc!.getAttribute("aria-label")).toContain(sector);
      expect(arc!.getAttribute("aria-label")).toContain("signed turnover (proxy)");
    }
    const renderedLabels = Array.from(
      document.querySelectorAll('[data-testid^="market-flow-label-"]'),
    ).map((node) => node.textContent ?? "");
    expect(renderedLabels.every((text) => !text.includes("…"))).toBe(true);
  });

  test("a name that cannot fit the viewBox is omitted, not clipped or ellipsised", () => {
    const sector = "Producer Manufacturing";
    const { placed, suppressed } = placeRingLabels([{ sector, turnover: 10 }], 440);
    expect(placed).toHaveLength(0);
    expect(suppressed).toEqual([{ sector }]);

    renderView([row("P1", { sector, change: 1, valueTraded: 10 })]);
    expect(document.querySelectorAll("text.mf-lbl")).toHaveLength(0);
    expect(screen.getByTestId("market-flow-tile-name-0")).toHaveTextContent(sector);
    const arc = document.querySelector("g.mf-sector")!;
    expect(arc.querySelector("title")!.textContent).toContain(sector);
    expect(arc.getAttribute("aria-label")).toContain(sector);
  });
});

describe("MarketFlowView — visible proxy qualifier (PIXEL P1-02)", () => {
  test("an outflow tile puts proxy next to the signed number and never says net flow", () => {
    // Positive median change but negative Σ(turnover × sign(change)).
    renderView([
      row("M1", { sector: "Mix", change: 2, valueTraded: 100 }),
      row("M2", { sector: "Mix", change: -0.01, valueTraded: 900 }),
    ]);
    const signed = screen.getByTestId("market-flow-tile-signed-0");
    const text = signed.textContent ?? "";
    expect(text).toContain("outflow");
    expect(text).toContain("proxy");
    expect(text).toContain(formatAmount(-800, "INR", true));
    expect(text).not.toMatch(/net flow/i);
    expect(document.body.textContent ?? "").not.toMatch(/net flow/i);
  });

  test("the always-visible legends name signed turnover as a proxy", () => {
    renderView(ROWS);
    expect(screen.getByTestId("market-flow-heat-sub")).toHaveTextContent(
      "signed turnover (proxy)",
    );
    expect(screen.getByTestId("market-flow-legend-encodings")).toHaveTextContent(
      "signed turnover (proxy)",
    );
  });

  test("narrow tiles keep the short (proxy) form with no truncation or overflow", () => {
    renderView(ROWS);
    const tiles = Array.from(document.querySelectorAll<HTMLElement>(".mf-tile"));
    expect(tiles.length).toBeGreaterThan(0);
    for (const tile of tiles) {
      expect(tile).toHaveClass("mf-tile-narrow");
      const signed = tile.querySelector<HTMLElement>(
        '[data-testid^="market-flow-tile-signed-"]',
      );
      expect(signed).not.toBeNull();
      expect(signed!.textContent).toContain("(proxy)");
      expect(signed!.textContent).not.toContain("…");
      expect(
        Array.from(signed!.classList).some((name) => /overflow-x|truncate/.test(name)),
      ).toBe(false);
    }
  });
});

describe("MarketFlowView — narrow header hint (PIXEL F-01)", () => {
  test("the hover helper hides below 900px with its wording retained; count and cue stay unshrinkable", () => {
    renderView(ROWS);
    const helper = screen.getByTestId("market-flow-selected");
    expect(helper).toHaveTextContent("Hover or focus a sector");
    expect(helper).toHaveClass("hidden", "min-[900px]:inline");
    expect(helper).toHaveAttribute("title", "Hover or focus a sector");
    expect(helper).toHaveAttribute("aria-label", "Hover or focus a sector");

    const count = screen.getByTestId("market-flow-count");
    expect(count).toHaveClass("shrink-0");
    expect(count.textContent).toContain("5 sectors · 9 stocks · ↓ scroll");
    expect(screen.getByText("Money flow")).toHaveClass("shrink-0");
    expect(screen.getByTestId("market-flow-css").textContent).toContain(
      "@media (min-width: 900px)",
    );
  });

  test("the empty header still keeps the count and scroll cue", () => {
    renderView([]);
    expect(screen.getByTestId("market-flow-count")).toHaveTextContent(
      "0 sectors · 0 stocks · ↓ scroll",
    );
    expect(screen.getByTestId("market-flow-selected")).toHaveClass(
      "hidden",
      "min-[900px]:inline",
    );
  });

  test("selection wording moves onto the helper's title and aria-label at narrow widths", () => {
    renderView(ROWS);
    fireEvent.click(document.querySelector("g.mf-sector")!);
    const helper = screen.getByTestId("market-flow-selected");
    expect(helper).toHaveTextContent("Selected: Alpha");
    expect(helper).toHaveAttribute("title", "Selected: Alpha");
    expect(helper).toHaveAttribute("aria-label", "Selected: Alpha");
  });
});
