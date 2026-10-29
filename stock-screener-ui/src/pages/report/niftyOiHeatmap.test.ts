// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { createElement, type ReactElement } from "react";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { UIProvider } from "@/ui";
import * as palette from "@/ui/palette";
import { buildOiHeatmap, heatmapReadText, readHeatmap, type ChainTuple, type HeatmapTapeRow } from "./niftyOiHeatmap";
import { HEATMAP_CE, HEATMAP_FLIP, HEATMAP_MP, HEATMAP_PE, HEATMAP_SPOT, NiftyOiHeatmap } from "./NiftyOiHeatmap";

function TestWrapper({ children }: { children: React.ReactNode }) {
  return createElement(UIProvider, null, children);
}

function r(jsx: ReactElement) {
  return render(jsx, { wrapper: TestWrapper });
}

afterEach(() => {
  cleanup();
});

function chainAt(strikes: number[], spot: number, ceOi: number, peOi: number): Record<string, ChainTuple> {
  const out: Record<string, ChainTuple> = {};
  for (const s of strikes) {
    void spot;
    out[String(s)] = [10, 12, ceOi, peOi, 100, 100];
  }
  return out;
}

function row(t: string, spot: number, chain: HeatmapTapeRow["chain"], extra: Partial<HeatmapTapeRow> = {}): HeatmapTapeRow {
  return { t, spot, max_pain: 25700, flip: 25750, atm_strike: 25750, chain, ...extra };
}

const STRIKES = [25650, 25700, 25750, 25800, 25850];
const T0 = "2026-10-14T09:15:00+05:30";

function iso(min: number): string {
  const total = 9 * 60 + 15 + min;
  const hh = String(Math.floor(total / 60)).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `2026-10-14T${hh}:${mm}:00+05:30`;
}

