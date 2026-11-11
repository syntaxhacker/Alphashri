// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { createElement } from "react";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import * as palette from "@/ui/palette";
import { buildOiHeatmap, heatmapReadText, readHeatmap, type HeatmapTapeRow } from "./niftyOiHeatmap";
import { HEATMAP_CE, HEATMAP_FLIP, HEATMAP_MP, HEATMAP_PE, HEATMAP_SPOT, NiftyOiHeatmap } from "./NiftyOiHeatmap";
import { chainAt, isoAt, r } from "./reportTestFixtures";

afterEach(() => {
  cleanup();
});

function row(t: string, spot: number, chain: HeatmapTapeRow["chain"], extra: Partial<HeatmapTapeRow> = {}): HeatmapTapeRow {
  return { t, spot, max_pain: 25700, flip: 25750, atm_strike: 25750, chain, ...extra };
}

const STRIKES = [25650, 25700, 25750, 25800, 25850];
// CE +5000 build at 25750, PE +4000 build at 25700, spot below max pain — used by
// the readHeatmap unit tests and the JSX read rendering test.
const READ_ROWS = [
  row(isoAt(0), 25750, chainAt(STRIKES, 1000, 1000), { max_pain: 25700 }),
  row(
    isoAt(6),
    25760,
    {
      ...chainAt(STRIKES, 1000, 1000),
      "25750": [10, 12, 6000, 1000, 1, 1], // CE +5000 → call build
      "25700": [10, 12, 1000, 5000, 1, 1], // PE +4000 → put build
    },
    { max_pain: 25800 },
  ),
];

