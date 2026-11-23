// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";

import { afterEach, describe, expect, test } from "vitest";
import { cleanup, screen } from "@solidjs/testing-library";
import {
  FLOW_BEAR,
  FLOW_BULL,
  FLOW_STRUCT,
  NiftyFlowStrip,
  flowTickPct,
} from "./NiftyFlowStrip";
import { base, liveTapeRows, maxPainStaircase } from "./niftyFlowStrip.fixtures";
import { hm, r } from "./reportTestFixtures";

afterEach(() => {
  cleanup();
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

  test("ISO stamps and invalid clocks keep their old axis positions", () => {
    expect(flowTickPct("2026-10-26T09:15:00+05:30")).toBe("0%");
    expect(flowTickPct("2026-10-26T15:40:00+05:30")).toBe("100%");
    expect(flowTickPct("")).toBe("50%");
    expect(flowTickPct("not-a-time")).toBe("50%");
    expect(flowTickPct("9:30")).toBe("50%");
    expect(flowTickPct("24:00")).toBe("50%");
  });

  test("labels cap at maxLabels to avoid clutter", () => {
    r(() => <NiftyFlowStrip {...{ rows: maxPainStaircase(20) }} />);
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
    r(() => <NiftyFlowStrip {...{ rows: liveTapeRows() }} />);
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

  test("the legend uses 12px codes and the run labels are 13px values", () => {
    const rows = [base({ t: hm(0) }), base({ t: hm(1), put_doi: 2_500_000 })];
    r(() => <NiftyFlowStrip {...{ rows }} />);
    const legend = screen.getByTestId("nifty-flowstrip-legend");
    expect(legend.className).toContain("text-ui-micro");
    expect(screen.getByTestId("nifty-flowstrip-legend-bull")).toHaveTextContent("BULL");
    const labels = screen.getByTestId("nifty-flowstrip-labels");
    expect(labels.className).toContain("text-ui-body");
    expect(screen.getByTestId("nifty-flow-label").className).toContain("shrink-0");
  });

  test("the run labels scroll at 390 with a narrow-only cue", () => {
    const rows = [base({ t: hm(0) }), base({ t: hm(1), put_doi: 2_500_000 })];
    r(() => <NiftyFlowStrip {...{ rows }} />);
    expect(screen.getByTestId("nifty-flowstrip-labels").className).toContain("overflow-x-auto");
    const cue = screen.getByTestId("nifty-flowstrip-scroll-cue");
    expect(cue.className).toContain("min-[720px]:hidden");
  });
});