describe("buildOiHeatmap", () => {
  test("groups rows into bucketMin buckets", () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      row(iso(i), 25750 + i, chainAt(STRIKES, 25750, 1000, 1000)),
    );
    const m = buildOiHeatmap(rows, { bucketMin: 5, widthPts: 500 });
    expect(m.empty).toBe(false);
    expect(m.buckets).toHaveLength(2);
    // Bucket label = last row in the bucket (latest snapshot).
    expect(m.buckets[0].label).toBe("09:19");
    expect(m.buckets[1].label).toBe("09:24");
  });

  test("first bucket cells are flat with null deltas", () => {
    const rows = [row(iso(0), 25750, chainAt(STRIKES, 25750, 1000, 1000)), row(iso(6), 25760, chainAt(STRIKES, 25760, 2000, 1000))];
    const m = buildOiHeatmap(rows, { bucketMin: 5 });
    const first = m.cells.filter((c) => c.bucket === 0);
    expect(first.length).toBeGreaterThan(0);
    expect(first.every((c) => c.ceDoi === null && c.peDoi === null && c.sign === "flat")).toBe(true);
  });

  test("CE build reads red, PE build reads green", () => {
    const rows = [
      row(iso(0), 25750, chainAt(STRIKES, 25750, 1000, 1000)),
      row(iso(6), 25760, chainAt([25650, 25750], 25760, 5000, 1000)),
    ];
    const m = buildOiHeatmap(rows, { bucketMin: 5, widthPts: 500 });
    const b1 = m.cells.filter((c) => c.bucket === 1);
    expect(b1.find((c) => c.strike === 25750)?.sign).toBe("ce");
    // PE-heavy strike: rebuild with PE dominance
    const rows2 = [
      row(iso(0), 25750, chainAt(STRIKES, 25750, 1000, 1000)),
      row(iso(6), 25760, { ...chainAt(STRIKES, 25760, 1000, 1000), "25850": [10, 12, 1000, 9000, 1, 1] }),
    ];
    const m2 = buildOiHeatmap(rows2, { bucketMin: 5, widthPts: 500 });
    expect(m2.cells.find((c) => c.bucket === 1 && c.strike === 25850)?.sign).toBe("pe");
  });

  test("delta arithmetic is current minus previous bucket", () => {
    const rows = [
      row(iso(0), 25750, chainAt([25750], 25750, 1000, 2000)),
      row(iso(6), 25760, chainAt([25750], 25760, 4000, 1500)),
    ];
    const m = buildOiHeatmap(rows, { bucketMin: 5, widthPts: 500 });
    const cell = m.cells.find((c) => c.bucket === 1 && c.strike === 25750);
    expect(cell?.ceDoi).toBe(3000);
    expect(cell?.peDoi).toBe(-500);
  });

  test("intensity normalizes to the max |ΔOI|", () => {
    const rows = [
      row(iso(0), 25750, chainAt(STRIKES, 25750, 1000, 1000)),
      row(iso(6), 25760, {
        ...chainAt(STRIKES, 25760, 1000, 1000),
        "25750": [10, 12, 6000, 1000, 1, 1],
        "25800": [10, 12, 2000, 1000, 1, 1],
      }),
    ];
    const m = buildOiHeatmap(rows, { bucketMin: 5, widthPts: 500 });
    expect(m.maxAbs).toBe(5000);
    expect(m.cells.find((c) => c.bucket === 1 && c.strike === 25750)?.intensity).toBe(1);
    expect(m.cells.find((c) => c.bucket === 1 && c.strike === 25800)?.intensity).toBeCloseTo(0.2);
  });

  test("filters strikes outside spot ± width", () => {
    const wide = [...STRIKES, 24000, 27500];
    const rows = [
      row(iso(0), 25750, chainAt(wide, 25750, 1000, 1000)),
      row(iso(6), 25760, chainAt(wide, 25760, 2000, 1000)),
    ];
    const m = buildOiHeatmap(rows, { bucketMin: 5, widthPts: 500 });
    expect(m.strikes).not.toContain(24000);
    expect(m.strikes).not.toContain(27500);
    expect(m.strikes).toContain(25750);
  });

  test("missing chain yields the empty model", () => {
    const rows: HeatmapTapeRow[] = [
      { t: iso(0), spot: 25750 },
      { t: iso(6), spot: 25760, chain: {} },
    ];
    const m = buildOiHeatmap(rows);
    expect(m.empty).toBe(true);
    expect(m.cells).toHaveLength(0);
  });

  test("empty input and bad spots are empty", () => {
    expect(buildOiHeatmap([]).empty).toBe(true);
    expect(buildOiHeatmap([{ t: iso(0), spot: 0 }]).empty).toBe(true);
  });

  test("carries spot, max-pain and flip per bucket", () => {
    const rows = [
      row(iso(0), 25750, chainAt(STRIKES, 25750, 1000, 1000), { max_pain: 25700, flip: 25800 }),
      row(iso(6), 25760, chainAt(STRIKES, 25760, 2000, 1000), { max_pain: 25800, flip: 25700 }),
    ];
    const m = buildOiHeatmap(rows, { bucketMin: 5 });
    expect(m.buckets[1].spot).toBe(25760);
    expect(m.buckets[1].maxPain).toBe(25800);
    expect(m.buckets[1].flip).toBe(25700);
  });

  test("flags a bucket when an earlier row (not the representative) touches max pain", () => {
    const rows = [
      row(iso(0), 25700, chainAt(STRIKES, 25700, 1000, 1000), { max_pain: 25700 }),
      row(iso(4), 25800, chainAt(STRIKES, 25800, 2000, 1000), { max_pain: 25700 }),
    ];
    const m = buildOiHeatmap(rows, { bucketMin: 5, widthPts: 500 });
    expect(m.buckets).toHaveLength(1);
    // Representative (09:19, 25,800) is 100 pts away …
    expect(m.buckets[0].spot).toBe(25800);
    // … but the earlier 09:15 row (25,700) sat on the pin.
    expect(m.buckets[0].touch).toMatchObject({ spot: 25700, maxPain: 25700, distance: 0, label: "09:15" });
  });

  test("a bucket with no touching row keeps touch null", () => {
    const rows = [
      row(iso(0), 25750, chainAt(STRIKES, 25750, 1000, 1000), { max_pain: 25500 }),
      row(iso(4), 25800, chainAt(STRIKES, 25800, 2000, 1000), { max_pain: 25500 }),
    ];
    const m = buildOiHeatmap(rows, { bucketMin: 5, widthPts: 500 });
    expect(m.buckets[0].touch).toBeNull();
  });

  test("picks the closest touching row when several touch", () => {
    const rows = [
      row(iso(0), 25708, chainAt(STRIKES, 25708, 1000, 1000), { max_pain: 25700 }),
      row(iso(2), 25701, chainAt(STRIKES, 25701, 1500, 1000), { max_pain: 25700 }),
      row(iso(4), 25800, chainAt(STRIKES, 25800, 2000, 1000), { max_pain: 25700 }),
    ];
    const m = buildOiHeatmap(rows, { bucketMin: 5, widthPts: 500 });
    expect(m.buckets[0].touch).toMatchObject({ spot: 25701, distance: 1, label: "09:17" });
  });

  test("bucket start labels are the wall-clock bucket starts", () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      row(iso(i), 25750, chainAt(STRIKES, 25750, 1000, 1000)),
    );
    const m = buildOiHeatmap(rows, { bucketMin: 5 });
    expect(m.buckets.map((b) => b.startLabel)).toEqual(["09:15", "09:20"]);
    // The representative label stays the last row of the bucket.
    expect(m.buckets[0].label).toBe("09:19");
  });
});