describe("buildOiHeatmap", () => {
  test("groups rows into bucketMin buckets", () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      row(isoAt(i), 25750 + i, chainAt(STRIKES, 1000, 1000)),
    );
    const m = buildOiHeatmap(rows, { bucketMin: 5, widthPts: 500 });
    expect(m.empty).toBe(false);
    expect(m.buckets).toHaveLength(2);
    // Bucket label = last row in the bucket (latest snapshot).
    expect(m.buckets[0].label).toBe("09:19");
    expect(m.buckets[1].label).toBe("09:24");
  });

  test("first bucket cells are flat with null deltas", () => {
    const rows = [row(isoAt(0), 25750, chainAt(STRIKES, 1000, 1000)), row(isoAt(6), 25760, chainAt(STRIKES, 2000, 1000))];
    const m = buildOiHeatmap(rows, { bucketMin: 5 });
    const first = m.cells.filter((c) => c.bucket === 0);
    expect(first.length).toBeGreaterThan(0);
    expect(first.every((c) => c.ceDoi === null && c.peDoi === null && c.sign === "flat")).toBe(true);
  });

  test("CE build reads red, PE build reads green", () => {
    const rows = [
      row(isoAt(0), 25750, chainAt(STRIKES, 1000, 1000)),
      row(isoAt(6), 25760, chainAt([25650, 25750], 5000, 1000)),
    ];
    const m = buildOiHeatmap(rows, { bucketMin: 5, widthPts: 500 });
    const b1 = m.cells.filter((c) => c.bucket === 1);
    expect(b1.find((c) => c.strike === 25750)?.sign).toBe("ce");
    // PE-heavy strike: rebuild with PE dominance
    const rows2 = [
      row(isoAt(0), 25750, chainAt(STRIKES, 1000, 1000)),
      row(isoAt(6), 25760, { ...chainAt(STRIKES, 1000, 1000), "25850": [10, 12, 1000, 9000, 1, 1] }),
    ];
    const m2 = buildOiHeatmap(rows2, { bucketMin: 5, widthPts: 500 });
    expect(m2.cells.find((c) => c.bucket === 1 && c.strike === 25850)?.sign).toBe("pe");
  });

  test("delta arithmetic is current minus previous bucket", () => {
    const rows = [
      row(isoAt(0), 25750, chainAt([25750], 1000, 2000)),
      row(isoAt(6), 25760, chainAt([25750], 4000, 1500)),
    ];
    const m = buildOiHeatmap(rows, { bucketMin: 5, widthPts: 500 });
    const cell = m.cells.find((c) => c.bucket === 1 && c.strike === 25750);
    expect(cell?.ceDoi).toBe(3000);
    expect(cell?.peDoi).toBe(-500);
  });

  test("intensity normalizes to the max |ΔOI|", () => {
    const rows = [
      row(isoAt(0), 25750, chainAt(STRIKES, 1000, 1000)),
      row(isoAt(6), 25760, {
        ...chainAt(STRIKES, 1000, 1000),
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
      row(isoAt(0), 25750, chainAt(wide, 1000, 1000)),
      row(isoAt(6), 25760, chainAt(wide, 2000, 1000)),
    ];
    const m = buildOiHeatmap(rows, { bucketMin: 5, widthPts: 500 });
    expect(m.strikes).not.toContain(24000);
    expect(m.strikes).not.toContain(27500);
    expect(m.strikes).toContain(25750);
  });

  test("missing chain yields the empty model", () => {
    const rows: HeatmapTapeRow[] = [
      { t: isoAt(0), spot: 25750 },
      { t: isoAt(6), spot: 25760, chain: {} },
    ];
    const m = buildOiHeatmap(rows);
    expect(m.empty).toBe(true);
    expect(m.cells).toHaveLength(0);
  });

  test("empty input and bad spots are empty", () => {
    expect(buildOiHeatmap([]).empty).toBe(true);
    expect(buildOiHeatmap([{ t: isoAt(0), spot: 0 }]).empty).toBe(true);
  });

  test("carries spot, max-pain and flip per bucket", () => {
    const rows = [
      row(isoAt(0), 25750, chainAt(STRIKES, 1000, 1000), { max_pain: 25700, flip: 25800 }),
      row(isoAt(6), 25760, chainAt(STRIKES, 2000, 1000), { max_pain: 25800, flip: 25700 }),
    ];
    const m = buildOiHeatmap(rows, { bucketMin: 5 });
    expect(m.buckets[1].spot).toBe(25760);
    expect(m.buckets[1].maxPain).toBe(25800);
    expect(m.buckets[1].flip).toBe(25700);
  });

  test("flags a bucket when an earlier row (not the representative) touches max pain", () => {
    const rows = [
      row(isoAt(0), 25700, chainAt(STRIKES, 1000, 1000), { max_pain: 25700 }),
      row(isoAt(4), 25800, chainAt(STRIKES, 2000, 1000), { max_pain: 25700 }),
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
      row(isoAt(0), 25750, chainAt(STRIKES, 1000, 1000), { max_pain: 25500 }),
      row(isoAt(4), 25800, chainAt(STRIKES, 2000, 1000), { max_pain: 25500 }),
    ];
    const m = buildOiHeatmap(rows, { bucketMin: 5, widthPts: 500 });
    expect(m.buckets[0].touch).toBeNull();
  });

  test("picks the closest touching row when several touch", () => {
    const rows = [
      row(isoAt(0), 25708, chainAt(STRIKES, 1000, 1000), { max_pain: 25700 }),
      row(isoAt(2), 25701, chainAt(STRIKES, 1500, 1000), { max_pain: 25700 }),
      row(isoAt(4), 25800, chainAt(STRIKES, 2000, 1000), { max_pain: 25700 }),
    ];
    const m = buildOiHeatmap(rows, { bucketMin: 5, widthPts: 500 });
    expect(m.buckets[0].touch).toMatchObject({ spot: 25701, distance: 1, label: "09:17" });
  });

  test("bucket start labels are the wall-clock bucket starts", () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      row(isoAt(i), 25750, chainAt(STRIKES, 1000, 1000)),
    );
    const m = buildOiHeatmap(rows, { bucketMin: 5 });
    expect(m.buckets.map((b) => b.startLabel)).toEqual(["09:15", "09:20"]);
    // The representative label stays the last row of the bucket.
    expect(m.buckets[0].label).toBe("09:19");
  });
});

