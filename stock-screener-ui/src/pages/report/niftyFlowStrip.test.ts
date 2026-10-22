// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { createElement, type ReactElement } from "react";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { UIProvider } from "@/ui";
import { buildFlowEvents, type FlowTapeRow } from "./niftyFlowStrip";
import {
  FLOW_BEAR,
  FLOW_BULL,
  FLOW_STRUCT,
  NiftyFlowStrip,
  flowTickPct,
} from "./NiftyFlowStrip";

function TestWrapper({ children }: { children: React.ReactNode }) {
  return createElement(UIProvider, null, children);
}

function r(jsx: ReactElement) {
  return render(jsx, { wrapper: TestWrapper });
}

afterEach(() => {
  cleanup();
});

function hm(i: number): string {
  const total = 9 * 60 + 15 + i;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

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

describe("NiftyFlowStrip render", () => {
  test("renders one tick per event with kind/side markers", () => {
    const rows = [
      base({ t: hm(0) }),
      base({ t: hm(1), call_doi: 3_000_000 }),
      base({ t: hm(2), call_doi: 3_000_000, max_pain: 25800 }),
    ];
    r(createElement(NiftyFlowStrip, { rows: rows }));
    const ticks = screen.getAllByTestId("nifty-flow-tick");
    expect(ticks).toHaveLength(2);
    expect(ticks[0]).toHaveAttribute("data-kind", "burst");
    expect(ticks[0]).toHaveAttribute("data-side", "bearish");
    expect(ticks[1]).toHaveAttribute("data-kind", "maxpain");
  });

  test("ticks are placed by wall-clock time, not event index", () => {
    // Session 09:15–15:29. Two events 5 minutes apart must not land at
    // 0% / 100% just because there are only two of them.
    expect(flowTickPct(hm(0))).toBe("0%");
    expect(flowTickPct("15:29")).toBe("100%");
    const early = Number.parseFloat(flowTickPct(hm(5)));
    const late = Number.parseFloat(flowTickPct("15:00"));
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(3);
    expect(late).toBeGreaterThan(90);
    expect(late).toBeLessThan(96);
  });

  test("hover titles carry time and label", () => {
    const rows = [base({ t: hm(0) }), base({ t: hm(1), put_doi: 2_500_000 })];
    r(createElement(NiftyFlowStrip, { rows: rows }));
    const tick = screen.getByTestId("nifty-flow-tick");
    expect(tick.getAttribute("title")).toContain(hm(1));
  });

  test("labels cap at maxLabels to avoid clutter", () => {
    const rows: FlowTapeRow[] = [base({ t: hm(0) })];
    for (let i = 1; i <= 20; i++) {
      rows.push(base({ t: hm(i), max_pain: 25700 + i * 50 }));
    }
    r(createElement(NiftyFlowStrip, { rows: rows }));
    expect(screen.getAllByTestId("nifty-flow-tick")).toHaveLength(20);
    expect(screen.getAllByTestId("nifty-flow-label").length).toBeLessThanOrEqual(12);
  });

  test("renders the colour legend above the ticks", () => {
    const rows = [base({ t: hm(0) }), base({ t: hm(1), call_doi: 3_000_000 })];
    r(createElement(NiftyFlowStrip, { rows: rows }));
    const legend = screen.getByTestId("nifty-flowstrip-legend");
    const lane = screen.getByTestId("nifty-flowstrip-lane");
    expect(legend).toHaveTextContent("FLOW");
    expect(legend).toHaveTextContent("green = put build / call unwind");
    expect(legend).toHaveTextContent("red = call build / put unwind");
    expect(legend).toHaveTextContent("amber = structural (wall / max pain / ATM)");
    const order = Array.from(screen.getByTestId("nifty-flowstrip").children);
    expect(order.indexOf(legend)).toBeLessThan(order.indexOf(lane));
  });

  test("legend swatches are solid colour marks, not glyphs", () => {
    const rows = [base({ t: hm(0) }), base({ t: hm(1), call_doi: 3_000_000 })];
    r(createElement(NiftyFlowStrip, { rows: rows }));
    const bull = screen.getByTestId("nifty-flowstrip-legend-bull-swatch");
    const bear = screen.getByTestId("nifty-flowstrip-legend-bear-swatch");
    const struct = screen.getByTestId("nifty-flowstrip-legend-struct-swatch");
    for (const [el, color] of [
      [bull, FLOW_BULL],
      [bear, FLOW_BEAR],
      [struct, FLOW_STRUCT],
    ] as const) {
      expect(el).toHaveStyle({ backgroundColor: color, width: "8px", height: "8px" });
      expect(el.textContent).toBe("");
    }
  });

  test("empty tape renders the muted state", () => {
    r(createElement(NiftyFlowStrip, { rows: [base({ t: hm(0) }), base({ t: hm(1) })] }));
    expect(screen.getByTestId("nifty-flowstrip-empty")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-flowstrip-empty-text")).toHaveTextContent("no flow events");
  });
});