describe("heatmap read", () => {
  const readRows = [
    row(iso(0), 25750, chainAt(STRIKES, 25750, 1000, 1000), { max_pain: 25700 }),
    row(
      iso(6),
      25760,
      {
        ...chainAt(STRIKES, 25760, 1000, 1000),
        "25750": [10, 12, 6000, 1000, 1, 1], // CE +5000 → call build
        "25700": [10, 12, 1000, 5000, 1, 1], // PE +4000 → put build
      },
      { max_pain: 25800 },
    ),
  ];

  test("picks the largest CE and PE builds and compares spot to max pain", () => {
    const read = readHeatmap(buildOiHeatmap(readRows, { bucketMin: 5, widthPts: 500 }));
    expect(read.ceStrike).toBe(25750);
    expect(read.ceDoi).toBe(5000);
    expect(read.peStrike).toBe(25700);
    expect(read.peDoi).toBe(4000);
    expect(read.maxPain).toBe(25800);
    expect(read.spotVsMaxPain).toBe("below");
  });

  test("renders the one-line read", () => {
    const read = readHeatmap(buildOiHeatmap(readRows, { bucketMin: 5, widthPts: 500 }));
    expect(heatmapReadText(read)).toBe(
      "Call writers pressing 25,750 · put buyers at 25,700 · spot 25,760 below max pain 25,800",
    );
  });

  test("reads above max pain when spot is higher", () => {
    const rows = [
      row(iso(0), 25750, chainAt(STRIKES, 25750, 1000, 1000), { max_pain: 25700 }),
      row(iso(6), 25760, chainAt(STRIKES, 25760, 1000, 1000), { max_pain: 25700 }),
    ];
    const read = readHeatmap(buildOiHeatmap(rows, { bucketMin: 5 }));
    expect(read.spotVsMaxPain).toBe("above");
    expect(heatmapReadText(read)).toBe("spot 25,760 above max pain 25,700");
  });
});

