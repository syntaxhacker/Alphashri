// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";

import { NiftyFlowStrip } from "./NiftyFlowStrip";
import { base, liveTapeRows } from "./niftyFlowStrip.fixtures";
import { hm } from "./reportTestFixtures";

afterEach(cleanup);

const flowRows = () => [
  base({ t: hm(0) }),
  base({ t: hm(1), call_doi: 3_000_000 }),
  base({ t: hm(2), call_doi: 3_000_000, max_pain: 25_800 }),
];

describe("NiftyFlowStrip density", () => {
  it("groups the legend into a tight inline cluster instead of a full-width band", () => {
    render(() => <NiftyFlowStrip rows={flowRows()} />);
    const strip = screen.getByTestId("nifty-flowstrip");
    const legend = screen.getByTestId("nifty-flowstrip-legend");
    expect(legend.parentElement).toBe(strip);
    expect(legend.className).toContain("inline-flex");
    expect(legend.className).toContain("gap-1");
    expect(legend.className).not.toMatch(/(^|\s)w-full(\s|$)/);
    expect(legend.className).not.toContain("justify-between");
  });

  it("keeps every legend code, colour and tooltip while tightening the row", () => {
    render(() => <NiftyFlowStrip rows={flowRows()} />);
    for (const [id, code] of [
      ["bull", "BULL"],
      ["bear", "BEAR"],
      ["struct", "STRUCT"],
    ] as const) {
      const el = screen.getByTestId(`nifty-flowstrip-legend-${id}`);
      expect(el, code).toHaveTextContent(code);
      expect(el.getAttribute("title")?.length ?? 0, code).toBeGreaterThan(30);
      expect(screen.getByTestId(`nifty-flowstrip-legend-${id}-swatch`)).not.toBeNull();
    }
  });

  it("keeps the run values in a compact left cluster with tooltips intact", () => {
    render(() => <NiftyFlowStrip rows={liveTapeRows()} />);
    const labels = screen.getByTestId("nifty-flowstrip-labels");
    expect(labels.className).toContain("gap-2");
    expect(labels.className).toContain("w-fit");
    expect(labels.className).not.toContain("justify-between");
    expect(labels.className).toContain("overflow-x-auto");
    const values = screen.getAllByTestId("nifty-flow-label");
    expect(values).toHaveLength(2);
    for (const value of values) {
      expect(value.getAttribute("title")?.length ?? 0).toBeGreaterThan(10);
    }
    // Every raw print still has its own tick; only the presentation is tighter.
    expect(screen.getAllByTestId("nifty-flow-tick")).toHaveLength(10);
  });

  it("keeps the legend on one line in a 472px window without dropping any value", () => {
    render(() => <NiftyFlowStrip rows={liveTapeRows()} />);
    const legend = screen.getByTestId("nifty-flowstrip-legend");

    // One visual line: the cluster never wraps, and the long copy is no longer
    // revealed by a viewport-width rule (the desk window is narrower than the
    // viewport, so `min-[720px]:inline` wrapped inside a 472px panel).
    expect(legend.className).toContain("flex-nowrap");
    expect(legend.className).not.toContain("flex-wrap");
    expect(legend.innerHTML).not.toContain("min-[720px]:inline");

    for (const [id, explanation] of [
      ["bull", "green = puts sold / calls bought back (bullish)"],
      ["bear", "red = calls sold / puts bought back (bearish)"],
      ["struct", "amber = structural (wall / max pain / ATM)"],
    ] as const) {
      const item = screen.getByTestId(`nifty-flowstrip-legend-${id}`);
      expect(item.className, id).toContain("whitespace-nowrap");
      const fullText = item.querySelector(".sr-only");
      expect(fullText, id).not.toBeNull();
      expect(fullText?.textContent, id).toBe(explanation);
      expect((item.getAttribute("aria-label")?.length ?? 0), id).toBeGreaterThan(30);
      expect((item.getAttribute("title")?.length ?? 0), id).toBeGreaterThan(30);
      expect(screen.getByTestId(`nifty-flowstrip-legend-${id}-swatch`), id).not.toBeNull();
      expect(item, id).toHaveTextContent(explanation);
    }

    // The values beside the legend are untouched by the density fix.
    expect(screen.getAllByTestId("nifty-flow-label")).toHaveLength(2);
    expect(screen.getAllByTestId("nifty-flow-tick")).toHaveLength(10);
  });

  it("collapses a no-window / no-print strip to one micro line", () => {
    render(() => <NiftyFlowStrip rows={[]} />);
    const empty = screen.getByTestId("nifty-flowstrip-empty");
    expect(empty.className).toContain("h-5");
    expect(empty.className).not.toContain("h-14");
    expect(screen.getByTestId("nifty-flowstrip-empty-text")).toHaveTextContent(
      "no flow prints · live only",
    );
    expect(empty.getAttribute("title")?.length ?? 0).toBeGreaterThan(20);
  });
});
