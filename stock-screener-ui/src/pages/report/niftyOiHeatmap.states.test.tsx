// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";

import { afterEach, describe, expect, test, vi } from "vitest";
import { screen, cleanup } from "@solidjs/testing-library";
import * as palette from "@/ui/palette";
import { TZ_IST } from "@/config/constants";
import type { NiftyReport } from "@/types/niftyReport";
import { buildOiHeatmap, heatmapReadText, readHeatmap, type HeatmapTapeRow } from "./niftyOiHeatmap";
import { HEATMAP_FLIP, HEATMAP_SPOT, NiftyOiHeatmap } from "./NiftyOiHeatmap";
import { HeatmapReadout } from "./NiftyOiHeatmap.legend";
import { ReportKpiHero } from "./ReportKpiHero";
import { NiftyWallsCard } from "./NiftyWallsCard";
import { walls as wallsFixture } from "./NiftyWallsCard.fixtures";
import { REPORT_FONT } from "./reportTokens";
import { chainAt, isoAt, r } from "./reportTestFixtures";

// The report store is the canonical spot source. Test fixtures for the walls
// payload and the tape deliberately disagree with it so a surface that falls
// back to its own payload is caught by the assertions below.
const sharedSpot = vi.hoisted(() => ({ report: null as NiftyReport | null }));
vi.mock("./ReportContext", () => ({
  useNiftyReport: () => ({ data: { report: () => sharedSpot.report } }),
}));

const CANONICAL_SPOT = 22_363.35;
const CANONICAL_SNAPSHOT_AT = "2026-11-23T11:44:00+05:30";
// The SUT prints the snapshot in the runner's local zone; pin that zone and
// derive the expected clock from the same fixture instant.
const CANONICAL_AS_OF = new Intl.DateTimeFormat("en-IN", {
  timeZone: TZ_IST,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
}).format(new Date(CANONICAL_SNAPSHOT_AT));
const canonicalReport = {
  mode: "live",
  date: "2026-11-23",
  spot: CANONICAL_SPOT,
  snapshotAt: CANONICAL_SNAPSHOT_AT,
  regime: { verdict: "range" },
  gex: { regime: "short", zeroCross: 22_400, strikes: [] },
  walls: {
    calls: [{ strike: 22_400, oi: 1000 }],
    puts: [{ strike: 22_300, oi: 1000 }],
  },
  strikes: [],
} as unknown as NiftyReport;

afterEach(() => {
  cleanup();
});

function row(t: string, spot: number, chain: HeatmapTapeRow["chain"], extra: Partial<HeatmapTapeRow> = {}): HeatmapTapeRow {
  return { t, spot, max_pain: 25700, flip: 25750, atm_strike: 25750, chain, ...extra };
}

const STRIKES = [25650, 25700, 25750, 25800, 25850];
const READ_ROWS = [
  row(isoAt(0), 25750, chainAt(STRIKES, 1000, 1000), { max_pain: 25700 }),
  row(
    isoAt(6),
    25760,
    {
      ...chainAt(STRIKES, 1000, 1000),
      "25750": [10, 12, 6000, 1000, 1, 1],
      "25700": [10, 12, 1000, 5000, 1, 1],
    },
    { max_pain: 25800 },
  ),
];

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

describe("premium evidence (buyer vs writer)", () => {
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
    const rows = [row(isoAt(15), 25750, chainAt(STRIKES, 1000, 1000))];
    const m = buildOiHeatmap(rows, { bucketMin: 5, widthPts: 500, startTime: isoAt(0) });
    expect(m.buckets[0].startLabel).toBe("09:15");
    expect(m.buckets.length).toBeGreaterThan(1);
    expect(m.buckets[0].spot).toBeNull();
    expect(m.buckets[1].spot).toBeNull();
    expect(m.buckets[2].spot).toBeNull();
    expect(m.buckets[3].spot).toBe(25750);
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
});

