// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";

import { afterEach, describe, expect, test } from "vitest";
import { screen, cleanup } from "@solidjs/testing-library";
import * as palette from "@/ui/palette";
import { buildOiHeatmap, type HeatmapTapeRow } from "./niftyOiHeatmap";
import { NiftyOiHeatmap } from "./NiftyOiHeatmap";
import { clockLabel, clockMinutes } from "./tapeRange";
import { chainAt, isoAt, r } from "./reportTestFixtures";

afterEach(() => {
  cleanup();
});

function row(t: string, spot: number, chain: HeatmapTapeRow["chain"], extra: Partial<HeatmapTapeRow> = {}): HeatmapTapeRow {
  return { t, spot, max_pain: 25700, flip: 25750, atm_strike: 25750, chain, ...extra };
}

const STRIKES = [25650, 25700, 25750, 25800, 25850];

describe("buildOiHeatmap", () => {
  test("groups rows into bucketMin buckets", () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      row(isoAt(i), 25750 + i, chainAt(STRIKES, 1000, 1000)),
    );
    const m = buildOiHeatmap(rows, { bucketMin: 5, widthPts: 500 });
    expect(m.empty).toBe(false);
    expect(m.buckets).toHaveLength(2);
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
    expect(m.buckets[0].spot).toBe(25800);
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
    expect(m.buckets[0].label).toBe("09:19");
  });
});

describe("shared tape clock helpers", () => {
  test("bucket labels and axis starts match the shared tape clock", () => {
    const rows = [
      row(isoAt(0), 25750, chainAt(STRIKES, 1000, 1000)),
      row(isoAt(5), 25760, chainAt(STRIKES, 1000, 1000)),
      row(isoAt(10), 25770, chainAt(STRIKES, 1000, 1000)),
    ];
    const m = buildOiHeatmap(rows, { bucketMin: 5 });
    expect(m.buckets.map((b) => b.label)).toEqual(rows.map((r) => clockLabel(r.t)));
    expect(m.buckets.map((b) => b.startLabel)).toEqual(["09:15", "09:20", "09:25"]);
  });

  test("an out-of-range clock does not invent a bucket position", () => {
    const rows = [row("2026-10-23T99:00:00+05:30", 25750, chainAt(STRIKES, 1000, 1000))];
    const m = buildOiHeatmap(rows, { bucketMin: 5 });
    expect(clockMinutes("99:00")).toBeNull();
    expect(m.buckets[0].startLabel).toBe("00:00");
    expect(m.buckets[0].label).toBe("99:00");
  });
});

