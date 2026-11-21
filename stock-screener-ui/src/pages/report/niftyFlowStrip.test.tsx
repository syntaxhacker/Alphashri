// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";

import { afterEach, describe, expect, test } from "vitest";
import { screen, cleanup } from "@solidjs/testing-library";
import { buildFlowEvents, clockLabel, groupFlowRuns, summarizeFlowRuns, type FlowTapeRow } from "./niftyFlowStrip";
import {
  FLOW_BEAR,
  FLOW_BULL,
  FLOW_STRUCT,
  NiftyFlowStrip,
  flowTickPct,
} from "./NiftyFlowStrip";
import { hm, r } from "./reportTestFixtures";

afterEach(() => {
  cleanup();
});

function base(over: Partial<FlowTapeRow> = {}): FlowTapeRow {
  return {
    t: hm(0),
    call_doi: 0,
    put_doi: 0,
    max_pain: 25700,
    atm_strike: 25750,
    walls: { call: 25900, put: 25600 },
    ...over,
  };
}

describe("buildFlowEvents", () => {
  test("fires a burst at |ΔOI| ≥ 2M on either side", () => {
    const rows = [base({ t: hm(0) }), base({ t: hm(1), call_doi: 2_500_000 })];
    const evts = buildFlowEvents(rows);
    expect(evts).toHaveLength(1);
    expect(evts[0].kind).toBe("burst");
    expect(evts[0].magnitude).toBe(2_500_000);
    expect(evts[0].t).toBe(hm(1));
  });

  test("put-side burst also fires; sub-threshold minutes stay quiet", () => {
    const rows = [
      base({ t: hm(0) }),
      base({ t: hm(1), put_doi: -2_100_000 }),
      base({ t: hm(2), call_doi: 100_000, put_doi: -2_000_000 }),
    ];
    const evts = buildFlowEvents(rows);
    expect(evts.filter((e) => e.kind === "burst")).toHaveLength(1);
    expect(evts[0].label).toMatch(/Put unwind/);
  });

  test("call build reads bearish, call unwind reads bullish", () => {
    const build = buildFlowEvents([base({ t: hm(0) }), base({ t: hm(1), call_doi: 3_000_000 })]);
    expect(build[0].side).toBe("bearish");
    const unwind = buildFlowEvents([base({ t: hm(0), call_doi: 3_000_000 }), base({ t: hm(1), call_doi: 0 })]);
    expect(unwind[0].side).toBe("bullish");
  });

  test("put build reads bullish, put unwind reads bearish", () => {
    const build = buildFlowEvents([base({ t: hm(0) }), base({ t: hm(1), put_doi: 3_000_000 })]);
    expect(build[0].side).toBe("bullish");
    const unwind = buildFlowEvents([base({ t: hm(0), put_doi: 3_000_000 }), base({ t: hm(1), put_doi: 0 })]);
    expect(unwind[0].side).toBe("bearish");
  });

  test("wall-strike change emits a neutral wall event", () => {
    const rows = [base({ t: hm(0) }), base({ t: hm(1), walls: { call: 26000, put: 25600 } })];
    const evts = buildFlowEvents(rows);
    const wall = evts.find((e) => e.kind === "wall");
    expect(wall).toBeDefined();
    expect(wall?.side).toBe("neutral");
    expect(wall?.magnitude).toBe(100);
    expect(wall?.label).toMatch(/Call wall/);
  });

  test("put-wall change emits a wall event too", () => {
    const rows = [base({ t: hm(0) }), base({ t: hm(1), walls: { call: 25900, put: 25500 } })];
    expect(buildFlowEvents(rows).some((e) => e.kind === "wall" && e.label.includes("Put wall"))).toBe(true);
  });

  test("max-pain change emits a maxpain event", () => {
    const rows = [base({ t: hm(0) }), base({ t: hm(1), max_pain: 25800 })];
    const evts = buildFlowEvents(rows);
    const mp = evts.find((e) => e.kind === "maxpain");
    expect(mp).toBeDefined();
    expect(mp?.side).toBe("neutral");
    expect(mp?.magnitude).toBe(100);
  });

  test("ATM strike change emits an atm event", () => {
    const rows = [base({ t: hm(0) }), base({ t: hm(1), atm_strike: 25800 })];
    const evts = buildFlowEvents(rows);
    expect(evts.some((e) => e.kind === "atm")).toBe(true);
  });

  test("identical rows emit nothing; events stay time-ascending", () => {
    expect(buildFlowEvents([base({ t: hm(0) }), base({ t: hm(1) })])).toHaveLength(0);
    const rows = [
      base({ t: hm(2), max_pain: 25800 }),
      base({ t: hm(0) }),
      base({ t: hm(1), atm_strike: 25800 }),
    ];
    const evts = buildFlowEvents(rows);
    const ts = evts.map((e) => e.t);
    expect([...ts].sort()).toEqual(ts);
  });

  test("custom threshold is honored", () => {
    const rows = [base({ t: hm(0) }), base({ t: hm(1), call_doi: 500_000 })];
    expect(buildFlowEvents(rows, { burstThreshold: 100_000 })).toHaveLength(1);
    expect(buildFlowEvents(rows, { burstThreshold: 1_000_000 })).toHaveLength(0);
  });
});