describe("premium evidence edge cases", () => {
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
    expect(m.buckets.every((b) => b.spot !== null)).toBe(true);
    expect(m.buckets[0].spot).toBe(25750);
  });

  test("first row before 09:15 ignores the later startTime — axis keeps the tape's start", () => {
    const rows = [row("2026-10-14T09:10:00+05:30", 25750, chainAt(STRIKES, 1000, 1000))];
    const m = buildOiHeatmap(rows, { bucketMin: 5, widthPts: 500, startTime: isoAt(0) });
    expect(m.buckets[0].startLabel).toBe("09:10");
    expect(m.buckets[0].spot).toBe(25750);
    expect(m.buckets).toHaveLength(1);
  });

  test("an unparseable startTime is ignored and the axis begins at the tape", () => {
    const rows = [row(isoAt(15), 25750, chainAt(STRIKES, 1000, 1000))];
    const withGarbage = buildOiHeatmap(rows, { bucketMin: 5, widthPts: 500, startTime: "not-a-time" });
    const without = buildOiHeatmap(rows, { bucketMin: 5, widthPts: 500 });
    expect(withGarbage.buckets.map((b) => b.startLabel)).toEqual(without.buckets.map((b) => b.startLabel));
    expect(withGarbage.buckets[0].startLabel).toBe("09:30");
    expect(withGarbage.buckets[0].spot).toBe(25750);
  });
});