describe("NiftyOiHeatmap render", () => {
  const twoBuckets = [
    row(iso(0), 25750, chainAt(STRIKES, 25750, 1000, 1000)),
    row(iso(1), 25752, chainAt(STRIKES, 25752, 1100, 1050)),
    row(iso(15), 25760, chainAt(STRIKES, 25760, 4000, 1200)),
    row(iso(30), 25780, chainAt(STRIKES, 25780, 4500, 1300)),
  ];

  test("renders one rect per bucket × strike plus a spot line", () => {
    r(createElement(NiftyOiHeatmap, { rows: twoBuckets, bucketMin: 5, widthPts: 500 }));
    const m = buildOiHeatmap(twoBuckets, { bucketMin: 5, widthPts: 500 });
    expect(screen.getAllByTestId("nifty-heatmap-cell")).toHaveLength(m.cells.length);
    expect(m.cells.length).toBe(m.buckets.length * m.strikes.length);
    expect(screen.getByTestId("nifty-heatmap-spotline")).toBeInTheDocument();
  });

  test("marks max-pain and flip dashed lines", () => {
    r(createElement(NiftyOiHeatmap, { rows: twoBuckets, bucketMin: 5, widthPts: 500 }));
    expect(screen.getAllByTestId("nifty-heatmap-maxpain").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("nifty-heatmap-flip").length).toBeGreaterThan(0);
  });

  test(" strike labels every 100 pts and time labels every 30 min", () => {
    r(createElement(NiftyOiHeatmap, { rows: twoBuckets, bucketMin: 5, widthPts: 500 }));
    const strikeLabels = screen.getAllByTestId("nifty-heatmap-strike-label");
    expect(strikeLabels.length).toBeGreaterThan(0);
    for (const el of strikeLabels) {
      expect(Number(el.textContent?.replace(/,/g, "")) % 100).toBe(0);
    }
    const timeLabels = screen.getAllByTestId("nifty-heatmap-time-label");
    expect(timeLabels.length).toBeGreaterThan(0);
  });

  test("time ticks land on 30-min marks and sit inside the plot", () => {
    r(createElement(NiftyOiHeatmap, { rows: twoBuckets, bucketMin: 5, widthPts: 500 }));
    const labels = screen.getAllByTestId("nifty-heatmap-time-label");
    // Bucket starts are 09:15 / 09:30 / 09:45 → only the :30 mark ticks.
    expect(labels.map((el) => el.textContent)).toEqual(["09:30"]);
    for (const el of labels) {
      expect(el.tagName.toLowerCase()).toBe("text");
      expect(el.closest("svg")).not.toBeNull();
      expect(Number(el.getAttribute("y"))).toBeLessThanOrEqual(172);
    }
  });

  test("renders the ΔOI and time axis captions", () => {
    r(createElement(NiftyOiHeatmap, { rows: twoBuckets, bucketMin: 5, widthPts: 500 }));
    expect(screen.getByTestId("nifty-heatmap-oi-label")).toHaveTextContent("ΔOI");
    expect(screen.getByTestId("nifty-heatmap-time-axis")).toHaveTextContent("time");
  });

  test("renders the legend with one labelled swatch per series", () => {
    r(createElement(NiftyOiHeatmap, { rows: twoBuckets, bucketMin: 5, widthPts: 500 }));
    const legend = screen.getByTestId("nifty-heatmap-legend");
    expect(legend).toHaveTextContent("HEATMAP");
    expect(legend).toHaveTextContent("net call-led");
    expect(legend).toHaveTextContent("net put-led");
    expect(legend).toHaveTextContent("spot");
    expect(legend).toHaveTextContent("max pain");
    expect(legend).toHaveTextContent("gamma flip");
    expect(legend).toHaveTextContent("max pain touch");
    expect(legend).toHaveTextContent("opacity = |ΔOI|");
  });

  test("legend is the header bar: above the read and the plot", () => {
    r(createElement(NiftyOiHeatmap, { rows: twoBuckets, bucketMin: 5, widthPts: 500 }));
    const root = screen.getByTestId("nifty-heatmap");
    const legend = screen.getByTestId("nifty-heatmap-legend");
    const read = screen.getByTestId("nifty-heatmap-read");
    const svg = screen.getByTestId("nifty-heatmap-svg");
    const order = Array.from(root.children);
    expect(order.indexOf(legend)).toBe(0);
    expect(order.indexOf(read)).toBe(1);
    expect(order.indexOf(svg)).toBe(2);
    expect(read.textContent).not.toBe("");
  });

  test("legend swatches are solid colour marks, not glyphs", () => {
    r(createElement(NiftyOiHeatmap, { rows: twoBuckets, bucketMin: 5, widthPts: 500 }));
    const ce = screen.getByTestId("nifty-heatmap-legend-ce-swatch");
    const pe = screen.getByTestId("nifty-heatmap-legend-pe-swatch");
    const spot = screen.getByTestId("nifty-heatmap-legend-spot-swatch");
    const mp = screen.getByTestId("nifty-heatmap-legend-maxpain-swatch");
    const flip = screen.getByTestId("nifty-heatmap-legend-flip-swatch");
    const touch = screen.getByTestId("nifty-heatmap-legend-mp-touch-swatch");
    expect(ce).toHaveStyle({ backgroundColor: HEATMAP_CE, width: "8px", height: "8px" });
    expect(pe).toHaveStyle({ backgroundColor: HEATMAP_PE, width: "8px", height: "8px" });
    expect(spot).toHaveStyle({ backgroundColor: HEATMAP_SPOT, width: "12px", height: "2px" });
    expect(mp).toHaveStyle({ borderTopColor: HEATMAP_MP });
    expect(flip).toHaveStyle({ borderTopColor: HEATMAP_FLIP });
    expect(touch).toHaveStyle({ backgroundColor: palette.WARNING });
    for (const el of [ce, pe, spot, mp, flip, touch]) expect(el.textContent).toBe("");
  });

  test("marks spot touching max pain with a dot on the spot line", () => {
    const rows = [
      row(iso(0), 25750, chainAt(STRIKES, 25750, 1000, 1000), { max_pain: 25750 }),
      row(iso(6), 25752, chainAt(STRIKES, 25752, 2000, 1000), { max_pain: 25754 }),
    ];
    r(createElement(NiftyOiHeatmap, { rows, bucketMin: 5, widthPts: 500 }));
    const dots = screen.getAllByTestId("nifty-heatmap-mp-touch");
    expect(dots).toHaveLength(2);
    for (const dot of dots) {
      expect(dot.tagName.toLowerCase()).toBe("circle");
      expect(dot).toHaveAttribute("r", "3.5");
      expect(dot.getAttribute("fill")).toBe(palette.WARNING);
      expect(dot.getAttribute("stroke")).toBe("#000");
      expect(dot.querySelector("title")?.textContent).toMatch(/^Max pain touch /);
    }
  });

  test("marks a bucket whose earlier row touched, at that row's spot", () => {
    // Bucket 0 = 09:15–09:19: 09:15 touches (25,700 = max pain), the 09:19
    // representative does not (25,800). The circle must sit at 25,700, i.e.
    // below the representative spot on screen (larger cy).
    const rows = [
      row(iso(0), 25700, chainAt(STRIKES, 25700, 1000, 1000), { max_pain: 25700 }),
      row(iso(4), 25800, chainAt(STRIKES, 25800, 2000, 1000), { max_pain: 25700 }),
    ];
    r(createElement(NiftyOiHeatmap, { rows, bucketMin: 5, widthPts: 500 }));
    const dots = screen.getAllByTestId("nifty-heatmap-mp-touch");
    expect(dots).toHaveLength(1);
    expect(dots[0].querySelector("title")?.textContent).toBe("Max pain touch 25,700 @ 09:19");
    const spotPoints = screen.getByTestId("nifty-heatmap-spotline").getAttribute("points") ?? "";
    const repCy = Number(spotPoints.trim().split(" ").pop()?.split(",")[1]);
    expect(Number(dots[0].getAttribute("cy"))).toBeGreaterThan(repCy);
  });

  test("no dot when spot is far from max pain", () => {
    const rows = [
      row(iso(0), 25750, chainAt(STRIKES, 25750, 1000, 1000), { max_pain: 25500 }),
      row(iso(6), 25760, chainAt(STRIKES, 25760, 2000, 1000), { max_pain: 25500 }),
    ];
    r(createElement(NiftyOiHeatmap, { rows, bucketMin: 5, widthPts: 500 }));
    expect(screen.queryAllByTestId("nifty-heatmap-mp-touch")).toHaveLength(0);
  });

  test("renders the plain-English read for the tape", () => {
    const rows = [
      row(iso(0), 25750, chainAt(STRIKES, 25750, 1000, 1000), { max_pain: 25700 }),
      row(
        iso(6),
        25760,
        {
          ...chainAt(STRIKES, 25760, 1000, 1000),
          "25750": [10, 12, 6000, 1000, 1, 1],
          "25700": [10, 12, 1000, 5000, 1, 1],
        },
        { max_pain: 25800 },
      ),
    ];
    r(createElement(NiftyOiHeatmap, { rows, bucketMin: 5, widthPts: 500 }));
    expect(screen.getByTestId("nifty-heatmap-read")).toHaveTextContent(
      "Call writers pressing 25,750 · put buyers at 25,700 · spot 25,760 below max pain 25,800",
    );
  });

  test("empty chain renders the muted state", () => {
    r(createElement(NiftyOiHeatmap, { rows: [{ t: T0, spot: 25750 }] }));
    expect(screen.getByTestId("nifty-heatmap-empty")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-heatmap-empty-text")).toHaveTextContent("no tape chain");
  });
});