describe("clockLabel", () => {
  test("turns tape ISO timestamps into HH:MM and leaves clock labels alone", () => {
    expect(clockLabel("2026-10-26T09:16:00+05:30")).toBe("09:16");
    expect(clockLabel("09:16")).toBe("09:16");
    expect(clockLabel("")).toBe("");
  });
});

describe("groupFlowRuns", () => {
  test("tooltip detail never shows a raw ISO timestamp", () => {
    const rows = [
      base({ t: "2026-10-26T09:15:00+05:30", put_doi: 10_000_000 }),
      base({ t: "2026-10-26T09:16:00+05:30", put_doi: 7_900_000 }),
    ];
    const bucket = groupFlowRuns(buildFlowEvents(rows))[0];
    expect(bucket.detail).toContain("09:16 Put unwind");
    expect(bucket.detail).not.toContain("T09:16");
  });

  test("empty input yields no buckets", () => {
    expect(groupFlowRuns([])).toEqual([]);
  });

  test("a single burst keeps its original label", () => {
    // put OI 3M → 0 is a 3M unwind on one minute.
    const events = buildFlowEvents([
      base({ t: hm(0), put_doi: 3_000_000 }),
      base({ t: hm(1), put_doi: 0 }),
    ]);
    const buckets = groupFlowRuns(events);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].label).toBe("Put unwind −3.00M");
    expect(buckets[0].count).toBe(1);
    expect(buckets[0].total).toBe(-3_000_000);
    expect(buckets[0].peak).toBe(-3_000_000);
    expect(buckets[0].start).toBe(hm(1));
    expect(buckets[0].end).toBe(hm(1));
  });

  test("consecutive same-direction prints collapse, sum and keep the peak", () => {
    const events = buildFlowEvents([
      base({ t: hm(0), put_doi: 10_000_000 }),
      base({ t: hm(1), put_doi: 7_900_000 }), // −2.10M
      base({ t: hm(2), put_doi: 5_700_000 }), // −2.20M
      base({ t: hm(3), put_doi: 2_700_000 }), // −3.00M
    ]);
    const buckets = groupFlowRuns(events);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].segment).toBe("put-unwind");
    expect(buckets[0].side).toBe("bearish");
    expect(buckets[0].count).toBe(3);
    expect(buckets[0].total).toBe(-7_300_000);
    expect(buckets[0].peak).toBe(-3_000_000);
    expect(buckets[0].start).toBe(hm(1));
    expect(buckets[0].end).toBe(hm(3));
    expect(buckets[0].label).toBe("Put unwind −7.30M over 3m (peak −3.00M)");
    // Detail keeps every raw print for the tooltip.
    expect(buckets[0].detail).toContain(`${hm(1)} Put unwind −2.10M`);
    expect(buckets[0].detail).toContain(`${hm(3)} Put unwind −3.00M`);
  });

  test("alternating runs stay separate buckets", () => {
    const events = buildFlowEvents([
      base({ t: hm(0), put_doi: 10_000_000 }),
      base({ t: hm(1), put_doi: 7_900_000 }), // unwind
      base({ t: hm(2), put_doi: 10_000_000 }), // build
      base({ t: hm(3), put_doi: 7_900_000 }), // unwind
    ]);
    const buckets = groupFlowRuns(events);
    expect(buckets.map((b) => b.segment)).toEqual([
      "put-unwind",
      "put-build",
      "put-unwind",
    ]);
    expect(buckets.map((b) => b.count)).toEqual([1, 1, 1]);
    expect(buckets.map((b) => b.total)).toEqual([-2_100_000, 2_100_000, -2_100_000]);
  });

  test("structural shifts are never summed together", () => {
    const events = buildFlowEvents([
      base({ t: hm(0) }),
      base({ t: hm(1), max_pain: 25800 }),
      base({ t: hm(2), max_pain: 25900 }),
    ]);
    const buckets = groupFlowRuns(events);
    expect(buckets).toHaveLength(2);
    expect(buckets.every((b) => b.kind === "maxpain" && b.count === 1)).toBe(true);
    expect(buckets[0].label).toContain("25,700 → 25,800");
    expect(buckets[1].label).toContain("25,800 → 25,900");
  });

  test("a structural print breaks a burst run", () => {
    const events = buildFlowEvents([
      base({ t: hm(0), put_doi: 10_000_000 }),
      base({ t: hm(1), put_doi: 7_900_000 }), // put unwind
      base({ t: hm(2), put_doi: 7_900_000, max_pain: 25800 }), // structural only
      // Keep max_pain at 25,800: resetting it would add a second structural
      // event (25,800 → 25,700) that is not what this test is about.
      base({ t: hm(3), put_doi: 5_800_000, max_pain: 25800 }), // put unwind
    ]);
    const buckets = groupFlowRuns(events);
    expect(buckets.map((b) => b.segment)).toEqual(["put-unwind", "maxpain", "put-unwind"]);
    expect(buckets.map((b) => b.count)).toEqual([1, 1, 1]);
  });

  test("the live tape collapses six Put unwind minutes into one bucket", () => {
    // The reported live line was six near-identical Put unwind prints followed
    // by four Call builds — the per-minute concatenation lost the story.
    const rows: FlowTapeRow[] = [
      base({ t: hm(0), put_doi: 20_000_000 }),
      base({ t: hm(1), put_doi: 17_310_000 }), // −2.69M
      base({ t: hm(2), put_doi: 14_580_000 }), // −2.73M
      base({ t: hm(3), put_doi: 12_470_000 }), // −2.11M
      base({ t: hm(4), put_doi: 9_720_000 }), // −2.75M
      base({ t: hm(5), put_doi: 6_790_000 }), // −2.93M
      base({ t: hm(6), put_doi: 4_060_000 }), // −2.73M
      base({ t: hm(7), put_doi: 4_060_000, call_doi: 3_140_000 }), // +3.14M
      base({ t: hm(8), put_doi: 4_060_000, call_doi: 5_390_000 }), // +2.25M
      base({ t: hm(9), put_doi: 4_060_000, call_doi: 7_640_000 }), // +2.25M
      base({ t: hm(10), put_doi: 4_060_000, call_doi: 9_820_000 }), // +2.18M
    ];
    const buckets = groupFlowRuns(buildFlowEvents(rows));
    expect(buckets.map((b) => b.segment)).toEqual(["put-unwind", "call-build"]);
    expect(buckets.map((b) => b.count)).toEqual([6, 4]);
    expect(buckets.map((b) => b.total)).toEqual([-15_940_000, 9_820_000]);
    expect(buckets.map((b) => b.peak)).toEqual([-2_930_000, 3_140_000]);
    expect(buckets[0].label).toBe("Put unwind −15.94M over 6m (peak −2.93M)");
    expect(buckets[1].label).toBe("Call build +9.82M over 4m (peak +3.14M)");
  });
});