describe("heatmap read", () => {
  test("picks the largest CE and PE builds and compares spot to max pain", () => {
    const read = readHeatmap(buildOiHeatmap(READ_ROWS, { bucketMin: 5, widthPts: 500 }));
    expect(read.ceStrike).toBe(25750);
    expect(read.ceDoi).toBe(5000);
    expect(read.peStrike).toBe(25700);
    expect(read.peDoi).toBe(4000);
    expect(read.maxPain).toBe(25800);
    expect(read.spotVsMaxPain).toBe("below");
  });

  test("renders the one-line read", () => {
    const read = readHeatmap(buildOiHeatmap(READ_ROWS, { bucketMin: 5, widthPts: 500 }));
    expect(heatmapReadText(read)).toBe(
      "CE OI build at 25,750 · PE OI build at 25,700 · spot 25,760 below max pain 25,800",
    );
  });

  test("reads above max pain when spot is higher", () => {
    const rows = [
      row(isoAt(0), 25750, chainAt(STRIKES, 1000, 1000), { max_pain: 25700 }),
      row(isoAt(6), 25760, chainAt(STRIKES, 1000, 1000), { max_pain: 25700 }),
    ];
    const read = readHeatmap(buildOiHeatmap(rows, { bucketMin: 5 }));
    expect(read.spotVsMaxPain).toBe("above");
    expect(heatmapReadText(read)).toBe("spot 25,760 above max pain 25,700");
  });
});

