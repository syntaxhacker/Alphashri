// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { SCALE_GRAY, SURFACE } from "@/ui/palette";
import { compositeOver, contrastRatio } from "@/utils/contrast";
import {
  CHART_CURRENT,
  CHART_NEGATIVE,
  CHART_POSITIVE,
  rankColor,
  returnColor,
  shareColor,
} from "./chartPalette";
import type {
  SectorHistorySeasonality,
  SectorHistorySeries,
} from "../../../../types/sectorHistory";
import { MiniSparkline } from "./MiniSparkline";
import { PersistenceMatrix } from "./PersistenceMatrix";
import { SeasonalityHeatmap } from "./SeasonalityHeatmap";
import { SectorRankHeatmap } from "./SectorRankHeatmap";

const MONTHS = [
  "2025-01",
  "2025-02",
  "2025-03",
  "2025-04",
  "2025-05",
  "2025-06",
  "2025-07",
  "2025-08",
  "2025-09",
  "2025-10",
  "2025-11",
  "2025-12",
];

const IT_RANKS: (number | null)[] = [1, 2, 3, null, 2, 1, 4, 3, 2, null, 1, 2];
const PSU_RANKS: (number | null)[] = [2, 1, 2, 3, 1, 2, 3, 1, 3, 2, 2, 1];
const FMCG_RANKS: (number | null)[] = [3, 3, 1, 2, 3, 4, 1, 2, 4, 3, 3, 3];

const SERIES: SectorHistorySeries[] = [
  {
    name: "NIFTY 50",
    is_benchmark: true,
    monthly_returns: MONTHS.map(() => 0.5),
    ranks: MONTHS.map(() => null),
  },
  {
    name: "NIFTY IT",
    is_benchmark: false,
    monthly_returns: MONTHS.map(() => 1),
    ranks: IT_RANKS,
  },
  {
    name: "PSU BANK",
    is_benchmark: false,
    monthly_returns: MONTHS.map(() => 1),
    ranks: PSU_RANKS,
  },
  {
    name: "FMCG",
    is_benchmark: false,
    monthly_returns: MONTHS.map(() => 1),
    ranks: FMCG_RANKS,
  },
];

const TOP3_COUNT = [IT_RANKS, PSU_RANKS, FMCG_RANKS]
  .flat()
  .filter((rank): rank is number => rank !== null && rank <= 3).length;

const SEASONALITY: SectorHistorySeasonality[] = [
  { name: "NIFTY IT", month: 1, avg_return: 2.1, hit_rate: 0.6, n: 5 },
  { name: "NIFTY IT", month: 2, avg_return: -1.4, hit_rate: 0.4, n: 5 },
  { name: "PSU BANK", month: 1, avg_return: 0.8, hit_rate: 0.8, n: 3 },
  { name: "PSU BANK", month: 2, avg_return: 0, hit_rate: 0.5, n: 3 },
];

const PERSISTENCE_NAMES = ["NIFTY IT", "PSU BANK", "FMCG"];
const PERSISTENCE_MATRIX: (number | null)[][] = [
  [0.5, 0.2, 0.05],
  [0.15, 0.45, 0.1],
  [0.05, 0.1, 0.4],
];

function expectAccessibleLabels(svg: Element) {
  const labelledBy = svg.getAttribute("aria-labelledby");
  expect(labelledBy).toBeTruthy();
  const ids = (labelledBy ?? "").split(" ").filter(Boolean);
  expect(ids).toHaveLength(2);
  for (const id of ids) expect(svg.querySelector(`#${id}`)).not.toBeNull();
}

function expectRovingCells(svg: Element, selector: string, count: number) {
  const cells = Array.from(svg.querySelectorAll(selector));
  expect(cells).toHaveLength(count);
  expect(cells.filter((cell) => cell.getAttribute("tabindex") === "0")).toHaveLength(1);
  for (const cell of cells) {
    expect(cell).toHaveAttribute("role", "img");
    expect(cell.getAttribute("aria-label")).toBeTruthy();
    expect(["0", "-1"]).toContain(cell.getAttribute("tabindex"));
  }
}

function expectContrast(cell: Element) {
  const rawOpacity = cell.getAttribute("fill-opacity");
  const opacity = rawOpacity === null ? 1 : Number(rawOpacity);
  const bg = compositeOver(String(cell.getAttribute("fill")), SURFACE, opacity);
  const ink = String(cell.getAttribute("data-ink"));
  const ratio = contrastRatio(ink, bg);
  expect(
    ratio,
    `${ink} on ${bg} (opacity ${opacity}) = ${ratio.toFixed(2)}:1`,
  ).toBeGreaterThanOrEqual(4.5);
}