describe("summarizeFlowRuns", () => {
  function manyBuckets(n: number) {
    const rows: FlowTapeRow[] = [base({ t: hm(0) })];
    for (let i = 1; i <= n; i++) rows.push(base({ t: hm(i), max_pain: 25700 + i * 50 }));
    return groupFlowRuns(buildFlowEvents(rows));
  }

  test("keeps every bucket when both budgets fit", () => {
    const buckets = manyBuckets(3);
    const summary = summarizeFlowRuns(buckets, { maxLabels: 12, maxChars: 1000 });
    expect(summary.visible).toHaveLength(3);
    expect(summary.hidden).toBe(0);
    expect(summary.showMarker).toBe(false);
    expect(summary.truncated).toBe(false);
    expect(summary.text).toBe(buckets.map((b) => b.label).join(" · "));
  });

  test("caps the label count and appends an earlier marker", () => {
    const buckets = manyBuckets(20);
    const summary = summarizeFlowRuns(buckets, { maxLabels: 5, maxChars: 10_000 });
    expect(summary.visible).toHaveLength(5);
    expect(summary.hidden).toBe(15);
    expect(summary.showMarker).toBe(true);
    expect(summary.text.startsWith("+15 earlier · ")).toBe(true);
    expect(summary.truncated).toBe(true);
    expect(summary.fullText).toBe(buckets.map((b) => b.label).join(" · "));
  });

  test("character budget drops whole older runs, never clips a number", () => {
    const buckets = manyBuckets(20);
    const summary = summarizeFlowRuns(buckets, { maxLabels: 20, maxChars: 80 });
    expect(summary.hidden).toBeGreaterThan(0);
    expect(summary.visible.length).toBeLessThan(buckets.length);
    for (const bucket of summary.visible) {
      expect(summary.text).toContain(bucket.label);
    }
    expect(summary.text.length).toBeLessThanOrEqual(80);
    expect(summary.text.startsWith(`+${summary.hidden} earlier · `)).toBe(true);
  });

  test("the character budget covers the whole line, separators included", () => {
    const buckets = manyBuckets(20);
    const summary = summarizeFlowRuns(buckets, { maxLabels: 20, maxChars: 200 });
    // `text` is exactly what the flex row renders: labels joined by ` · `
    // (glyph + the two 6px gaps), so its length is the rendered char cost.
    expect(summary.text.length).toBeLessThanOrEqual(200);
    expect(summary.hidden).toBeGreaterThan(0);
    expect(summary.truncated).toBe(true);
  });

  test("a single long run compacts instead of clipping mid-number", () => {
    const rows: FlowTapeRow[] = [base({ t: hm(0), put_doi: 20_000_000 })];
    for (let i = 1; i <= 6; i++) {
      rows.push(base({ t: hm(i), put_doi: 20_000_000 - i * 2_700_000 }));
    }
    const buckets = groupFlowRuns(buildFlowEvents(rows));
    // The full label is ~40 chars — wider than this lane.
    expect(buckets[0].label.length).toBeGreaterThan(24);
    const summary = summarizeFlowRuns(buckets, { maxLabels: 1, maxChars: 24 });
    expect(summary.text).toBe("Put unwind −16.20M");
    expect(summary.text.length).toBeLessThanOrEqual(24);
    expect(summary.truncated).toBe(true);
    // The full label and every raw print survive in the tooltip data.
    expect(summary.fullText).toBe(buckets[0].label);
    expect(summary.visible[0].detail).toContain(`${hm(1)} Put unwind −2.70M`);
    expect(summary.visible[0].count).toBe(6);
  });

  test("structural labels compact to their destination strike", () => {
    const events = buildFlowEvents([
      base({ t: hm(0) }),
      base({ t: hm(1), max_pain: 25800 }),
      base({ t: hm(2), max_pain: 25900 }),
    ]);
    const buckets = groupFlowRuns(events);
    const summary = summarizeFlowRuns(buckets, { maxLabels: 1, maxChars: 18 });
    // Only the newest max-pain move survives, in its short form; the marker is
    // dropped rather than pushing the label past the lane edge.
    expect(summary.visible).toHaveLength(1);
    expect(summary.showMarker).toBe(false);
    expect(summary.hidden).toBe(1);
    expect(summary.text).toBe("Max pain 25,900");
  });

  test("empty buckets summarize to an empty string", () => {
    const summary = summarizeFlowRuns([]);
    expect(summary.visible).toEqual([]);
    expect(summary.hidden).toBe(0);
    expect(summary.text).toBe("");
    expect(summary.truncated).toBe(false);
  });
});