describe("trimmed tape chain (server payload, spot ± 500)", () => {
  // `GET /api/reports/nifty/tape` serves each row's chain trimmed to
  // spot ± TAPE_CHAIN_WINDOW_PTS (500) — the full ~142-strike chain was 85.7%
  // of a 2.29 MB payload. The heatmap must build the IDENTICAL cells for the
  // strikes it renders; a far strike was never rendered, so its absence is
  // silent. A trimmed row also carries `chain_truncated` / `chain_center` /
  // `chain_window_pts`, which the builder ignores.
  const WINDOW = 500;
  const FULL = Array.from({ length: 101 }, (_, i) => 25750 + (i - 50) * 50);
  const visible = FULL.filter((s) => Math.abs(s - 25760) <= WINDOW);
  const trimmedChain = (ceOi: number, peOi: number) =>
    chainAt(visible, ceOi, peOi);

  test("trimmed and full chains build the same heatmap for the visible strikes", () => {
    const full = [
      row(isoAt(0), 25750, chainAt(FULL, 1000, 1000)),
      row(isoAt(6), 25760, chainAt(FULL, 2000, 1000)),
    ];
    const trimmed = [
      {
        ...row(isoAt(0), 25750, trimmedChain(1000, 1000)),
        chain_truncated: true,
        chain_center: 25750,
        chain_window_pts: WINDOW,
      } as HeatmapTapeRow,
      {
        ...row(isoAt(6), 25760, trimmedChain(2000, 1000)),
        chain_truncated: true,
        chain_center: 25760,
        chain_window_pts: WINDOW,
      } as HeatmapTapeRow,
    ];

    const a = buildOiHeatmap(full, { bucketMin: 5, widthPts: WINDOW });
    const b = buildOiHeatmap(trimmed, { bucketMin: 5, widthPts: WINDOW });

    expect(b.strikes).toEqual(a.strikes);
    expect(b.buckets).toEqual(a.buckets);
    expect(b.cells).toEqual(a.cells);
    expect(b.maxAbs).toBe(a.maxAbs);
    expect(b.empty).toBe(false);
  });

  test("a trimmed chain does not invent or shift visible strikes", () => {
    const m = buildOiHeatmap(
      [row(isoAt(0), 25760, trimmedChain(1000, 1000))],
      { bucketMin: 5, widthPts: WINDOW },
    );
    expect(m.strikes).toEqual(visible);
    // The far strikes are gone from the payload AND from the model.
    expect(m.strikes).not.toContain(25760 - 2500);
    expect(m.strikes).not.toContain(25760 + 2500);
  });

  test("the payload marker fields are inert to the builder", () => {
    const plain = row(isoAt(0), 25760, trimmedChain(1000, 1000));
    const marked = {
      ...plain,
      chain_truncated: true,
      chain_center: 25760,
      chain_window_pts: WINDOW,
    } as HeatmapTapeRow;
    expect(buildOiHeatmap([marked], { bucketMin: 5, widthPts: WINDOW }))
      .toEqual(buildOiHeatmap([plain], { bucketMin: 5, widthPts: WINDOW }));
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
    r(() => <NiftyOiHeatmap {...{ rows: twoBuckets, bucketMin: 5, widthPts: 500 }} />);
    const m = buildOiHeatmap(twoBuckets, { bucketMin: 5, widthPts: 500 });
    const canvas = screen.getByTestId("nifty-heatmap-canvas");
    expect(canvas.tagName.toLowerCase()).toBe("canvas");
    expect(canvas.getAttribute("data-cells")).toBe(String(m.cells.length));
    expect(m.cells.length).toBe(m.buckets.length * m.strikes.length);
    expect(screen.queryAllByTestId("nifty-heatmap-cell")).toHaveLength(0);
    expect(screen.getByTestId("nifty-heatmap-spotline")).toBeInTheDocument();
  });

  test("canvas sits behind the SVG box and takes no pointer events", () => {
    r(() => <NiftyOiHeatmap {...{ rows: twoBuckets, bucketMin: 5, widthPts: 500 }} />);
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
    r(() => <NiftyOiHeatmap {...{ rows, bucketMin: 1, widthPts: 500 }} />);
    const m = buildOiHeatmap(rows, { bucketMin: 1, widthPts: 500 });
    expect(m.cells.length).toBeGreaterThan(1000);
    expect(screen.getByTestId("nifty-heatmap-canvas").getAttribute("data-cells")).toBe(
      String(m.cells.length),
    );
    expect(screen.queryAllByTestId("nifty-heatmap-cell")).toHaveLength(0);
  });

  test("marks max-pain and flip dashed lines", () => {
    r(() => <NiftyOiHeatmap {...{ rows: twoBuckets, bucketMin: 5, widthPts: 500 }} />);
    const mp = screen.getAllByTestId("nifty-heatmap-maxpain");
    expect(mp.length).toBeGreaterThan(0);
    for (const line of mp) expect(line.getAttribute("stroke")).toBe(palette.LEVEL_MAX_PAIN);
    expect(screen.getAllByTestId("nifty-heatmap-flip").length).toBeGreaterThan(0);
  });

  test(" strike labels every 100 pts and time labels every 30 min", () => {
    r(() => <NiftyOiHeatmap {...{ rows: twoBuckets, bucketMin: 5, widthPts: 500 }} />);
    const strikeLabels = screen.getAllByTestId("nifty-heatmap-strike-label");
    expect(strikeLabels.length).toBeGreaterThan(0);
    for (const el of strikeLabels) {
      expect(Number(el.textContent?.replace(/,/g, "")) % 100).toBe(0);
    }
    const timeLabels = screen.getAllByTestId("nifty-heatmap-time-label");
    expect(timeLabels.length).toBeGreaterThan(0);
  });

  test("time ticks land on 30-min marks and sit inside the plot", () => {
    r(() => <NiftyOiHeatmap {...{ rows: twoBuckets, bucketMin: 5, widthPts: 500 }} />);
    const labels = screen.getAllByTestId("nifty-heatmap-time-label");
    expect(labels.map((el) => el.textContent)).toEqual(["09:30"]);
    for (const el of labels) {
      expect(el.tagName.toLowerCase()).toBe("text");
      expect(el.closest("svg")).not.toBeNull();
      expect(Number(el.getAttribute("y"))).toBeLessThanOrEqual(172);
    }
  });

  test("renders the ΔOI and time axis captions", () => {
    r(() => <NiftyOiHeatmap {...{ rows: twoBuckets, bucketMin: 5, widthPts: 500 }} />);
    expect(screen.getByTestId("nifty-heatmap-oi-label")).toHaveTextContent("ΔOI");
    expect(screen.getByTestId("nifty-heatmap-time-axis")).toHaveTextContent("time");
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

describe("padded leading bucket", () => {
  const lateRows = [
    row(isoAt(15), 25750, chainAt(STRIKES, 1000, 1000)),
    row(isoAt(20), 25760, chainAt(STRIKES, 2000, 1000)),
  ];

  test("cells render for the padded buckets without throwing", () => {
    const model = buildOiHeatmap(lateRows, { bucketMin: 5, widthPts: 500, startTime: isoAt(0) });
    expect(model.buckets.slice(0, 3).every((b) => b.spot === null)).toBe(true);

    r(() => <NiftyOiHeatmap rows={lateRows} bucketMin={5} widthPts={500} startTime={isoAt(0)} />);

    expect(screen.queryByTestId("nifty-heatmap-empty")).not.toBeInTheDocument();
    // The canvas carries every cell in the model, padded buckets included.
    expect(Number(screen.getByTestId("nifty-heatmap-canvas").getAttribute("data-cells"))).toBe(
      model.cells.length,
    );
    expect(model.cells.filter((c) => c.bucket < 3).length).toBe(3 * STRIKES.length);
  });

  test("padded buckets are excluded from the spot line but not from the axis", () => {
    r(() => <NiftyOiHeatmap rows={lateRows} bucketMin={5} widthPts={500} startTime={isoAt(0)} />);
    const points = (screen.getByTestId("nifty-heatmap-spotline").getAttribute("points") ?? "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    expect(points).toHaveLength(2);
    expect(screen.getByTestId("nifty-heatmap-svg")).toBeInTheDocument();
  });
});
