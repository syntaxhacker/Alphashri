// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";

import { describe, expect, test } from "vitest";
import {
  buildFlowEvents,
  clockLabel,
  groupFlowRuns,
  summarizeFlowRuns,
  type FlowTapeRow,
} from "./niftyFlowStrip";
import { base, liveTapeRows, maxPainStaircase } from "./niftyFlowStrip.fixtures";
import { hm } from "./reportTestFixtures";

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
      base({ t: hm(1), put_doi: 7_900_000 }),
      base({ t: hm(2), put_doi: 5_700_000 }),
      base({ t: hm(3), put_doi: 2_700_000 }),
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
    const buckets = groupFlowRuns(buildFlowEvents(liveTapeRows()));
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
    return groupFlowRuns(buildFlowEvents(maxPainStaircase(n)));
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