describe("NiftyFlowStrip render", () => {
  test("renders one tick per event with kind/side markers", () => {
    const rows = [
      base({ t: hm(0) }),
      base({ t: hm(1), call_doi: 3_000_000 }),
      base({ t: hm(2), call_doi: 3_000_000, max_pain: 25800 }),
    ];
    r(() => <NiftyFlowStrip {...{ rows: rows }} />);
    const ticks = screen.getAllByTestId("nifty-flow-tick");
    expect(ticks).toHaveLength(2);
    expect(ticks[0]).toHaveAttribute("data-kind", "burst");
    expect(ticks[0]).toHaveAttribute("data-side", "bearish");
    expect(ticks[1]).toHaveAttribute("data-kind", "maxpain");
  });

  test("ticks are placed by wall-clock time, not event index", () => {
    // Flow tape is derivatives-based: the session runs 09:15–15:40, not the
    // cash 09:15–15:29. Two events 5 minutes apart must not land at 0% / 100%
    // just because there are only two of them.
    expect(flowTickPct(hm(0))).toBe("0%");
    expect(flowTickPct("15:40")).toBe("100%");
    const early = Number.parseFloat(flowTickPct(hm(5)));
    const late = Number.parseFloat(flowTickPct("15:20"));
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(3);
    expect(late).toBeGreaterThan(90);
    expect(late).toBeLessThan(96);
  });

  test("hover titles carry time and label", () => {
    const rows = [base({ t: hm(0) }), base({ t: hm(1), put_doi: 2_500_000 })];
    r(() => <NiftyFlowStrip {...{ rows: rows }} />);
    const tick = screen.getByTestId("nifty-flow-tick");
    expect(tick.getAttribute("title")).toContain(hm(1));
  });

  test("labels cap at maxLabels to avoid clutter", () => {
    const rows: FlowTapeRow[] = [base({ t: hm(0) })];
    for (let i = 1; i <= 20; i++) {
      rows.push(base({ t: hm(i), max_pain: 25700 + i * 50 }));
    }
    r(() => <NiftyFlowStrip {...{ rows: rows }} />);
    expect(screen.getAllByTestId("nifty-flow-tick")).toHaveLength(20);
    expect(screen.getAllByTestId("nifty-flow-label").length).toBeLessThanOrEqual(12);
  });

  test("summary aggregates consecutive runs while ticks keep every print", () => {
    const rows = [
      base({ t: hm(0), put_doi: 10_000_000 }),
      base({ t: hm(1), put_doi: 7_900_000 }),
      base({ t: hm(2), put_doi: 5_800_000 }),
      base({ t: hm(3), put_doi: 3_700_000 }),
    ];
    r(() => <NiftyFlowStrip {...{ rows: rows }} />);
    const labels = screen.getAllByTestId("nifty-flow-label");
    expect(labels).toHaveLength(1);
    expect(labels[0]).toHaveTextContent("Put unwind −6.30M over 3m (peak −2.10M)");
    expect(labels[0]).toHaveAttribute("data-kind", "burst");
    expect(labels[0]).toHaveAttribute("data-count", "3");
    expect(labels[0].getAttribute("title")).toContain(hm(1));
    expect(labels[0].getAttribute("title")).toContain(hm(3));
    // The per-minute direction stays available on the lane itself.
    const ticks = screen.getAllByTestId("nifty-flow-tick");
    expect(ticks).toHaveLength(3);
    expect(ticks.every((t) => t.getAttribute("data-side") === "bearish")).toBe(true);
  });

  test("the reported live tape renders two readable segments, not eleven prints", () => {
    const rows: FlowTapeRow[] = [
      base({ t: hm(0), put_doi: 20_000_000 }),
      base({ t: hm(1), put_doi: 17_310_000 }),
      base({ t: hm(2), put_doi: 14_580_000 }),
      base({ t: hm(3), put_doi: 12_470_000 }),
      base({ t: hm(4), put_doi: 9_720_000 }),
      base({ t: hm(5), put_doi: 6_790_000 }),
      base({ t: hm(6), put_doi: 4_060_000 }),
      base({ t: hm(7), put_doi: 4_060_000, call_doi: 3_140_000 }),
      base({ t: hm(8), put_doi: 4_060_000, call_doi: 5_390_000 }),
      base({ t: hm(9), put_doi: 4_060_000, call_doi: 7_640_000 }),
      base({ t: hm(10), put_doi: 4_060_000, call_doi: 9_820_000 }),
    ];
    r(() => <NiftyFlowStrip {...{ rows: rows }} />);
    const labels = screen.getAllByTestId("nifty-flow-label");
    expect(labels).toHaveLength(2);
    expect(labels[0]).toHaveTextContent("Put unwind −15.94M over 6m (peak −2.93M)");
    expect(labels[0]).toHaveAttribute("data-count", "6");
    expect(labels[1]).toHaveTextContent("Call build +9.82M over 4m (peak +3.14M)");
    expect(labels[1]).toHaveAttribute("data-count", "4");
    // One tick per raw print is preserved on the lane.
    expect(screen.getAllByTestId("nifty-flow-tick")).toHaveLength(10);
    // Colour language: put unwind red, call build red too here (both bearish).
    expect(labels[0]).toHaveStyle({ color: FLOW_BEAR });
    expect(labels[1]).toHaveStyle({ color: FLOW_BEAR });
  });

  test("overflow folds older runs into a +N earlier marker", () => {
    const rows: FlowTapeRow[] = [base({ t: hm(0) })];
    for (let i = 1; i <= 5; i++) {
      rows.push(base({ t: hm(i), max_pain: 25700 + i * 50 }));
    }
    r(() => <NiftyFlowStrip {...{ rows: rows, maxLabels: 2 }} />);
    expect(screen.getAllByTestId("nifty-flow-label")).toHaveLength(2);
    expect(screen.getByTestId("nifty-flowstrip-more")).toHaveTextContent("+3 earlier");
  });

  test("renders the colour legend above the ticks", () => {
    const rows = [base({ t: hm(0) }), base({ t: hm(1), call_doi: 3_000_000 })];
    r(() => <NiftyFlowStrip {...{ rows: rows }} />);
    const legend = screen.getByTestId("nifty-flowstrip-legend");
    const lane = screen.getByTestId("nifty-flowstrip-lane");
    expect(legend).toHaveTextContent("FLOW");
    expect(legend).toHaveTextContent("green = puts sold / calls bought back (bullish)");
    expect(legend).toHaveTextContent("red = calls sold / puts bought back (bearish)");
    expect(legend).toHaveTextContent("amber = structural (wall / max pain / ATM)");
    const order = Array.from(screen.getByTestId("nifty-flowstrip").children);
    expect(order.indexOf(legend)).toBeLessThan(order.indexOf(lane));
  });

  test("legend swatches are solid colour marks, not glyphs", () => {
    const rows = [base({ t: hm(0) }), base({ t: hm(1), call_doi: 3_000_000 })];
    r(() => <NiftyFlowStrip {...{ rows: rows }} />);
    const bull = screen.getByTestId("nifty-flowstrip-legend-bull-swatch");
    const bear = screen.getByTestId("nifty-flowstrip-legend-bear-swatch");
    const struct = screen.getByTestId("nifty-flowstrip-legend-struct-swatch");
    for (const [el, color] of [
      [bull, FLOW_BULL],
      [bear, FLOW_BEAR],
      [struct, FLOW_STRUCT],
    ] as const) {
      expect(el).toHaveStyle({ backgroundColor: color });
      expect(el).toHaveClass("w-2", "h-2");
      expect(el.textContent).toBe("");
    }
  });

  test("empty tape renders the muted state", () => {
    r(() => <NiftyFlowStrip {...{ rows: [base({ t: hm(0) }), base({ t: hm(1) })] }} />);
    expect(screen.getByTestId("nifty-flowstrip-empty")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-flowstrip-empty-text")).toHaveTextContent("no flow events");
  });
});
