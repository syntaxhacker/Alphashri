// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { SURFACE } from "@/ui/palette";
import { compositeOver, contrastRatio, pickTextColor } from "@/utils/contrast";
import type { SectorHistorySeries } from "../../../../types/sectorHistory";
import {
  CATEGORICAL,
  CHART_CURRENT,
  CHART_LINE,
  CHART_MUTED,
  CHART_NEGATIVE,
  CHART_NEUTRAL,
  CHART_POSITIVE,
  CHART_TOP3,
  RANK_STOPS,
  SHARE_STOPS,
  interpolateHex,
  rankColor,
  returnColor,
  sampleStops,
  shareColor,
} from "./chartPalette";
import {
  RankTransitionSankey,
  TRANSITION_BAND_FILLS,
  TRANSITION_CHART_HEIGHT,
  buildTransitionSankey,
  formatTransitionTooltip,
} from "./RankTransitionSankey";
import {
  MOVERS_HEADER_HEIGHT,
  MOVERS_MIN_WIDTH,
  MOVERS_ROW_HEIGHT,
  MOVERS_VIEW_WIDTH,
  MonthlyMovers,
  buildMonthlyMovers,
} from "./MonthlyMovers";

const chartCapture = vi.hoisted(() => ({
  options: [] as Array<Record<string, any>>,
  styles: [] as Array<Record<string, any>>,
}));

vi.mock("../../../common/EChart", () => ({
  EChart: (props: {
    option: Record<string, any>;
    style?: Record<string, any>;
    "data-testid"?: string;
  }) => {
    chartCapture.options.push(props.option);
    chartCapture.styles.push(props.style ?? {});
    const el = document.createElement("div");
    el.setAttribute("data-testid", props["data-testid"] ?? "");
    return el;
  },
}));

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

const ROTATING_RANKS: Record<string, (number | null)[]> = {
  ALPHA: [1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3],
  BETA: [2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3, 1],
  GAMMA: [3, 1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2],
};

const SANKEY_SERIES: SectorHistorySeries[] = [
  {
    name: "NIFTY 50",
    is_benchmark: true,
    monthly_returns: MONTHS.map(() => 0.5),
    ranks: MONTHS.map(() => null),
  },
  ...Object.entries(ROTATING_RANKS).map(([name, ranks]) => ({
    name,
    is_benchmark: false,
    monthly_returns: MONTHS.map(() => 1),
    ranks,
  })),
];

const TEN_SERIES: SectorHistorySeries[] = Array.from({ length: 10 }, (_, index) => ({
  name: `SECTOR ${index + 1}`,
  is_benchmark: false,
  monthly_returns: MONTHS.map(() => 1),
  ranks: MONTHS.map((_, month) => ((index + month) % 10) + 1),
}));

const MOVER_MONTHS = ["2025-11", "2025-12"];
const MOVER_SERIES: SectorHistorySeries[] = [
  {
    name: "SPY",
    is_benchmark: true,
    monthly_returns: [0.2, 0.3],
    ranks: [null, null],
  },
  {
    name: "ALPHA",
    is_benchmark: false,
    monthly_returns: [1, 2],
    ranks: [5, 1],
  },
  {
    name: "BETA",
    is_benchmark: false,
    monthly_returns: [1, 2],
    ranks: [1, 3],
  },
  {
    name: "GAMMA",
    is_benchmark: false,
    monthly_returns: [1, 2],
    ranks: [2, 2],
  },
  {
    name: "DELTA",
    is_benchmark: false,
    monthly_returns: [1, 2],
    ranks: [4, 7],
  },
  {
    name: "EPSILON",
    is_benchmark: false,
    monthly_returns: [1, 2],
    ranks: [null, 6],
  },
];

function textContrastOn(fill: string, alpha = 1): number {
  const background = compositeOver(fill, SURFACE, alpha);
  return contrastRatio(pickTextColor(background), background);
}

afterEach(() => {
  cleanup();
});

