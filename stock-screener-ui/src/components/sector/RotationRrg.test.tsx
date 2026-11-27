// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import type { RotationRow } from "../../types/rotation";
import {
  RRG_COMPACT_FALLBACK,
  RRG_DESKTOP_FALLBACK,
  RRG_LABEL_HEIGHT,
  RotationRrg,
  layoutRrgLabels,
} from "./RotationRrg";

const returns = {
  "1D": 1,
  "1W": 2,
  "1M": 3,
  "3M": 4,
  "6M": 5,
  YTD: 6,
  "1Y": 7,
};

function row(overrides: Partial<RotationRow>): RotationRow {
  return {
    id: "sector:x",
    name: "X",
    kind: "sector",
    category: "X",
    members: 10,
    covered: 10,
    returns,
    rs_1m: 1,
    rs_1w: 1,
    rs_pct: 50,
    mom_pct: 50,
    rank: 1,
    rank_delta: 0,
    breadth: 50,
    rel_volume: 1,
    quadrant: "leading",
    status: "neutral",
    top_movers: [],
    ...overrides,
  };
}

function renderRrg(rows: RotationRow[], selectedId: string | null = null) {
  return render(() => (
    <UIProvider>
      <RotationRrg rows={rows} selectedId={selectedId} onSelect={() => {}} />
    </UIProvider>
  ));
}

function stubCompactMatchMedia(): () => void {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: query.includes("max-width: 640px"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}

const REAL_SHAPED_ROWS: RotationRow[] = [
  ["technology", "Technology", 78, 70, "leading"],
  ["commercial", "Commercial Services", 68, 64, "leading"],
  ["consumer-non-durables", "Consumer Non-Durables", 62, 58, "leading"],
  ["health-services", "Health Services", 58, 46, "improving"],
  ["process-industries", "Process Industries", 54, 42, "improving"],
  ["electronic-technology", "Electronic Technology", 72, 34, "improving"],
  ["finance", "Finance", 44, 38, "lagging"],
  ["retail-trade", "Retail Trade", 40, 60, "weakening"],
  ["energy-minerals", "Energy Minerals", 36, 56, "weakening"],
  ["producer-manufacturing", "Producer Manufacturing", 32, 52, "weakening"],
  ["utilities", "Utilities", 28, 44, "lagging"],
  ["consumer-services", "Consumer Services", 26, 40, "lagging"],
  ["distribution-services", "Distribution Services", 30, 36, "lagging"],
  ["transportation", "Transportation", 34, 32, "lagging"],
  ["industrial-services", "Industrial Services", 46, 30, "lagging"],
  ["non-energy-minerals", "Non-Energy Minerals", 52, 28, "lagging"],
  ["communications", "Communications", 60, 36, "improving"],
  ["consumer-durables", "Consumer Durables", 64, 40, "improving"],
  ["health-technology", "Health Technology", 70, 44, "improving"],
  ["miscellaneous", "Miscellaneous", 42, 50, "weakening"],
].map(([id, name, rs, mom, quadrant]) =>
  row({
    id: id as string,
    name: name as string,
    rs_pct: rs as number,
    mom_pct: mom as number,
    quadrant: quadrant as RotationRow["quadrant"],
  }),
);

function labelBoxesFromDom(): { id: string; x: number; y: number; w: number; h: number }[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[data-testid^="rotation-rrg-label-"]'),
  ).map((element) => ({
    id: element.getAttribute("data-testid")!.replace("rotation-rrg-label-", ""),
    x: Number.parseFloat(element.style.left),
    y: Number.parseFloat(element.style.top),
    w: Number.parseFloat(element.style.width),
    h: Number.parseFloat(element.style.height),
  }));
}

function boxesOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

afterEach(() => cleanup());