afterEach(() => {
  cleanup();
});

function withCompactViewport(run: () => void) {
  vi.stubGlobal("matchMedia", ((query: string) => ({
    matches: /max-width:\s*640px/.test(query),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia);
  try {
    run();
  } finally {
    vi.unstubAllGlobals();
  }
}

describe("SectorRankHeatmap axis, width and top-3 emphasis", () => {
  test("labels the axis by year and quarter and keeps the legend compact", () => {
    render(() => <SectorRankHeatmap months={MONTHS} series={SERIES} />);
    const svg = screen.getByTestId("history-rank-heatmap");
    expect(screen.getByText("2025")).toBeInTheDocument();
    for (const month of ["Jan", "Apr", "Jul", "Oct"]) {
      expect(screen.getByText(month)).toBeInTheDocument();
    }
    expect(screen.queryByText("Feb")).not.toBeInTheDocument();
    expect(screen.getByTestId("history-rank-heatmap-legend")).toHaveTextContent("1 best → 3 worst");
    expect(screen.getByTestId("history-rank-top3-legend")).toHaveTextContent("top 3");
    expect(screen.getByTestId("history-rank-current-legend")).toHaveTextContent(
      "dashed = current month",
    );
    expect(screen.getByTestId("history-rank-current-legend")).toHaveStyle({
      color: CHART_CURRENT,
    });
    expect(screen.getByTestId("history-rank-latest-key")).toHaveStyle({ color: CHART_CURRENT });
    expect(svg.querySelector("[data-top3-outline]")).toHaveAttribute("stroke", SCALE_GRAY[0]);
    expect(
      Number(svg.querySelector("[data-top3-outline]")?.getAttribute("stroke-width")),
    ).toBeGreaterThanOrEqual(1.5);
    expect(svg.querySelector("[data-latest-column]")).toHaveAttribute("stroke", CHART_CURRENT);
    const legend = screen.getByTestId("history-rank-legend");
    expect(legend.style.position).not.toBe("sticky");
    expect(legend.style.maxWidth).toBe("");
    expect(svg.querySelector('[data-testid="history-rank-heatmap-legend"]')).toBeNull();
    expect(svg.querySelector("title")?.textContent).toMatch(/light outlines mark the top 3/i);
    expect(svg.querySelector("desc")?.textContent).toMatch(/labelled at each quarter/i);
    expectAccessibleLabels(svg);
  });

  test("outlines every rank 1-3 cell and leaves rank 4 plain", () => {
    render(() => <SectorRankHeatmap months={MONTHS} series={SERIES} />);
    const svg = screen.getByTestId("history-rank-heatmap");
    expect(svg.querySelectorAll('[data-top3="true"]')).toHaveLength(TOP3_COUNT);
    expect(svg.querySelectorAll("[data-top3-outline]")).toHaveLength(TOP3_COUNT);
    expect(svg.querySelector('[data-cell="rank-0-0"]')).toHaveAttribute("data-top3", "true");
    expect(svg.querySelector('[data-cell="rank-2-5"]')).toHaveAttribute("data-top3", "false");
    expect(svg.querySelector('[data-cell="rank-2-5"]')).toHaveAttribute("fill", rankColor(4, 3));
    expect(svg.querySelector('[data-cell="rank-0-0"]')).toHaveAttribute("fill", rankColor(1, 3));
  });

  test("fits 60 months inside a 1600px panel without truncating sector names", () => {
    const months = Array.from({ length: 60 }, (_, index) => {
      const year = 2021 + Math.floor(index / 12);
      return `${year}-${String((index % 12) + 1).padStart(2, "0")}`;
    });
    const series: SectorHistorySeries[] = [
      {
        name: "NIFTY CONSUMPTION",
        is_benchmark: false,
        monthly_returns: [],
        ranks: months.map((_, index) => ((index + 2) % 10) + 1),
      },
      {
        name: "NIFTY FIN_SERVICE",
        is_benchmark: false,
        monthly_returns: [],
        ranks: months.map((_, index) => ((index + 1) % 10) + 1),
      },
    ];
    render(() => <SectorRankHeatmap months={months} series={series} />);
    const svg = screen.getByTestId("history-rank-heatmap");
    // 60 cells at 20px, the full-name rail and a 6px right gutter stay under the 1404px panel body.
    expect(svg).toHaveAttribute("viewBox", "0 0 1346 78");
    expect(svg.style.minWidth).toBe("1346px");
    expect(svg.style.maxWidth).toBe("1346px");
    expect(1346).toBeLessThanOrEqual(1404);
    expect(screen.getAllByText("NIFTY CONSUMPTION").length).toBeGreaterThan(0);
    expect(screen.getAllByText("NIFTY FIN_SERVICE").length).toBeGreaterThan(0);
    expect(svg.textContent).not.toContain("…");
    expect(screen.getAllByText("Jan")).toHaveLength(5);
    expect(screen.getAllByText("2021")).toHaveLength(1);
  });

  test("decodes the right edge with the latest-month #1-#3 key", () => {
    const months = Array.from({ length: 36 }, (_, index) => {
      const year = 2023 + Math.floor(index / 12);
      return `${year}-${String((index % 12) + 1).padStart(2, "0")}`;
    });
    const ranks = (pick: (index: number) => number) => months.map((_, index) => pick(index));
    render(() => (
      <SectorRankHeatmap
        months={months}
        series={[
          { name: "NIFTY IT", is_benchmark: false, monthly_returns: [], ranks: ranks(() => 2) },
          { name: "PSU BANK", is_benchmark: false, monthly_returns: [], ranks: ranks(() => 1) },
          {
            name: "NIFTY CONSUMPTION",
            is_benchmark: false,
            monthly_returns: [],
            ranks: ranks(() => 3),
          },
        ]}
      />
    ));
    const key = screen.getByTestId("history-rank-latest-key");
    expect(key.tagName).toBe("DIV");
    expect(screen.getByTestId("history-rank-heatmap").contains(key)).toBe(false);
    expect(key).toHaveTextContent(
      "Current Dec 2025: #1 PSU BANK · #2 NIFTY IT · #3 NIFTY CONSUMPTION",
    );
    expect(
      screen.getByTestId("history-rank-heatmap").querySelector("[data-latest-column]"),
    ).not.toBeNull();
    expect(screen.getByTestId("history-rank-heatmap")).toHaveAttribute("viewBox", "0 0 1370 100");
    expect(screen.getByTestId("history-rank-heatmap").style.maxWidth).toBe("1370px");
    expect(screen.getByTestId("history-rank-row-rail")).toHaveTextContent("NIFTY CONSUMPTION");
    expect(screen.getByTestId("history-rank-row-rail").style.position).toBe("sticky");
    expect(screen.getByTestId("history-rank-row-rail").style.left).toBe("0px");
  });

  test("sizes 3Y cells at 34px so the desktop card is not half empty", () => {
    const months = Array.from({ length: 36 }, (_, index) => {
      const year = 2023 + Math.floor(index / 12);
      return `${year}-${String((index % 12) + 1).padStart(2, "0")}`;
    });
    const series = Array.from({ length: 10 }, (_, index) => ({
      name: `SECTOR ${index + 1}`,
      is_benchmark: false,
      monthly_returns: [],
      ranks: months.map((_, month) => ((index + month) % 10) + 1),
    }));
    render(() => <SectorRankHeatmap months={months} series={series} />);
    const svg = screen.getByTestId("history-rank-heatmap");
    expect(svg).toHaveAttribute("viewBox", "0 0 1370 254");
    expect(svg.style.maxWidth).toBe("1370px");
    expect(svg.style.minWidth).toBe("1370px");
    // 36 cells at 34px + 140px label rail + 6px right gutter = 1370.
    expect(140 + 36 * 34 + 6).toBe(1370);
    expect(svg.querySelector('[data-cell="rank-0-0"]')?.getAttribute("width")).toBe("34");
    // 10 rows: 34 header + 10 * 22 = 254 viewBox units, 1:1 at 1370px.
    expect(10 * 22 + 34).toBe(254);
    const layout = screen.getByTestId("history-rank-layout");
    expect(layout).toHaveClass("flex", "flex-wrap");
    const chart = screen.getByTestId("history-rank-chart");
    expect(chart.style.width).toBe("1370px");
    expect(chart.style.flex).toBe("0 0 auto");
    const aside = screen.getByTestId("history-rank-aside");
    expect(aside.style.flex).toBe("1 1 100%");
    expect(aside.style.minWidth).toBe("200px");
    expect(within(aside).getByTestId("history-rank-latest-key")).toBeInTheDocument();
    expect(within(aside).getByTestId("history-rank-heatmap-legend")).toHaveTextContent(
      "1 best → 10 worst",
    );
  });

  test("uses 20px 3Y cells at compact viewports", () => {
    withCompactViewport(() => {
      const months = Array.from({ length: 36 }, (_, index) => {
        const year = 2023 + Math.floor(index / 12);
        return `${year}-${String((index % 12) + 1).padStart(2, "0")}`;
      });
      const series = Array.from({ length: 10 }, (_, index) => ({
        name: `SECTOR ${index + 1}`,
        is_benchmark: false,
        monthly_returns: [],
        ranks: months.map((_, month) => ((index + month) % 10) + 1),
      }));
      render(() => <SectorRankHeatmap months={months} series={series} />);
      const svg = screen.getByTestId("history-rank-heatmap");
      expect(svg).toHaveAttribute("viewBox", "0 0 866 254");
      expect(svg.querySelector('[data-cell="rank-0-0"]')?.getAttribute("width")).toBe("20");
    });
  });

  test("abbreviates the compact sticky rail but keeps full identity in title/aria", () => {
    withCompactViewport(() => {
      const months = Array.from({ length: 60 }, (_, index) => {
        const year = 2021 + Math.floor(index / 12);
        return `${year}-${String((index % 12) + 1).padStart(2, "0")}`;
      });
      const names = ["US Consumer Discretionary", "US Consumer Staples", "US Technology"];
      const series = names.map((name, index) => ({
        name,
        is_benchmark: false,
        monthly_returns: [],
        ranks: months.map((_, month) => ((month + index) % 3) + 1),
      }));
      render(() => <SectorRankHeatmap months={months} series={series} />);
      const rail = screen.getByTestId("history-rank-row-rail");
      const railWidth = Number.parseFloat(rail.style.width);
      expect(railWidth).toBeGreaterThanOrEqual(140);
      expect(railWidth).toBeLessThanOrEqual(150);
      expect(rail).toHaveTextContent("US Cons. Disc.");
      expect(rail).toHaveTextContent("US Cons. Staples");
      expect(rail).not.toHaveTextContent("US Consumer Discretionary");
      expect(rail.querySelector('[title="US Consumer Discretionary"]')).not.toBeNull();
      const svg = screen.getByTestId("history-rank-heatmap");
      expect(svg.textContent).toContain("US Consumer Discretionary");
      expect(svg.querySelector('[data-cell="rank-0-0"]')?.getAttribute("aria-label")).toContain(
        "US Consumer Discretionary",
      );
    });
  });

  test("makes every rank cell keyboard-focusable with a month, sector and rank label", () => {
    render(() => <SectorRankHeatmap months={MONTHS} series={SERIES} />);
    const svg = screen.getByTestId("history-rank-heatmap");
    expectRovingCells(svg, "[data-cell]", MONTHS.length * 3);
    expect(svg.querySelector('[data-cell="rank-0-0"]')?.getAttribute("aria-label")).toBe(
      "2025-01 · NIFTY IT · rank 1",
    );
  });

  test("moves the rank tab stop to the newest column when the lookback grows", async () => {
    const longMonths = Array.from({ length: 24 }, (_, index) => {
      const year = 2024 + Math.floor(index / 12);
      return `${year}-${String((index % 12) + 1).padStart(2, "0")}`;
    });
    const longRanks = longMonths.map((_, index) => (index % 3) + 1);
    const [months, setMonths] = createSignal(MONTHS);
    render(() => (
      <SectorRankHeatmap
        months={months()}
        series={[
          {
            name: "NIFTY IT",
            is_benchmark: false,
            monthly_returns: [],
            ranks: longRanks,
          },
        ]}
      />
    ));
    const svg = screen.getByTestId("history-rank-heatmap");
    expect(svg.querySelector('[data-cell="rank-0-11"]')).toHaveAttribute("tabindex", "0");

    setMonths(longMonths);
    await waitFor(() =>
      expect(svg.querySelector('[data-cell="rank-0-23"]')).toHaveAttribute("tabindex", "0"),
    );
    expect(svg.querySelector('[data-cell="rank-0-11"]')).toHaveAttribute("tabindex", "-1");
  });

  test("uses one rank tab stop and moves it with arrow keys", () => {
    render(() => <SectorRankHeatmap months={MONTHS} series={SERIES} />);
    const svg = screen.getByTestId("history-rank-heatmap");
    const last = MONTHS.length - 1;
    const latest = svg.querySelector(`[data-cell="rank-0-${last}"]`) as Element;
    const left = svg.querySelector(`[data-cell="rank-0-${last - 1}"]`) as Element;
    const current = svg.querySelector(`[data-cell="rank-1-${last - 1}"]`) as Element;
    expect(latest).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(latest, { key: "ArrowLeft" });
    expect(left).toHaveAttribute("tabindex", "0");
    expect(latest).toHaveAttribute("tabindex", "-1");
    expect(document.activeElement).toBe(left);

    fireEvent.keyDown(left, { key: "ArrowDown" });
    expect(current).toHaveAttribute("tabindex", "0");
    expect(left).toHaveAttribute("tabindex", "-1");
    expect(document.activeElement).toBe(current);

    fireEvent.keyDown(current, { key: "Enter" });
    expect(current).toHaveAttribute("tabindex", "0");
    expect(document.activeElement).toBe(current);
  });
});

describe("SeasonalityHeatmap legend and hit-rate cue", () => {
  test("encodes hit rate as a legible bottom bar without replacing the return text", () => {
    render(() => <SeasonalityHeatmap cells={SEASONALITY} names={["NIFTY IT", "PSU BANK"]} />);
    const svg = screen.getByTestId("history-seasonality");
    const high = svg.querySelector('[data-hit-bar="seasonality-0-0"]');
    const low = svg.querySelector('[data-hit-bar="seasonality-0-1"]');
    const highTrack = svg.querySelector('[data-hit-track="seasonality-0-0"]');
    expect(high).toHaveAttribute("data-hit-pct", "60");
    expect(low).toHaveAttribute("data-hit-pct", "40");
    expect(Number(high?.getAttribute("width"))).toBeCloseTo(20.4, 5);
    expect(Number(low?.getAttribute("width"))).toBeCloseTo(13.6, 5);
    expect(high).toHaveAttribute("height", "4");
    expect(high).toHaveAttribute("fill-opacity", "1");
    expect(highTrack).toHaveAttribute("height", "4");
    expect(Number(highTrack?.getAttribute("fill-opacity"))).toBeLessThan(1);
    const cellFill = svg.querySelector('[data-cell="seasonality-0-0"]')?.getAttribute("fill") ?? "";
    expect(contrastRatio(high?.getAttribute("fill") ?? "", cellFill)).toBeGreaterThanOrEqual(3);
    expect(screen.getByTestId("history-seasonality-hit-swatch")).toHaveClass("h-1");
    expect(screen.getByText("+2.1%")).toBeInTheDocument();
    expect(screen.getByText("-1.4%")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Jan · NIFTY IT · avg +2.1% · hit rate 60% · n=5"),
    ).toBeInTheDocument();
  });

  test("names the return scale, hit-rate bar and honest sample size", () => {
    render(() => <SeasonalityHeatmap cells={SEASONALITY} names={["NIFTY IT", "PSU BANK"]} />);
    expect(screen.getByText("avg return")).toBeInTheDocument();
    expect(screen.getByText("bar = up-month hit rate")).toBeInTheDocument();
    const note = screen.getByTestId("history-seasonality-note");
    expect(note).toHaveTextContent("n=3–5 per month");
    expect(note).toHaveTextContent("history, not a forecast");
    expect(screen.queryByText(/forecast return/i)).not.toBeInTheDocument();
  });

  test("keeps the hit-rate legend above the labelled horizontal scrollport", async () => {
    render(() => <SeasonalityHeatmap cells={SEASONALITY} names={["NIFTY IT", "PSU BANK"]} />);
    const legend = screen.getByTestId("history-seasonality-legend");
    const scroll = screen.getByTestId("history-seasonality-scroll");
    const svg = screen.getByTestId("history-seasonality");
    expect(scroll).toHaveAttribute("role", "region");
    expect(scroll).toHaveAttribute("tabindex", "0");
    expect(scroll.getAttribute("aria-label")).toMatch(/Seasonality heatmap/);
    expect(legend).toHaveTextContent("bar = up-month hit rate");
    expect(legend).toHaveTextContent("hover for hit rate and n");
    expect(legend).toHaveTextContent("avg return");
    expect(legend).toHaveTextContent("negativeflatpositive");
    const note = screen.getByTestId("history-seasonality-note");
    expect(note).toHaveTextContent("n=3–5 per month");
    expect(note).toHaveTextContent("history, not a forecast");
    expect(scroll.contains(legend)).toBe(false);
    expect(scroll.contains(note)).toBe(false);
    expect(svg.textContent).not.toContain("avg monthly return");
    expect(svg.textContent).not.toContain("n=3–5 per month · history, not a forecast");
    expect(svg.querySelector('[data-testid="history-seasonality-note"]')).toBeNull();
    expect(legend.compareDocumentPosition(scroll) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const hint = screen.getByTestId("history-seasonality-scroll-hint");
    expect(scroll).not.toContainElement(hint);
    Object.defineProperty(scroll, "scrollWidth", { configurable: true, value: 1000 });
    Object.defineProperty(scroll, "clientWidth", { configurable: true, value: 400 });
    fireEvent.scroll(scroll);
    await waitFor(() => expect(hint).toHaveClass("flex"));
    expect(hint).toHaveTextContent("Scroll →");
    scroll.scrollLeft = 600;
    fireEvent.scroll(scroll);
    await waitFor(() => expect(hint).toHaveTextContent("Scroll ←"));
  });

  test("scrolls horizontally instead of shrinking cell text below legibility", () => {
    render(() => <SeasonalityHeatmap cells={SEASONALITY} names={["NIFTY IT", "PSU BANK"]} />);
    const scroll = screen.getByTestId("history-seasonality-scroll");
    const svg = screen.getByTestId("history-seasonality");
    expect(scroll.style.overflowX).toBe("auto");
    expect(svg).toHaveAttribute("viewBox", "0 0 646 78");
    expect(svg.style.minWidth).toBe("646px");
    expect(svg.style.maxWidth).toBe("646px");
    expectAccessibleLabels(svg);
    expectRovingCells(svg, "[data-cell]", 24);
    expect(svg.querySelector('[data-cell="seasonality-0-0"]')?.getAttribute("aria-label")).toBe(
      "Jan · NIFTY IT · avg +2.1% · hit rate 60% · n=5",
    );
  });

  test("fits all twelve months with US-length sector names at 1600", () => {
    // 1600 - 148 nav - 16 overview padding - 8 column gap - 16 panel padding = 1412 / 2 ≈ 698.
    const PANEL_BODY_AT_1600 = 698;
    const names = ["Communication Services", "Consumer Discretionary", "Information Technology"];
    const cells: SectorHistorySeasonality[] = names.flatMap((name) =>
      Array.from({ length: 12 }, (_, index) => ({
        name,
        month: index + 1,
        avg_return: index % 2 === 0 ? 1.8 : -1.2,
        hit_rate: 0.6,
        n: 5,
      })),
    );
    render(() => <SeasonalityHeatmap cells={cells} names={names} />);
    const svg = screen.getByTestId("history-seasonality");
    const width = Number(svg.getAttribute("viewBox")?.split(" ")[2]);
    expect(width).toBeLessThanOrEqual(PANEL_BODY_AT_1600);
    const dec = within(svg).getByText("Dec");
    const decX = Number(dec.getAttribute("x"));
    expect(decX + 18).toBeLessThanOrEqual(width);
    expect(screen.getByTestId("history-seasonality-scroll").style.overflowX).toBe("auto");
  });

  test("keeps full sector names in the label rail", () => {
    const cells: SectorHistorySeasonality[] = [
      { name: "NIFTY CONSUMPTION", month: 1, avg_return: 1.2, hit_rate: 0.6, n: 5 },
      { name: "NIFTY FIN_SERVICE", month: 2, avg_return: -0.8, hit_rate: 0.4, n: 5 },
    ];
    render(() => (
      <SeasonalityHeatmap cells={cells} names={["NIFTY CONSUMPTION", "NIFTY FIN_SERVICE"]} />
    ));
    const svg = screen.getByTestId("history-seasonality");
    expect(within(svg).getAllByText("NIFTY CONSUMPTION").length).toBeGreaterThan(0);
    expect(within(svg).getAllByText("NIFTY FIN_SERVICE").length).toBeGreaterThan(0);
    expect(svg.textContent).not.toContain("…");
    expect(screen.getByTestId("history-seasonality-row-rail")).toHaveTextContent(
      "NIFTY CONSUMPTION",
    );
    expect(screen.getByTestId("history-seasonality-row-rail").style.position).toBe("sticky");
  });

  test("keeps the strongest seasonal washes at AA contrast", () => {
    const cells: SectorHistorySeasonality[] = [
      { name: "NIFTY IT", month: 1, avg_return: 10, hit_rate: 0.8, n: 5 },
      { name: "PSU BANK", month: 1, avg_return: -10, hit_rate: 0.2, n: 5 },
    ];
    render(() => <SeasonalityHeatmap cells={cells} names={["NIFTY IT", "PSU BANK"]} />);
    const svg = screen.getByTestId("history-seasonality");
    const positive = svg.querySelector('[data-cell="seasonality-0-0"]') as Element;
    const negative = svg.querySelector('[data-cell="seasonality-1-0"]') as Element;
    expectContrast(positive);
    expectContrast(negative);
    expect(positive).toHaveAttribute("fill", returnColor(10, 10));
    expect(negative).toHaveAttribute("fill", returnColor(-10, 10));
  });

  test("uses one seasonality tab stop and moves it with arrow keys", () => {
    render(() => <SeasonalityHeatmap cells={SEASONALITY} names={["NIFTY IT", "PSU BANK"]} />);
    const svg = screen.getByTestId("history-seasonality");
    const first = svg.querySelector('[data-cell="seasonality-0-0"]') as Element;
    const down = svg.querySelector('[data-cell="seasonality-1-0"]') as Element;
    expect(first).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(down).toHaveAttribute("tabindex", "0");
    expect(first).toHaveAttribute("tabindex", "-1");
    expect(document.activeElement).toBe(down);
    fireEvent.keyDown(down, { key: " " });
    expect(down).toHaveAttribute("tabindex", "0");
    expect(document.activeElement).toBe(down);
  });
});

describe("PersistenceMatrix axes, contrast and top-3 context", () => {
  test("names both axes and outlines the top-3 transition region", () => {
    const matrix: (number | null)[][] = [
      [0.5, 0.2, 0.05, 0.05],
      [0.15, 0.45, 0.1, 0.05],
      [0.05, 0.1, 0.4, 0.1],
      [0.1, 0.1, 0.1, 0.2],
    ];
    render(() => <PersistenceMatrix names={PERSISTENCE_NAMES} matrix={matrix} />);
    const svg = screen.getByTestId("history-persistence");
    expect(screen.getByText("rows: this month rank ↓")).toBeInTheDocument();
    expect(screen.getByText("columns: next month rank →")).toBeInTheDocument();
    expect(svg.querySelector('[data-top3-zone="true"]')).not.toBeNull();
    expect(svg.querySelector('[data-cell="persistence-0-0"]')).toHaveAttribute("data-top3", "true");
    expect(svg.querySelector('[data-cell="persistence-2-2"]')).toHaveAttribute("data-top3", "true");
    expect(screen.getByTestId("history-persistence-stickiness")).toHaveTextContent(
      "top-3 stickiness 91%",
    );
    expect(screen.getByText("dashed box = rows #1–#3 → cols #1–#3")).toBeInTheDocument();
  });

  test("keeps exact transition values in tooltips and labels the large cells", () => {
    render(() => <PersistenceMatrix names={PERSISTENCE_NAMES} matrix={PERSISTENCE_MATRIX} />);
    expect(screen.getByLabelText("#1 → #1 · 50%")).toBeInTheDocument();
    expect(screen.getByLabelText("#2 → #3 · 10%")).toBeInTheDocument();
    expect(screen.getAllByText("10%")).toHaveLength(2);
    expect(screen.queryByText("5%")).not.toBeInTheDocument();
    expect(screen.getByText("cell value = share of transitions")).toBeInTheDocument();
    expect(screen.getByText("diagonal = stayed · labels ≥10%")).toBeInTheDocument();
  });

  test("keeps ink at AA contrast across the whole amber wash", () => {
    render(() => <PersistenceMatrix names={PERSISTENCE_NAMES} matrix={PERSISTENCE_MATRIX} />);
    const svg = screen.getByTestId("history-persistence");
    const cells = Array.from(svg.querySelectorAll("[data-cell][data-ink]"));
    expect(cells.length).toBe(9);
    for (const cell of cells) {
      const rawOpacity = cell.getAttribute("fill-opacity");
      const opacity = rawOpacity === null ? 1 : Number(rawOpacity);
      const bg = compositeOver(String(cell.getAttribute("fill")), SURFACE, opacity);
      const ink = String(cell.getAttribute("data-ink"));
      const ratio = contrastRatio(ink, bg);
      expect(
        ratio,
        `${ink} on ${bg} (opacity ${opacity}) = ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
    }
    expect(svg.querySelector('[data-cell="persistence-0-0"]')).toHaveAttribute(
      "fill",
      shareColor(50, 50),
    );
  });

  test("renders an optional monthly transition denominator and hides it when absent", () => {
    const { unmount } = render(() => (
      <PersistenceMatrix
        names={PERSISTENCE_NAMES}
        matrix={PERSISTENCE_MATRIX}
        transitionCount={590}
      />
    ));
    const svg = screen.getByTestId("history-persistence");
    expect(screen.getByTestId("history-persistence-count")).toHaveTextContent(
      "n=590 monthly transitions",
    );
    expect(svg).toHaveAttribute("viewBox", "0 0 222 202");
    unmount();

    render(() => <PersistenceMatrix names={PERSISTENCE_NAMES} matrix={PERSISTENCE_MATRIX} />);
    expect(screen.queryByTestId("history-persistence-count")).not.toBeInTheDocument();
    expect(screen.getByTestId("history-persistence")).toHaveAttribute("viewBox", "0 0 222 188");
  });

  test("makes every transition cell keyboard-focusable", () => {
    render(() => <PersistenceMatrix names={PERSISTENCE_NAMES} matrix={PERSISTENCE_MATRIX} />);
    const svg = screen.getByTestId("history-persistence");
    expectRovingCells(svg, "[data-cell]", 9);
    expect(svg.querySelector('[data-cell="persistence-0-0"]')?.getAttribute("aria-label")).toBe(
      "#1 → #1 · 50%",
    );
  });

  test("uses one persistence tab stop and moves it with arrow keys", () => {
    render(() => <PersistenceMatrix names={PERSISTENCE_NAMES} matrix={PERSISTENCE_MATRIX} />);
    const svg = screen.getByTestId("history-persistence");
    const first = svg.querySelector('[data-cell="persistence-0-0"]') as Element;
    const next = svg.querySelector('[data-cell="persistence-1-0"]') as Element;
    expect(first).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(next).toHaveAttribute("tabindex", "0");
    expect(first).toHaveAttribute("tabindex", "-1");
    expect(document.activeElement).toBe(next);
    fireEvent.keyDown(next, { key: "ArrowRight" });
    expect(svg.querySelector('[data-cell="persistence-1-1"]')).toHaveAttribute("tabindex", "0");
    expect(document.activeElement).toBe(svg.querySelector('[data-cell="persistence-1-1"]'));
  });

  test("keeps row identity in a sticky rail when scrolled to the last ranks", () => {
    const matrix = Array.from({ length: 10 }, (_, row) =>
      Array.from({ length: 10 }, (_, col) => (row === col ? 10 : null)),
    );
    render(() => <PersistenceMatrix names={[]} matrix={matrix} />);
    const rail = screen.getByTestId("history-persistence-row-rail");
    expect(rail.style.position).toBe("sticky");
    expect(rail.style.left).toBe("0px");
    expect(rail.textContent).toBe(
      Array.from({ length: 10 }, (_, index) => `#${index + 1}`).join(""),
    );
    expect(rail.querySelectorAll("div")).toHaveLength(10);
    expect(screen.getByTestId("history-persistence").style.maxWidth).toBe("558px");
  });

  test("keeps a 10-rank matrix legible in a labelled horizontal scroll wrapper", async () => {
    const matrix = Array.from({ length: 10 }, (_, row) =>
      Array.from({ length: 10 }, (_, col) => (row === col ? 10 : null)),
    );
    render(() => <PersistenceMatrix names={[]} matrix={matrix} />);
    const scroll = screen.getByTestId("history-persistence-scroll");
    const svg = screen.getByTestId("history-persistence");
    expect(scroll.style.overflowX).toBe("auto");
    expect(scroll).toHaveAttribute("role", "region");
    expect(scroll).toHaveAttribute("tabindex", "0");
    expect(scroll.getAttribute("aria-label")).toMatch(/Rank persistence matrix/);
    expect(svg).toHaveAttribute("viewBox", "0 0 558 356");
    expect(svg.style.minWidth).toBe("558px");
    expectAccessibleLabels(svg);

    const hint = screen.getByTestId("history-persistence-scroll-hint");
    expect(scroll).not.toContainElement(hint);
    Object.defineProperty(scroll, "scrollWidth", { configurable: true, value: 1000 });
    Object.defineProperty(scroll, "clientWidth", { configurable: true, value: 400 });
    fireEvent.scroll(scroll);
    await waitFor(() => expect(hint).toHaveClass("flex"));
    expect(hint).toHaveTextContent("Scroll →");
    scroll.scrollLeft = 600;
    fireEvent.scroll(scroll);
    await waitFor(() => expect(hint).toHaveTextContent("Scroll ←"));
  });
});

describe("MiniSparkline baseline and sign colours", () => {
  test("draws a zero baseline with palette-coded segments", () => {
    render(() => <MiniSparkline values={[-4, 3, -2, 5]} />);
    const svg = screen.getByTestId("history-sparkline");
    const baseline = svg.querySelector("[data-baseline]");
    expect(baseline).not.toBeNull();
    const y = Number(baseline?.getAttribute("y1"));
    expect(y).toBeGreaterThan(2);
    expect(y).toBeLessThan(22);
    expect(svg.querySelector('[data-sign="positive"]')).toHaveAttribute("stroke", CHART_POSITIVE);
    expect(svg.querySelector('[data-sign="negative"]')).toHaveAttribute("stroke", CHART_NEGATIVE);
    expectAccessibleLabels(svg);
  });
});
