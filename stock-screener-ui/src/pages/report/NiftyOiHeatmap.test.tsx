// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";

import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import { buildOiHeatmap, type ChainTuple, type HeatmapTapeRow } from "./niftyOiHeatmap";
import { NiftyOiHeatmap } from "./NiftyOiHeatmap";

function TestWrapper({ children }: { children: React.ReactNode }) {
  return <UIProvider>children</UIProvider>;
}

function r(jsx: ReactElement) {
  return render(() => jsx, { wrapper: TestWrapper });
}

afterEach(() => {
  cleanup();
});

function chainAt(strikes: number[], ceOi: number, peOi: number): Record<string, ChainTuple> {
  const out: Record<string, ChainTuple> = {};
  for (const s of strikes) out[String(s)] = [10, 12, ceOi, peOi, 100, 100];
  return out;
}

function row(t: string, spot: number, chain: HeatmapTapeRow["chain"], extra: Partial<HeatmapTapeRow> = {}): HeatmapTapeRow {
  return { t, spot, max_pain: 25700, flip: 25750, atm_strike: 25750, chain, ...extra };
}

const STRIKES = [25650, 25700, 25750, 25800, 25850];

function iso(min: number): string {
  const total = 9 * 60 + 15 + min;
  const hh = String(Math.floor(total / 60)).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `2026-10-14T${hh}:${mm}:00+05:30`;
}

/** Two 5m buckets (09:15, 09:20), session-anchored — the geometry the flip
 *  line maps into: PAD_L=64, viewBox width 1000 → cellW=468 → centres 298/766. */
const twoBuckets = [
  row(iso(0), 25750, chainAt(STRIKES, 1000, 1000)),
  row(iso(6), 25760, chainAt(STRIKES, 2000, 1000)),
];

function renderHeatmap(props: Partial<React.ComponentProps<typeof NiftyOiHeatmap>> = {}) {
  return r(
    <NiftyOiHeatmap {...{
      rows: twoBuckets,
      bucketMin: 5,
      widthPts: 500,
      startTime: iso(0),
      ...props,
    }} />,
  );
}

describe("flow-flip guide x mapping", () => {
  test("the flip line lands on the flip's own bucket centre", () => {
    renderHeatmap({ flipAt: iso(5) }); // 09:20 → bucket index 1, not "5 minutes into the axis"
    const line = screen.getByTestId("heatmap-flip-line");
    expect(Number(line.getAttribute("x1"))).toBe(766);
    expect(line.getAttribute("x1")).toBe(line.getAttribute("x2"));
    expect(line.getAttribute("y1")).toBe("0");
    expect(Number(line.getAttribute("y2"))).toBeGreaterThan(0);
    expect(line.querySelector("title")?.textContent).toContain("09:20");
  });

  test("a flip at the session open lands on the first bucket centre", () => {
    renderHeatmap({ flipAt: iso(0) });
    expect(Number(screen.getByTestId("heatmap-flip-line").getAttribute("x1"))).toBe(298);
  });

  test("a flip past the last bucket clamps to the final bucket centre", () => {
    renderHeatmap({ flipAt: iso(30) }); // 09:45 — beyond the plotted window
    expect(Number(screen.getByTestId("heatmap-flip-line").getAttribute("x1"))).toBe(766);
  });

  test("a bare HH:MM flip stamp maps the same as an ISO stamp", () => {
    renderHeatmap({ flipAt: "09:20" });
    expect(Number(screen.getByTestId("heatmap-flip-line").getAttribute("x1"))).toBe(766);
  });

  test("no line when flipAt is null", () => {
    renderHeatmap({ flipAt: null });
    expect(screen.queryByTestId("heatmap-flip-line")).not.toBeInTheDocument();
  });

  test("no line when flipAt is unparseable", () => {
    renderHeatmap({ flipAt: "not-a-time" });
    expect(screen.queryByTestId("heatmap-flip-line")).not.toBeInTheDocument();
  });

  test("no line when flipAt precedes the plotted window", () => {
    renderHeatmap({ flipAt: iso(-10) }); // 09:05 — before the 09:15 axis start
    expect(screen.queryByTestId("heatmap-flip-line")).not.toBeInTheDocument();
  });
});

describe("ResizeObserver lifecycle", () => {
  function stubResizeObserver() {
    let constructed = 0;
    const disconnect = vi.fn();
    class MockResizeObserver {
      constructor(_cb: ResizeObserverCallback) {
        constructed += 1;
      }
      observe() {}
      unobserve() {}
      disconnect = disconnect;
    }
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    return { constructed: () => constructed, disconnect };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("one observer survives tape ticks and disconnects on unmount", () => {
    const ro = stubResizeObserver();
    const props = {
      rows: twoBuckets,
      bucketMin: 5,
      widthPts: 500,
      startTime: iso(0),
    };
    const view = r(createElement(NiftyOiHeatmap, props));
    // A fresh rows array (new identity) simulates a poll tick.
    view.rerender(() => <NiftyOiHeatmap {...{ ...props, rows: [...twoBuckets] }} />);
    expect(ro.constructed()).toBe(1);
    view.unmount();
    expect(ro.disconnect).toHaveBeenCalledTimes(1);
  });
});

describe("padded leading bucket", () => {
  // First tape row lands at 09:30; startTime pads 09:15/09:20/09:25 with
  // empty buckets (spot null) whose cells must still exist.
  const lateRows = [
    row(iso(15), 25750, chainAt(STRIKES, 1000, 1000)),
    row(iso(20), 25760, chainAt(STRIKES, 2000, 1000)),
  ];

  test("cells render for the padded buckets without throwing", () => {
    const model = buildOiHeatmap(lateRows, { bucketMin: 5, widthPts: 500, startTime: iso(0) });
    expect(model.buckets.slice(0, 3).every((b) => b.spot === null)).toBe(true);

    r(
      <NiftyOiHeatmap {...{
        rows: lateRows,
        bucketMin: 5,
        widthPts: 500,
        startTime: iso(0),
      }} />,
    );

    expect(screen.queryByTestId("nifty-heatmap-empty")).not.toBeInTheDocument();
    // The canvas carries every cell in the model, padded buckets included.
    expect(Number(screen.getByTestId("nifty-heatmap-canvas").getAttribute("data-cells"))).toBe(
      model.cells.length,
    );
    expect(model.cells.filter((c) => c.bucket < 3).length).toBe(3 * STRIKES.length);
  });

  test("padded buckets are excluded from the spot line but not from the axis", () => {
    r(
      <NiftyOiHeatmap {...{
        rows: lateRows,
        bucketMin: 5,
        widthPts: 500,
        startTime: iso(0),
      }} />,
    );
    const points = (screen.getByTestId("nifty-heatmap-spotline").getAttribute("points") ?? "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    expect(points).toHaveLength(2); // only the two buckets with a tape spot
    expect(screen.getByTestId("nifty-heatmap-svg")).toBeInTheDocument();
  });
});