describe("RotationRrg quadrant labels", () => {
  test("keeps quadrant labels by the crosshair and clear of the month axis", () => {
    renderRrg([
      row({ id: "leading", name: "Lead", rs_pct: 70, mom_pct: 70, quadrant: "leading" }),
      row({ id: "lagging", name: "Lag", rs_pct: 30, mom_pct: 30, quadrant: "lagging" }),
    ]);

    const leading = screen.getAllByText("LEADING").find((node) => node.style.bottom === "4px")!;
    const lagging = screen.getAllByText("LAGGING").find((node) => node.style.top === "4px")!;
    expect(leading).toBeDefined();
    expect(lagging).toBeDefined();
    expect(leading).toHaveStyle({ bottom: "4px", right: "12px" });
    expect(lagging).toHaveStyle({ top: "4px", left: "12px" });
    expect(leading.style.top).toBe("auto");
    expect(lagging.style.bottom).toBe("auto");
  });

  test("keeps the rich sector legend for sm and up and shows a compact summary at 390", () => {
    renderRrg([
      row({ id: "technology", name: "Technology", quadrant: "leading" }),
      row({ id: "financials", name: "Financials", quadrant: "improving" }),
      row({ id: "energy", name: "Energy", quadrant: "lagging" }),
    ]);

    const legend = screen.getByTestId("rotation-rrg-legend");
    expect(legend).toHaveClass("hidden");
    expect(legend).toHaveClass("xl:flex");
    expect(legend).toHaveTextContent("Technology");
    expect(legend).toHaveTextContent("Financials");
    expect(legend).toHaveTextContent("Energy");

    const summary = screen.getByTestId("rotation-rrg-compact-summary");
    expect(summary).toHaveClass("xl:hidden");
    expect(summary).toHaveTextContent("Technology");
    expect(summary).toHaveTextContent("LEADING");
    expect(summary).toHaveTextContent("3 groups");
  });

  test("labels at most five groups on a 20-row real-shaped plot at 390", () => {
    const restore = stubCompactMatchMedia();
    try {
      renderRrg(REAL_SHAPED_ROWS, "technology");

      const chart = screen.getByTestId("rotation-rrg-chart");
      const plotW = Number(chart.getAttribute("data-plot-width"));
      const plotH = Number(chart.getAttribute("data-plot-height"));
      expect(plotW).toBe(RRG_COMPACT_FALLBACK.w);
      expect(plotH).toBe(RRG_COMPACT_FALLBACK.h);

      const labels = labelBoxesFromDom();
      expect(labels.length).toBeGreaterThan(1);
      expect(labels.length).toBeLessThanOrEqual(5);

      const labelledDots = document.querySelectorAll(
        '[data-testid^="rotation-rrg-dot-"][data-labelled="true"]',
      );
      expect(labelledDots.length).toBe(labels.length);

      const selected = screen.getByTestId("rotation-rrg-label-technology");
      expect(selected).toHaveAttribute("data-surface", "raised");
      const selectedBox = labelBoxesFromDom().find((box) => box.id === "technology")!;
      expect(selectedBox.x).toBeGreaterThanOrEqual(0);
      expect(selectedBox.y).toBeGreaterThanOrEqual(0);
      expect(selectedBox.x + selectedBox.w).toBeLessThanOrEqual(plotW);
      expect(selectedBox.y + selectedBox.h).toBeLessThanOrEqual(plotH);
      // The bottom 26px are reserved for the x tick strip.
      expect(selectedBox.y + selectedBox.h).toBeLessThanOrEqual(plotH - 24);

      for (let i = 0; i < labels.length; i += 1) {
        for (let j = i + 1; j < labels.length; j += 1) {
          expect(boxesOverlap(labels[i], labels[j])).toBe(false);
        }
      }

      const summary = screen.getByTestId("rotation-rrg-compact-summary");
      expect(summary).toHaveTextContent("Technology");
      expect(summary).toHaveTextContent("LEADING");
      expect(summary).toHaveTextContent("20 groups");
      expect(screen.getByTestId("rotation-rrg-legend")).toHaveClass("hidden");
    } finally {
      restore();
    }
  });

  test("clamps edge dots fully inside the plot at 100/100", () => {
    renderRrg([
      row({ id: "edge", name: "Edge Group", rs_pct: 100, mom_pct: 100, quadrant: "leading" }),
    ]);
    const chart = screen.getByTestId("rotation-rrg-chart");
    const width = Number(chart.dataset.plotWidth);
    const height = Number(chart.dataset.plotHeight);
    expect(width).toBe(RRG_DESKTOP_FALLBACK.w);
    expect(height).toBe(RRG_DESKTOP_FALLBACK.h);
    const anchor = screen.getByTestId("rotation-rrg-dot-anchor-edge");
    const dot = screen.getByTestId("rotation-rrg-dot-edge");
    const radius = Number.parseFloat(dot.style.width) / 2;
    const cx = Number.parseFloat(anchor.style.left);
    const cy = Number.parseFloat(anchor.style.top);
    expect(cx - radius).toBeGreaterThanOrEqual(0);
    expect(cx + radius).toBeLessThanOrEqual(width);
    expect(cy - radius).toBeGreaterThanOrEqual(0);
    expect(cy + radius).toBeLessThanOrEqual(height);
  });

  test("moves a label out of a reserved quadrant caption box", () => {
    const obstacle = {
      id: "quadrant:LEADING",
      name: "LEADING",
      selected: false,
      x: 0,
      y: 80,
      w: 320,
      h: 20,
      below: false,
    };
    const boxes = layoutRrgLabels(
      [{ id: "finance", name: "Finance", px: 50, py: 50, selected: true }],
      320,
      200,
      true,
      [obstacle],
    );
    expect(boxes).toHaveLength(1);
    const overlaps =
      boxes[0].x < obstacle.x + obstacle.w &&
      boxes[0].x + boxes[0].w > obstacle.x &&
      boxes[0].y < obstacle.y + obstacle.h &&
      boxes[0].y + boxes[0].h > obstacle.y;
    expect(overlaps).toBe(false);
  });

  test("clamps edge labels and drops colliding extras", () => {
    const top = layoutRrgLabels(
      [{ id: "top", name: "Technology", px: 50, py: 96, selected: true }],
      320,
      200,
      true,
    );
    expect(top).toHaveLength(1);
    expect(top[0].y).toBeGreaterThanOrEqual(0);
    expect(top[0].y + top[0].h).toBeLessThanOrEqual(200 - 26);

    const bottom = layoutRrgLabels(
      [{ id: "bottom", name: "Materials", px: 50, py: 4, selected: false }],
      320,
      200,
      true,
    );
    expect(bottom).toHaveLength(1);
    expect(bottom[0].below).toBe(false);
    expect(bottom[0].y).toBeGreaterThanOrEqual(0);
    expect(bottom[0].y + bottom[0].h).toBeLessThanOrEqual(200 - 26);

    const colliding = layoutRrgLabels(
      [
        { id: "selected", name: "Technology", px: 50, py: 50, selected: true },
        { id: "extra-1", name: "Finance", px: 50, py: 50, selected: false },
        { id: "extra-2", name: "Energy", px: 50, py: 50, selected: false },
      ],
      320,
      200,
      true,
    );
    // Both sides of the dot are taken by the first two boxes; the third drops.
    expect(colliding.map((box) => box.id)).toEqual(["selected", "extra-1"]);
    expect(colliding[0].h).toBe(RRG_LABEL_HEIGHT);
  });

  test("fits the chart, axis title and y ticks in separate gutters at 390", () => {
    renderRrg([
      row({ id: "lead", name: "Lead", rs_pct: 60, mom_pct: 70, quadrant: "leading" }),
      row({ id: "lag", name: "Lag", rs_pct: 26, mom_pct: 30, quadrant: "lagging" }),
    ]);

    const root = screen.getByTestId("rotation-rrg");
    expect(root).toHaveClass("w-full");
    expect(root).toHaveClass("max-w-full");
    expect(root).toHaveClass("min-w-0");
    expect(root).toHaveClass("overflow-hidden");

    const plot = screen.getByTestId("rotation-rrg-plot");
    expect(plot).toHaveClass("grid-cols-[16px_28px_minmax(0,1fr)]");
    expect(plot).toHaveClass("min-w-0");
    expect(plot).toHaveClass("overflow-hidden");

    const title = screen.getByTestId("rotation-rrg-axis-title");
    expect(title).toHaveTextContent("Momentum");
    expect(title.style.writingMode).toBe("vertical-rl");
    expect(title.style.transform).toBe("rotate(180deg)");

    const chart = screen.getByTestId("rotation-rrg-chart");
    expect(chart).toHaveClass("w-full");
    expect(chart).toHaveClass("max-w-full");
    expect(chart).toHaveClass("min-w-0");
    expect(chart).toHaveClass("overflow-hidden");

    expect(screen.getByTestId("rotation-rrg-x-tick-lo")).toHaveStyle({
      left: "8px",
      bottom: "6px",
    });
    expect(screen.getByTestId("rotation-rrg-x-tick-hi")).toHaveStyle({
      right: "10px",
      bottom: "6px",
    });

    const yAxis = screen.getByTestId("rotation-rrg-y-axis");
    const yHi = screen.getByTestId("rotation-rrg-y-tick-hi");
    const yLo = screen.getByTestId("rotation-rrg-y-tick-lo");
    expect(yAxis.contains(yHi)).toBe(true);
    expect(yAxis.contains(yLo)).toBe(true);
    expect(chart.contains(yHi)).toBe(false);
    expect(chart.contains(yLo)).toBe(false);
    expect(yHi).toHaveStyle({ right: "4px", top: "6px" });
    expect(yHi.style.bottom).toBe("auto");
    expect(yLo).toHaveStyle({ right: "4px", bottom: "6px" });
    expect(yLo.style.top).toBe("auto");
  });

  test("keeps x-hi 78 and y-lo 13 in disjoint tick boxes at 390 and 1600", () => {
    // x domain [50, 74.5] rounds hi to 78; y domain [18, 51] rounds lo to 13 —
    // the pair that overprinted when both axes shared the bottom-right corner.
    for (const width of [390, 1600]) {
      renderRrg([
        row({ id: `lead-${width}`, name: "Lead", rs_pct: 74.5, mom_pct: 51, quadrant: "leading" }),
        row({ id: `lag-${width}`, name: "Lag", rs_pct: 50, mom_pct: 18, quadrant: "lagging" }),
      ]);

      const xHi = screen.getByTestId("rotation-rrg-x-tick-hi");
      const yLo = screen.getByTestId("rotation-rrg-y-tick-lo");
      expect(xHi).toHaveTextContent("78");
      expect(yLo).toHaveTextContent("13");
      expect(xHi).toHaveStyle({ right: "10px", bottom: "6px" });

      const chart = screen.getByTestId("rotation-rrg-chart");
      const yAxis = screen.getByTestId("rotation-rrg-y-axis");
      // The gutter is the plot's second track and the chart its third; a box in
      // column 2 ends before column 3 starts, so their boxes cannot intersect.
      expect(yAxis.nextElementSibling).toBe(chart);
      expect(chart.contains(xHi)).toBe(true);
      expect(yAxis.contains(yLo)).toBe(true);
      expect(chart.contains(yLo)).toBe(false);
      expect(yAxis.contains(xHi)).toBe(false);

      cleanup();
    }
  });

  test("keeps the 78/75 high ticks and quadrant labels clear at 390", () => {
    const restore = stubCompactMatchMedia();
    try {
      renderRrg([
        row({ id: "lead", name: "Lead", rs_pct: 74.5, mom_pct: 71.8, quadrant: "leading" }),
        row({ id: "lag", name: "Lag", rs_pct: 50, mom_pct: 50, quadrant: "lagging" }),
      ]);

      const xHi = screen.getByTestId("rotation-rrg-x-tick-hi");
      expect(xHi).toHaveTextContent("78");
      expect(xHi).toHaveStyle({ right: "10px", bottom: "6px" });
      expect(xHi.style.left).toBe("auto");

      const yHi = screen.getByTestId("rotation-rrg-y-tick-hi");
      expect(yHi).toHaveTextContent("75");
      expect(yHi).toHaveStyle({ right: "4px", top: "6px" });
      expect(yHi.style.bottom).toBe("auto");

      const leading = screen.getAllByText("LEADING").find((node) => node.style.bottom === "4px")!;
      const weakening = screen.getAllByText("WEAKENING").find((node) => node.style.top === "4px")!;
      expect(leading).toHaveStyle({ right: "30px" });
      expect(weakening).toHaveStyle({ right: "30px" });

      const improving = screen.getAllByText("IMPROVING").find((node) => node.style.bottom === "4px")!;
      const lagging = screen.getAllByText("LAGGING").find((node) => node.style.top === "4px")!;
      expect(improving).toHaveStyle({ left: "30px" });
      expect(lagging).toHaveStyle({ left: "30px" });
    } finally {
      restore();
    }
  });

  test("wraps all four quadrant counts inside the panel at 390", () => {
    renderRrg([
      row({ id: "lead-1", name: "Lead 1", quadrant: "leading" }),
      row({ id: "lead-2", name: "Lead 2", quadrant: "leading" }),
      row({ id: "improve-1", name: "Improve 1", quadrant: "improving" }),
      row({ id: "weaken-1", name: "Weaken 1", quadrant: "weakening" }),
      row({ id: "lag-1", name: "Lag 1", quadrant: "lagging" }),
      row({ id: "lag-2", name: "Lag 2", quadrant: "lagging" }),
    ]);

    const footer = screen.getByTestId("rotation-rrg-footer");
    expect(footer).toHaveClass("flex-col");
    expect(footer).toHaveClass("sm:flex-row");
    expect(footer).toHaveClass("min-w-0");

    const legend = screen.getByTestId("rotation-rrg-count-legend");
    expect(legend).toHaveClass("flex-wrap");
    expect(legend).not.toHaveClass("overflow-hidden");

    const expected: [string, string, number][] = [
      ["leading", "LEADING", 2],
      ["improving", "IMPROVING", 1],
      ["weakening", "WEAKENING", 1],
      ["lagging", "LAGGING", 2],
    ];
    for (const [key, label, count] of expected) {
      expect(screen.getByTestId(`rotation-rrg-count-${key}`)).toHaveTextContent(
        new RegExp(`${label}\\s*${count}`),
      );
    }

    const root = screen.getByTestId("rotation-rrg");
    expect(root).toHaveClass("min-w-0");
    expect(root).toHaveClass("overflow-hidden");
    const chart = screen.getByTestId("rotation-rrg-chart");
    expect(chart).toHaveClass("max-w-full");
    expect(chart).toHaveClass("min-w-0");
    expect(chart).toHaveClass("overflow-hidden");
  });

  test("survives a group with an unknown quadrant colour", () => {
    const broken = row({
      id: "broken",
      name: "Broken",
      quadrant: undefined as unknown as RotationRow["quadrant"],
      rs_pct: 50,
      mom_pct: 50,
    });

    expect(() => renderRrg([broken])).not.toThrow();

    const dot = screen.getByRole("button", { name: /Broken/ });
    expect(dot.style.backgroundColor).toMatch(/^rgba\(/);
    expect(dot.style.border).toContain("rgba(");
  });
});