describe("NiftyOiHeatmap render", () => {
  const twoBuckets = [
    row(isoAt(0), 25750, chainAt(STRIKES, 1000, 1000)),
    row(isoAt(1), 25752, chainAt(STRIKES, 1100, 1050)),
    row(isoAt(15), 25760, chainAt(STRIKES, 4000, 1200)),
    row(isoAt(30), 25780, chainAt(STRIKES, 4500, 1300)),
  ];

  test("paints the cells on one canvas instead of a rect per bucket × strike", () => {
    r(createElement(NiftyOiHeatmap, { rows: twoBuckets, bucketMin: 5, widthPts: 500 }));
    const m = buildOiHeatmap(twoBuckets, { bucketMin: 5, widthPts: 500 });
    const canvas = screen.getByTestId("nifty-heatmap-canvas");
    expect(canvas.tagName.toLowerCase()).toBe("canvas");
    expect(canvas.getAttribute("data-cells")).toBe(String(m.cells.length));
    expect(m.cells.length).toBe(m.buckets.length * m.strikes.length);
    // No per-cell DOM nodes survive — the paint lives in the bitmap.
    expect(screen.queryAllByTestId("nifty-heatmap-cell")).toHaveLength(0);
    expect(screen.getByTestId("nifty-heatmap-spotline")).toBeInTheDocument();
  });

  test("canvas sits behind the SVG box and takes no pointer events", () => {
    r(createElement(NiftyOiHeatmap, { rows: twoBuckets, bucketMin: 5, widthPts: 500 }));
    const canvas = screen.getByTestId("nifty-heatmap-canvas");
    expect(canvas.style.position).toBe("absolute");
    expect(canvas.style.pointerEvents).toBe("none");
    expect(canvas.getAttribute("aria-hidden")).toBe("true");
    const svg = screen.getByTestId("nifty-heatmap-svg");
    // The SVG stretches the viewBox onto its box, so the canvas overlay lands
    // on the same geometry the marks are drawn in.
    expect(svg.getAttribute("preserveAspectRatio")).toBe("none");
    expect(Number(svg.style.zIndex)).toBeGreaterThan(Number(canvas.style.zIndex || 0));
  });

  test("a 1-minute ±500 tape stays one canvas node, not thousands of rects", () => {
    const wide = Array.from({ length: 21 }, (_, i) => 24750 + i * 50);
    const rows = Array.from({ length: 121 }, (_, i) =>
      row(isoAt(i), 25750, chainAt(wide, 1000 + i, 1000 + i)),
    );
    r(createElement(NiftyOiHeatmap, { rows, bucketMin: 1, widthPts: 500 }));
    const m = buildOiHeatmap(rows, { bucketMin: 1, widthPts: 500 });
    expect(m.cells.length).toBeGreaterThan(1000);
    expect(screen.getByTestId("nifty-heatmap-canvas").getAttribute("data-cells")).toBe(
      String(m.cells.length),
    );
    expect(screen.queryAllByTestId("nifty-heatmap-cell")).toHaveLength(0);
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
    expect(ce).toHaveStyle({ backgroundColor: HEATMAP_CE });
    expect(ce).toHaveClass("w-2", "h-2");
    expect(pe).toHaveStyle({ backgroundColor: HEATMAP_PE });
    expect(pe).toHaveClass("w-2", "h-2");
    expect(spot).toHaveStyle({ backgroundColor: HEATMAP_SPOT });
    expect(spot).toHaveClass("w-3", "h-0.5");
    expect(mp).toHaveStyle({ borderTopColor: HEATMAP_MP });
    expect(flip).toHaveStyle({ borderTopColor: HEATMAP_FLIP });
    expect(touch).toHaveStyle({ backgroundColor: palette.WARNING });
    for (const el of [ce, pe, spot, mp, flip, touch]) expect(el.textContent).toBe("");
  });

  test("marks spot touching max pain with a dot on the spot line", () => {
    const rows = [
      row(isoAt(0), 25750, chainAt(STRIKES, 1000, 1000), { max_pain: 25750 }),
      row(isoAt(6), 25752, chainAt(STRIKES, 2000, 1000), { max_pain: 25754 }),
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
      row(isoAt(0), 25700, chainAt(STRIKES, 1000, 1000), { max_pain: 25700 }),
      row(isoAt(4), 25800, chainAt(STRIKES, 2000, 1000), { max_pain: 25700 }),
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
      row(isoAt(0), 25750, chainAt(STRIKES, 1000, 1000), { max_pain: 25500 }),
      row(isoAt(6), 25760, chainAt(STRIKES, 2000, 1000), { max_pain: 25500 }),
    ];
    r(createElement(NiftyOiHeatmap, { rows, bucketMin: 5, widthPts: 500 }));
    expect(screen.queryAllByTestId("nifty-heatmap-mp-touch")).toHaveLength(0);
  });

  test("renders the plain-English read for the tape", () => {
    r(createElement(NiftyOiHeatmap, { rows: READ_ROWS, bucketMin: 5, widthPts: 500 }));
    expect(screen.getByTestId("nifty-heatmap-read")).toHaveTextContent(
      "CE OI build at 25,750 · PE OI build at 25,700 · spot 25,760 below max pain 25,800",
    );
  });

  test("empty chain renders the muted state", () => {
    r(createElement(NiftyOiHeatmap, { rows: [{ t: isoAt(0), spot: 25750 }] }));
    expect(screen.getByTestId("nifty-heatmap-empty")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-heatmap-empty-text")).toHaveTextContent("no tape chain");
  });
});

describe("heatmap metric", () => {
  test("volume and premium read their own tuple columns", () => {
    const rows = [
      { t: "2026-10-23T09:15:00", spot: 22500, chain: { "22500": [100, 100, 1000, 1000, 5000, 4000] } },
      { t: "2026-10-23T09:16:00", spot: 22500, chain: { "22500": [110, 100, 1200, 1000, 9000, 4000] } },
    ] as never;
    const last = (metric: "oi" | "volume" | "premium") => {
      const m = buildOiHeatmap(rows, { bucketMin: 1, metric });
      return m.cells[m.cells.length - 1];
    };
    expect(last("oi").ceDoi).toBe(200);
    expect(last("volume").ceDoi).toBe(4000);
    expect(last("premium").ceDoi).toBe(10);
  });
});

describe("premium evidence (buyer vs writer)", () => {
  /** One 5m build at 25,750 (CE) and 25,700 (PE); premium deltas are inputs. */
  function readText(cePrem: number, pePrem: number): string {
    const rows: HeatmapTapeRow[] = [
      {
        t: isoAt(0),
        spot: 25750,
        max_pain: 25700,
        chain: {
          "25750": [10, 20, 1000, 1000, 1, 1],
          "25700": [10, 20, 1000, 1000, 1, 1],
        },
      },
      {
        t: isoAt(6),
        spot: 25760,
        max_pain: 25700,
        chain: {
          // CE OI +5000, PE OI +4000; LTP moves by the premium delta.
          "25750": [10 + cePrem, 20, 6000, 1000, 1, 1],
          "25700": [10, 20 + pePrem, 1000, 5000, 1, 1],
        },
      },
    ];
    return heatmapReadText(readHeatmap(buildOiHeatmap(rows, { bucketMin: 5, widthPts: 500 })));
  }

  test("OI up + premium up is buying", () => {
    expect(readText(5, 5)).toBe(
      "call buyers at 25,750 · put buyers at 25,700 · spot 25,760 above max pain 25,700",
    );
  });

  test("OI up + premium down is writing", () => {
    expect(readText(-5, -5)).toBe(
      "call writers at 25,750 · put writers at 25,700 · spot 25,760 above max pain 25,700",
    );
  });

  test("mixed legs name each side independently", () => {
    expect(readText(5, -5)).toContain("call buyers at 25,750");
    expect(readText(5, -5)).toContain("put writers at 25,700");
    expect(readText(-5, 5)).toContain("call writers at 25,750");
    expect(readText(-5, 5)).toContain("put buyers at 25,700");
  });

  test("missing premium evidence falls back to the neutral OI build", () => {
    expect(readText(0, 0)).toBe(
      "CE OI build at 25,750 · PE OI build at 25,700 · spot 25,760 above max pain 25,700",
    );
  });
});

describe("session-anchored time axis", () => {
  test("startTime pads the axis from 09:15 and leaves the missing minutes empty", () => {
    const rows = [row(isoAt(15), 25750, chainAt(STRIKES, 1000, 1000))]; // first tape row 09:30
    const m = buildOiHeatmap(rows, { bucketMin: 5, widthPts: 500, startTime: isoAt(0) });
    expect(m.buckets[0].startLabel).toBe("09:15");
    expect(m.buckets.length).toBeGreaterThan(1);
    // 09:15 / 09:20 / 09:25 are padded empties, 09:30 carries the first row.
    expect(m.buckets[0].spot).toBeNull();
    expect(m.buckets[1].spot).toBeNull();
    expect(m.buckets[2].spot).toBeNull();
    expect(m.buckets[3].spot).toBe(25750);
    // Empty buckets still own one flat cell per strike (the column exists).
    const firstBucketCells = m.cells.filter((c) => c.bucket === 0);
    expect(firstBucketCells).toHaveLength(STRIKES.length);
    expect(firstBucketCells.every((c) => c.ceDoi === null && c.peDoi === null)).toBe(true);
  });

  test("without startTime the axis still begins at the first tape row", () => {
    const rows = [row(isoAt(15), 25750, chainAt(STRIKES, 1000, 1000))];
    const m = buildOiHeatmap(rows, { bucketMin: 5, widthPts: 500 });
    expect(m.buckets[0].startLabel).toBe("09:30");
    expect(m.buckets[0].spot).toBe(25750);
  });

  test("draws the persisted flow-flip vertical guide", () => {
    const rows = [
      row(isoAt(0), 25750, chainAt(STRIKES, 1000, 1000)),
      row(isoAt(6), 25760, chainAt(STRIKES, 2000, 1000)),
    ];
    r(
      createElement(NiftyOiHeatmap, {
        rows,
        bucketMin: 5,
        widthPts: 500,
        startTime: isoAt(0),
        flipAt: isoAt(30),
      }),
    );
    const line = screen.getByTestId("heatmap-flip-line");
    expect(line.tagName.toLowerCase()).toBe("line");
    expect(line.getAttribute("stroke-dasharray")).toBe("3 3");
    expect(line.querySelector("title")?.textContent).toContain("Last 5m flow flip");
    // The guide sits inside the plot, at a bucket centre.
    expect(Number(line.getAttribute("x1"))).toBeGreaterThan(64);
  });
});


describe("premium evidence edge cases", () => {
  /** One 5m bucket pair; OI deltas are caller inputs, premium deltas too. */
  function readWith(opts: {
    ceOi: [number, number];
    peOi: [number, number];
    cePrem: [number, number];
    pePrem: [number, number];
  }): string {
    const rows: HeatmapTapeRow[] = [
      {
        t: isoAt(0),
        spot: 25750,
        max_pain: 25700,
        chain: {
          "25750": [opts.cePrem[0], 20, opts.ceOi[0], 1000, 1, 1],
          "25700": [10, opts.pePrem[0], 1000, opts.peOi[0], 1, 1],
        },
      },
      {
        t: isoAt(6),
        spot: 25760,
        max_pain: 25700,
        chain: {
          "25750": [opts.cePrem[1], 20, opts.ceOi[1], 1000, 1, 1],
          "25700": [10, opts.pePrem[1], 1000, opts.peOi[1], 1, 1],
        },
      },
    ];
    return heatmapReadText(readHeatmap(buildOiHeatmap(rows, { bucketMin: 5, widthPts: 500 })));
  }

  test("premium present but OI flat/negative omits the clauses — never mislabels", () => {
    // CE OI unchanged, PE OI unwinds; both premiums tick up. Neither leg
    // qualifies as a build, so neither may read as "buyers".
    const text = readWith({
      ceOi: [6000, 6000],
      peOi: [5000, 4000],
      cePrem: [10, 15],
      pePrem: [20, 26],
    });
    expect(text).not.toMatch(/call buyers|call writers|put buyers|put writers/);
    expect(text).not.toMatch(/CE OI build|PE OI build/);
    expect(text).toBe("spot 25,760 above max pain 25,700");
  });

  test("premium present but one OI leg negative — only the building leg speaks", () => {
    // CE OI unwinds (short covering) with premium UP — not an OI build, so no
    // call clause even though premium evidence exists. PE OI builds with
    // premium up → put buyers.
    const text = readWith({
      ceOi: [6000, 4800],
      peOi: [3000, 4200],
      cePrem: [10, 16],
      pePrem: [20, 25],
    });
    expect(text).not.toMatch(/call/);
    expect(text).toContain("put buyers at 25,700");
    expect(text).toContain("spot 25,760 above max pain 25,700");
  });
});

describe("session-anchored time axis edge cases", () => {
  test("first row exactly at 09:15 pads nothing", () => {
    const rows = [row(isoAt(0), 25750, chainAt(STRIKES, 1000, 1000)), row(isoAt(6), 25760, chainAt(STRIKES, 2000, 1000))];
    const m = buildOiHeatmap(rows, { bucketMin: 5, widthPts: 500, startTime: isoAt(0) });
    expect(m.buckets.map((b) => b.startLabel)).toEqual(["09:15", "09:20"]);
    // No padded empty leading buckets — every bucket carries a representative.
    expect(m.buckets.every((b) => b.spot !== null)).toBe(true);
    expect(m.buckets[0].spot).toBe(25750);
  });

  test("first row before 09:15 ignores the later startTime — axis keeps the tape's start", () => {
    const rows = [row("2026-10-14T09:10:00+05:30", 25750, chainAt(STRIKES, 1000, 1000))];
    const m = buildOiHeatmap(rows, { bucketMin: 5, widthPts: 500, startTime: isoAt(0) }); // asks for 09:15
    expect(m.buckets[0].startLabel).toBe("09:10");
    expect(m.buckets[0].spot).toBe(25750);
    // No phantom leading bucket was inserted before the tape's own start.
    expect(m.buckets).toHaveLength(1);
  });

  test("an unparseable startTime is ignored and the axis begins at the tape", () => {
    const rows = [row(isoAt(15), 25750, chainAt(STRIKES, 1000, 1000))]; // 09:30
    const withGarbage = buildOiHeatmap(rows, { bucketMin: 5, widthPts: 500, startTime: "not-a-time" });
    const without = buildOiHeatmap(rows, { bucketMin: 5, widthPts: 500 });
    expect(withGarbage.buckets.map((b) => b.startLabel)).toEqual(without.buckets.map((b) => b.startLabel));
    expect(withGarbage.buckets[0].startLabel).toBe("09:30");
    expect(withGarbage.buckets[0].spot).toBe(25750);
  });
});