describe("NiftyOiHeatmap render", () => {
  const twoBuckets = [
    row(isoAt(0), 25750, chainAt(STRIKES, 1000, 1000)),
    row(isoAt(1), 25752, chainAt(STRIKES, 1100, 1050)),
    row(isoAt(15), 25760, chainAt(STRIKES, 4000, 1200)),
    row(isoAt(30), 25780, chainAt(STRIKES, 4500, 1300)),
  ];

  test("the legend names only marks the heatmap draws — MP, not CW/PW", () => {
    r(() => <NiftyOiHeatmap {...{ rows: twoBuckets, bucketMin: 5, widthPts: 500 }} />);
    const legend = screen.getByTestId("nifty-heatmap-legend");
    expect(legend).toHaveTextContent("MP max pain");
    expect(legend).toHaveTextContent("spot");
    expect(legend).toHaveTextContent("gamma flip");
    expect(legend).not.toHaveTextContent("CW call wall");
    expect(legend).not.toHaveTextContent("PW put wall");
    expect(screen.queryByTestId("nifty-heatmap-legend-call-wall-swatch")).toBeNull();
    expect(screen.queryByTestId("nifty-heatmap-legend-put-wall-swatch")).toBeNull();
    expect(screen.getByTestId("nifty-heatmap-legend-maxpain-swatch")).toHaveStyle({
      borderTopColor: palette.LEVEL_MAX_PAIN,
    });
  });

  test("max-pain and side tokens have the canonical palette values", () => {
    expect(palette.LEVEL_MAX_PAIN).toBe(palette.WARNING);
    expect(palette.OI_CALL).toBe(palette.INFO);
    expect(palette.OI_PUT).toBe(palette.WARNING);
    expect(palette.OI_CALL).not.toBe(palette.OI_PUT);
  });

  test("renders the legend with one labelled swatch per series", () => {
    r(() => <NiftyOiHeatmap {...{ rows: twoBuckets, bucketMin: 5, widthPts: 500 }} />);
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
    r(() => <NiftyOiHeatmap {...{ rows: twoBuckets, bucketMin: 5, widthPts: 500 }} />);
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

  test("the header separates 12px labels from 13px read values with deliberate padding", () => {
    r(() => <NiftyOiHeatmap {...{ rows: twoBuckets, bucketMin: 5, widthPts: 500 }} />);
    const legend = screen.getByTestId("nifty-heatmap-legend");
    const read = screen.getByTestId("nifty-heatmap-read");
    expect(legend.className).toContain("px-3");
    expect(legend.className).toContain("py-1");
    expect(read.className).toContain("px-3");
    expect(screen.getByTestId("nifty-heatmap-legend-title").style.fontSize).toBe(
      `${REPORT_FONT.micro}px`,
    );
    expect(screen.getByTestId("nifty-heatmap-read-label").className).toContain("text-ui-micro");

    const spot = screen.getByTestId("nifty-heatmap-read-spot");
    expect(spot.style.fontSize).toBe(`${REPORT_FONT.body}px`);
    expect(spot.querySelector("span")?.className).toContain("text-ui-micro");
    const ce = screen.getByTestId("nifty-heatmap-read-ce");
    expect(ce.querySelector(".text-ui-micro")?.textContent).toBe("CE");
    expect(ce.querySelector(".text-ui-body")?.textContent).toMatch(/[\d,]+/);
  });

  test("legend swatches are solid colour marks, not glyphs", () => {
    r(() => <NiftyOiHeatmap {...{ rows: twoBuckets, bucketMin: 5, widthPts: 500 }} />);
    const ce = screen.getByTestId("nifty-heatmap-legend-ce-swatch");
    const pe = screen.getByTestId("nifty-heatmap-legend-pe-swatch");
    const spot = screen.getByTestId("nifty-heatmap-legend-spot-swatch");
    const mp = screen.getByTestId("nifty-heatmap-legend-maxpain-swatch");
    const flip = screen.getByTestId("nifty-heatmap-legend-flip-swatch");
    const touch = screen.getByTestId("nifty-heatmap-legend-mp-touch-swatch");
    expect(ce).toHaveStyle({ backgroundColor: palette.OI_CALL });
    expect(ce).toHaveClass("w-2", "h-2");
    expect(pe).toHaveStyle({ backgroundColor: palette.OI_PUT });
    expect(pe).toHaveClass("w-2", "h-2");
    expect(spot).toHaveStyle({ backgroundColor: HEATMAP_SPOT });
    expect(spot).toHaveClass("w-3", "h-0.5");
    expect(mp).toHaveStyle({ borderTopColor: palette.LEVEL_MAX_PAIN });
    expect(flip).toHaveStyle({ borderTopColor: HEATMAP_FLIP });
    expect(touch).toHaveStyle({ backgroundColor: palette.LEVEL_MAX_PAIN });
    for (const el of [ce, pe, spot, mp, flip, touch]) expect(el.textContent).toBe("");
  });

  test("renders the plain-English read for the tape", () => {
    r(() => <NiftyOiHeatmap {...{ rows: READ_ROWS, bucketMin: 5, widthPts: 500 }} />);
    expect(screen.getByTestId("nifty-heatmap-read")).toHaveTextContent(
      "CE OI build at 25,750 · PE OI build at 25,700 · spot 25,760 below max pain 25,800",
    );
  });

  test("empty chain renders the muted state", () => {
    r(() => <NiftyOiHeatmap {...{ rows: [{ t: isoAt(0), spot: 25750 }] }} />);
    expect(screen.getByTestId("nifty-heatmap-empty")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-heatmap-empty-text")).toHaveTextContent("no tape chain");
  });
});

describe("one spot source across the report surfaces", () => {
  afterEach(() => {
    sharedSpot.report = null;
  });

  test("hero, walls and heatmap read the report spot field with one source and as-of", () => {
    vi.stubEnv("TZ", TZ_IST);
    try {
      sharedSpot.report = canonicalReport;
      const read = readHeatmap(buildOiHeatmap(READ_ROWS, { bucketMin: 5, widthPts: 500 }));
      r(() => (
        <>
          <ReportKpiHero report={canonicalReport} />
          <NiftyWallsCard walls={wallsFixture} onExpand={() => {}} compact />
          <HeatmapReadout read={read} readText="" readFallback="" />
        </>
      ));

      const hero = screen.getByTestId("nifty-kpi-spot");
      const walls = screen
        .getByTestId("nifty-walls-card")
        .querySelector('[data-walls-stat="spot"]') as HTMLElement;
      const heat = screen.getByTestId("nifty-heatmap-read-spot");

      for (const el of [hero, walls, heat]) {
        expect(el.getAttribute("data-spot-source")).toBe("Snapshot");
        expect(el.getAttribute("data-spot-as-of")).toBe(CANONICAL_AS_OF);
      }
      expect(hero).toHaveTextContent("22,363");
      expect(walls).toHaveTextContent("22,363.35");
      expect(heat).toHaveTextContent("22,363");
      expect(walls.textContent).not.toContain("74,096");
      expect(heat.textContent).not.toContain("25,760");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