describe("chart palette tokens", () => {
  test("pins the dedicated chart tokens away from UI amber", () => {
    expect(CHART_LINE).toBe("#7DD3FC");
    expect(CHART_TOP3).toBe("#F2CC60");
    expect(CHART_CURRENT).toBe("#56D4DD");
    expect(CHART_MUTED).toBe("#94A3B8");
    expect(CHART_NEGATIVE).toBe("#4C9AFF");
    expect(CHART_POSITIVE).toBe("#F59E0B");
    expect(CHART_NEUTRAL).toBe("#1F242D");
    expect(RANK_STOPS).toEqual([
      "#F2CC60",
      "#C9E265",
      "#67D4D0",
      "#2E9BC6",
      "#1D6FA5",
      "#123B5E",
      "#0B1F33",
    ]);
    expect(SHARE_STOPS).toEqual(["#0B1F33", "#123B5E", "#1D6FA5", "#2E9BC6", "#56D4DD"]);
  });

  test("keeps CHART_MUTED readable on the chart surface", () => {
    expect(contrastRatio(CHART_MUTED, SURFACE)).toBeGreaterThanOrEqual(4.5);
  });

  test("ships at least eight unique Okabe-Ito-derived categorical hues", () => {
    expect(CATEGORICAL.length).toBeGreaterThanOrEqual(8);
    expect(new Set(CATEGORICAL).size).toBe(CATEGORICAL.length);
    for (const color of CATEGORICAL) {
      expect(color).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  test("interpolates hex endpoints, midpoints and clamps the input", () => {
    expect(interpolateHex("#000000", "#FFFFFF", 0)).toBe("#000000");
    expect(interpolateHex("#000000", "#FFFFFF", 1)).toBe("#FFFFFF");
    expect(interpolateHex("#000000", "#FFFFFF", 0.5)).toBe("#808080");
    expect(interpolateHex("#000", "#fff", 0.5)).toBe("#808080");
    expect(interpolateHex("#000000", "#FFFFFF", -2)).toBe("#000000");
    expect(interpolateHex("#000000", "#FFFFFF", 4)).toBe("#FFFFFF");
  });

  test("samples stops continuously and clamps out-of-range positions", () => {
    expect(sampleStops(RANK_STOPS, 0)).toBe(RANK_STOPS[0]);
    expect(sampleStops(RANK_STOPS, 1)).toBe(RANK_STOPS[RANK_STOPS.length - 1]);
    expect(sampleStops(RANK_STOPS, 0.5)).toBe(RANK_STOPS[3]);
    expect(sampleStops(SHARE_STOPS, 0.25)).toBe(SHARE_STOPS[1]);
    expect(sampleStops(SHARE_STOPS, -1)).toBe(SHARE_STOPS[0]);
    expect(sampleStops(SHARE_STOPS, 9)).toBe(SHARE_STOPS[SHARE_STOPS.length - 1]);
    expect(sampleStops(["#123456"], 0.7)).toBe("#123456");
    expect(sampleStops([], 0.7)).toBe(CHART_MUTED);
  });

  test("maps ranks, signed returns and shares into their ramps", () => {
    expect(rankColor(1, 7)).toBe(RANK_STOPS[0]);
    expect(rankColor(4, 7)).toBe(RANK_STOPS[3]);
    expect(rankColor(7, 7)).toBe(RANK_STOPS[6]);
    expect(rankColor(99, 7)).toBe(RANK_STOPS[6]);
    expect(rankColor(1, 1)).toBe(RANK_STOPS[0]);
    expect(rankColor(Number.NaN, 7)).toBe(CHART_MUTED);

    expect(returnColor(0, 10)).toBe(CHART_NEUTRAL);
    expect(returnColor(10, 10)).toBe(CHART_POSITIVE);
    expect(returnColor(-10, 10)).toBe(CHART_NEGATIVE);
    expect(returnColor(5, 0)).toBe(CHART_POSITIVE);
    expect(returnColor(1, 10)).not.toBe(CHART_NEUTRAL);
    expect(returnColor(1, 10)).not.toBe(returnColor(10, 10));
    expect(returnColor(-1, 10)).not.toBe(returnColor(1, 10));

    expect(shareColor(0, 10)).toBe(SHARE_STOPS[0]);
    expect(shareColor(5, 10)).toBe(sampleStops(SHARE_STOPS, 0.5));
    expect(shareColor(10, 10)).toBe(SHARE_STOPS[4]);
    expect(shareColor(20, 10)).toBe(SHARE_STOPS[4]);
    expect(shareColor(-5, 10)).toBe(SHARE_STOPS[0]);
  });

  test("keeps text at AA contrast on rank, return and share fills", () => {
    for (let rank = 1; rank <= 7; rank++) {
      const fill = rankColor(rank, 7);
      expect(textContrastOn(fill, 0.9), `rank ${rank}/7 (${fill})`).toBeGreaterThanOrEqual(4.5);
    }

    for (let rank = 1; rank <= 10; rank++) {
      const fill = rankColor(rank, 10);
      expect(textContrastOn(fill, 0.9), `rank ${rank}/10 (${fill})`).toBeGreaterThanOrEqual(4.5);
    }

    for (let value = -10; value <= 10; value += 0.5) {
      const fill = returnColor(value, 10);
      expect(textContrastOn(fill), `return ${value} (${fill})`).toBeGreaterThanOrEqual(4.5);
    }

    for (const value of [0, 2.5, 5, 7.5, 10]) {
      const fill = shareColor(value, 10);
      expect(textContrastOn(fill, 0.9), `share ${value} (${fill})`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("RankTransitionSankey", () => {
  beforeEach(() => {
    chartCapture.options.length = 0;
    chartCapture.styles.length = 0;
  });

  test("counts month-to-month band moves on a known 3-sector fixture", () => {
    const option = buildTransitionSankey({
      months: MONTHS,
      series: SANKEY_SERIES,
    });
    const series = option.series as Array<Record<string, any>>;

    expect(series).toHaveLength(1);
    expect(series[0].type).toBe("sankey");
    expect(series[0].links).toBe(option.links);
    expect(option.transitions).toBe(3 * (MONTHS.length - 1));
    expect(option.links).toHaveLength(1);
    expect(option.links[0]).toMatchObject({ value: 33 });
    expect(option.links[0].source).toContain("Top 3");
    expect(option.links[0].target).toContain("Top 3");
    expect(option.links.reduce((sum, link) => sum + link.value, 0)).toBe(option.transitions);
    expect(option.bandLinkCount).toBeLessThanOrEqual(9);
    expect(option.hasData).toBe(true);
  });

  test("never exceeds nine band links and keeps totals equal to transitions", () => {
    const option = buildTransitionSankey({
      months: MONTHS,
      series: TEN_SERIES,
    });
    expect(option.nodes).toHaveLength(6);
    expect(option.links.length).toBeLessThanOrEqual(9);
    expect(option.links.reduce((sum, link) => sum + link.value, 0)).toBe(option.transitions);
    expect(option.transitions).toBe(TEN_SERIES.length * (MONTHS.length - 1));
    expect(new Set(option.links.map((link) => `${link.source}->${link.target}`)).size).toBe(
      option.links.length,
    );

    expect(new Set(option.nodes.map((node) => node.displayName))).toEqual(
      new Set(["Top 3", "Mid 4–6", "Bottom 7–10"]),
    );
    expect(option.bands.map((band) => band.label)).toEqual(["Top 3", "Mid 4–6", "Bottom 7–10"]);
    expect(TRANSITION_BAND_FILLS).toEqual({
      top: CHART_TOP3,
      mid: "#67D4D0",
      bottom: "#2E9BC6",
    });
    expect(option.nodes.find((node) => node.band === "top")?.itemStyle.color).toBe(CHART_TOP3);
  });

  test("skips null ranks so transitions only count observed pairs", () => {
    const series: SectorHistorySeries[] = [
      {
        name: "A",
        is_benchmark: false,
        monthly_returns: [],
        ranks: [1, null, 2, 1],
      },
      {
        name: "B",
        is_benchmark: false,
        monthly_returns: [],
        ranks: [8, null, 8, null],
      },
    ];
    const option = buildTransitionSankey({
      months: ["2025-01", "2025-02", "2025-03", "2025-04"],
      series,
      topN: 10,
    });
    // A contributes one pair (2 -> 1); B contributes none.
    expect(option.transitions).toBe(1);
    expect(option.links).toHaveLength(1);
    expect(option.links[0]).toMatchObject({
      sourceBand: "top",
      targetBand: "top",
      value: 1,
    });
  });

  test("formats edge tooltips as From → To · N moves", () => {
    expect(
      formatTransitionTooltip({
        data: {
          source: "Top 3 · now",
          target: "Mid 4–6 · next",
          value: 7,
        },
      }),
    ).toBe("Top 3 → Mid 4–6 · 7 moves");
    expect(
      formatTransitionTooltip([
        {
          data: {
            source: "Bottom 7–10 · now",
            target: "Bottom 7–10 · next",
            value: 4,
          },
        },
      ]),
    ).toBe("Bottom 7–10 → Bottom 7–10 · 4 moves");
    expect(formatTransitionTooltip({})).toBe("");
  });

  test("renders the direct title, note and 340px EChart", () => {
    render(() => <RankTransitionSankey months={MONTHS} series={SANKEY_SERIES} />);
    expect(screen.getByText("Rank transitions · this month → next month")).toBeInTheDocument();
    expect(screen.getByText("counts of monthly band moves")).toBeInTheDocument();
    expect(screen.getByTestId("history-rank-transition-columns").textContent).toContain(
      "This month",
    );
    expect(screen.getByTestId("history-rank-transition-columns").textContent).toContain(
      "Next month",
    );
    expect(screen.getByTestId("history-rank-transition-sankey")).toBeInTheDocument();
    expect(chartCapture.options.at(-1)?.series?.[0]?.type).toBe("sankey");
    expect(chartCapture.styles.at(-1)).toMatchObject({
      height: `${TRANSITION_CHART_HEIGHT}px`,
    });
  });

  test("showHeader={false} hides the internal title but keeps the note, key and chart", () => {
    render(() => (
      <RankTransitionSankey months={MONTHS} series={SANKEY_SERIES} showHeader={false} />
    ));
    expect(screen.queryByTestId("history-rank-transition-title")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Rank transitions · this month → next month"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("counts of monthly band moves")).toBeInTheDocument();
    const columns = screen.getByTestId("history-rank-transition-columns");
    expect(columns.textContent).toContain("This month");
    expect(columns.textContent).toContain("Next month");
    expect(screen.getByTestId("history-rank-transition-key")).toBeInTheDocument();
    expect(screen.getByTestId("history-rank-transition-sankey")).toBeInTheDocument();
    expect(chartCapture.options).toHaveLength(1);
  });

  test("names all three bands directly when the universe spans 1–10", () => {
    render(() => <RankTransitionSankey months={MONTHS} series={TEN_SERIES} />);
    const key = screen.getByTestId("history-rank-transition-key");
    expect(key).toHaveTextContent("Top 3");
    expect(key).toHaveTextContent("Mid 4–6");
    expect(key).toHaveTextContent("Bottom 7–10");
  });

  test("renders an empty state without an EChart", () => {
    render(() => <RankTransitionSankey months={[]} series={[]} />);
    expect(screen.getByTestId("history-rank-transition-empty")).toBeInTheDocument();
    expect(chartCapture.options).toHaveLength(0);
  });
});

describe("MonthlyMovers", () => {
  test("orders by move size and carries current rank, delta and top-3 flags", () => {
    const model = buildMonthlyMovers({
      months: MOVER_MONTHS,
      series: MOVER_SERIES,
    });
    expect(model.hasData).toBe(true);
    expect(model.previousMonth).toBe("2025-11");
    expect(model.currentMonth).toBe("2025-12");
    expect(model.rows.map((row) => row.name)).toEqual([
      "ALPHA",
      "DELTA",
      "BETA",
      "GAMMA",
      "EPSILON",
    ]);
    expect(model.rows.map((row) => row.currentRank)).toEqual([1, 7, 3, 2, 6]);
    expect(model.rows.map((row) => row.delta)).toEqual([4, -3, -2, 0, null]);
    expect(model.rows.map((row) => row.top3)).toEqual([true, false, true, true, false]);
    expect(model.rankMax).toBe(7);
  });

  test("renders a native SVG dumbbell with inverted rank axis and current rank column", () => {
    render(() => <MonthlyMovers months={MOVER_MONTHS} series={MOVER_SERIES} />);
    expect(
      screen.getByText("Rank change over the latest month · arrows point to current rank"),
    ).toBeInTheDocument();

    const svg = screen.getByTestId("history-monthly-movers-chart");
    expect(svg).toHaveAttribute(
      "viewBox",
      `0 0 ${MOVERS_VIEW_WIDTH} ${MOVERS_HEADER_HEIGHT + 5 * MOVERS_ROW_HEIGHT}`,
    );
    expect(screen.getByTestId("history-monthly-movers-scroll")).toHaveClass("overflow-x-auto");
    expect(svg.style.minWidth).toBe(`${MOVERS_MIN_WIDTH}px`);
    expect(svg.style.maxWidth).toBe(`${MOVERS_VIEW_WIDTH}px`);
    expect(screen.getByTestId("history-monthly-movers-months")).toHaveTextContent(
      "2025-11 → 2025-12",
    );
    expect(screen.getByTestId("history-monthly-movers-note")).toHaveTextContent("cyan = current");
    expect(screen.getByTestId("history-monthly-movers-scroll-hint")).toHaveTextContent("Scroll →");

    const rows = Array.from(svg.querySelectorAll("[data-sector]"));
    expect(rows).toHaveLength(5);
    expect(rows.map((row) => row.getAttribute("data-sector"))).toEqual([
      "ALPHA",
      "DELTA",
      "BETA",
      "GAMMA",
      "EPSILON",
    ]);
    expect(rows[0]).toHaveAttribute("data-current-rank", "1");
    expect(rows[0]).toHaveAttribute("data-delta", "4");
    expect(rows[0]).toHaveAttribute("data-top3", "true");
    expect(rows[1]).toHaveAttribute("data-top3", "false");
    expect(rows[4]).not.toHaveAttribute("data-prev-rank");
    expect(rows[4]).toHaveAttribute("data-current-rank", "6");

    expect(screen.getByTestId("history-mover-rank-0")).toHaveTextContent("#1");
    expect(screen.getByTestId("history-mover-rank-1")).toHaveTextContent("#7");
    expect(screen.getByTestId("history-mover-rank-2")).toHaveTextContent("#3");
    expect(screen.getByTestId("history-mover-rank-3")).toHaveTextContent("#2");
    expect(screen.getByTestId("history-mover-rank-4")).toHaveTextContent("#6");

    expect(screen.getByTestId("history-mover-left-rank-0")).toHaveTextContent("#1");
    expect(screen.getByTestId("history-mover-left-rank-1")).toHaveTextContent("#7");
    expect(screen.getByTestId("history-mover-left-rank-2")).toHaveTextContent("#3");
    expect(screen.getByTestId("history-mover-left-rank-3")).toHaveTextContent("#2");
    expect(screen.getByTestId("history-mover-left-rank-4")).toHaveTextContent("#6");

    expect(svg.querySelector('[data-current-dot="0"]')).toHaveAttribute("fill", CHART_CURRENT);
    expect(svg.querySelector('[data-current-dot="1"]')).toHaveAttribute("fill", CHART_CURRENT);
    expect(svg.querySelector("marker path")).toHaveAttribute("fill", CHART_CURRENT);
    expect(svg.querySelector('[data-previous-dot="0"]')).toHaveAttribute("fill", CHART_MUTED);
    expect(svg.querySelector('[data-connector="0"]')).not.toBeNull();
    expect(svg.querySelector('[data-connector="3"]')).toBeNull();
    expect(svg.querySelector('[data-connector="4"]')).toBeNull();
    expect(svg.querySelector('[data-previous-dot="4"]')).toBeNull();
  });

  test("showHeader={false} hides the internal title but keeps the visible month pair, note and chart", () => {
    render(() => <MonthlyMovers months={MOVER_MONTHS} series={MOVER_SERIES} showHeader={false} />);
    expect(screen.queryByTestId("history-monthly-movers-title")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Rank change over the latest month · arrows point to current rank"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("history-monthly-movers-months")).toHaveTextContent(
      "2025-11 → 2025-12",
    );
    expect(screen.getByTestId("history-monthly-movers-note")).toHaveTextContent(
      "sorted by size of move · muted = previous · amber = top 3 · cyan = current",
    );
    expect(screen.getByTestId("history-monthly-movers-chart")).toBeInTheDocument();
  });

  test("shows only the current dot when there is no previous ranked month", () => {
    const series: SectorHistorySeries[] = [
      {
        name: "ALPHA",
        is_benchmark: false,
        monthly_returns: [],
        ranks: [2],
      },
    ];
    render(() => <MonthlyMovers months={["2025-12"]} series={series} />);
    expect(screen.getByTestId("history-monthly-movers-months")).toHaveTextContent(
      "No prior ranked month · 2025-12",
    );
    const row = screen.getByTestId("history-mover-row-0");
    expect(row).not.toHaveAttribute("data-prev-rank");
    expect(row).toHaveAttribute("data-current-rank", "2");
    expect(screen.getByTestId("history-mover-left-rank-0")).toHaveTextContent("#2");
    expect(screen.getByTestId("history-monthly-movers-chart")).toBeInTheDocument();
  });

  test("renders an empty state with no ranked months", () => {
    render(() => <MonthlyMovers months={[]} series={[]} />);
    expect(screen.getByTestId("history-monthly-movers")).toBeInTheDocument();
    expect(screen.getByTestId("history-monthly-movers-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("history-monthly-movers-chart")).toBeNull();
  });
});
