// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";

import { afterEach, describe, expect, test, vi } from "vitest";
import { screen, cleanup } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import * as palette from "@/ui/palette";
import * as heatmapModule from "./niftyOiHeatmap";
import { type HeatmapTapeRow } from "./niftyOiHeatmap";
import { NiftyOiHeatmap } from "./NiftyOiHeatmap";
import { chainAt, isoAt, r } from "./reportTestFixtures";

afterEach(() => {
  cleanup();
});

function row(t: string, spot: number, chain: HeatmapTapeRow["chain"], extra: Partial<HeatmapTapeRow> = {}): HeatmapTapeRow {
  return { t, spot, max_pain: 25700, flip: 25750, atm_strike: 25750, chain, ...extra };
}

const STRIKES = [25650, 25700, 25750, 25800, 25850];

describe("session-anchored time axis", () => {
  test("draws the persisted flow-flip vertical guide", () => {
    const rows = [
      row(isoAt(0), 25750, chainAt(STRIKES, 1000, 1000)),
      row(isoAt(6), 25760, chainAt(STRIKES, 2000, 1000)),
    ];
    r(() => (
      <NiftyOiHeatmap {...{
        rows,
        bucketMin: 5,
        widthPts: 500,
        startTime: isoAt(0),
        flipAt: isoAt(30),
      }} />
    ));
    const line = screen.getByTestId("heatmap-flip-line");
    expect(line.tagName.toLowerCase()).toBe("line");
    expect(line.getAttribute("stroke-dasharray")).toBe("3 3");
    expect(line.querySelector("title")?.textContent).toContain("Last 5m flow flip");
    expect(Number(line.getAttribute("x1"))).toBeGreaterThan(64);
  });
});

describe("NiftyOiHeatmap render", () => {
  test("marks spot touching max pain with a dot on the spot line", () => {
    const rows = [
      row(isoAt(0), 25750, chainAt(STRIKES, 1000, 1000), { max_pain: 25750 }),
      row(isoAt(6), 25752, chainAt(STRIKES, 2000, 1000), { max_pain: 25754 }),
    ];
    r(() => <NiftyOiHeatmap {...{ rows, bucketMin: 5, widthPts: 500 }} />);
    const dots = screen.getAllByTestId("nifty-heatmap-mp-touch");
    expect(dots).toHaveLength(2);
    for (const dot of dots) {
      expect(dot.tagName.toLowerCase()).toBe("circle");
      expect(dot).toHaveAttribute("r", "3.5");
      expect(dot.getAttribute("fill")).toBe(palette.LEVEL_MAX_PAIN);
      expect(dot.getAttribute("stroke")).toBe(palette.HEATMAP_TOUCH_STROKE);
      expect(dot.querySelector("title")?.textContent).toMatch(/^Max pain touch /);
    }
  });

  test("marks a bucket whose earlier row touched, at that row's spot", () => {
    const rows = [
      row(isoAt(0), 25700, chainAt(STRIKES, 1000, 1000), { max_pain: 25700 }),
      row(isoAt(4), 25800, chainAt(STRIKES, 2000, 1000), { max_pain: 25700 }),
    ];
    r(() => <NiftyOiHeatmap {...{ rows, bucketMin: 5, widthPts: 500 }} />);
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
    r(() => <NiftyOiHeatmap {...{ rows, bucketMin: 5, widthPts: 500 }} />);
    expect(screen.queryAllByTestId("nifty-heatmap-mp-touch")).toHaveLength(0);
  });
});

/**
 * Flip-guide geometry: PAD_L=64 and a 1000-wide viewBox over two 5m buckets
 * give cellW=468, so bucket centres land at 298 and 766. These assert the
 * mapping is bucket-indexed, not "minutes into the axis".
 */
describe("flow-flip guide x mapping", () => {
  const twoBuckets = [
    row(isoAt(0), 25750, chainAt(STRIKES, 1000, 1000)),
    row(isoAt(6), 25760, chainAt(STRIKES, 2000, 1000)),
  ];

  function renderHeatmap(props: { flipAt?: string | null } = {}) {
    return r(() => (
      <NiftyOiHeatmap
        rows={twoBuckets}
        bucketMin={5}
        widthPts={500}
        startTime={isoAt(0)}
        flipAt={props.flipAt}
      />
    ));
  }

  test("the flip line lands on the flip's own bucket centre", () => {
    renderHeatmap({ flipAt: isoAt(5) }); // 09:20 → bucket 1, not "5 minutes into the axis"
    const line = screen.getByTestId("heatmap-flip-line");
    expect(Number(line.getAttribute("x1"))).toBe(766);
    expect(line.getAttribute("x1")).toBe(line.getAttribute("x2"));
    expect(line.getAttribute("y1")).toBe("0");
    expect(Number(line.getAttribute("y2"))).toBeGreaterThan(0);
    expect(line.querySelector("title")?.textContent).toContain("09:20");
  });

  test("a flip at the session open lands on the first bucket centre", () => {
    renderHeatmap({ flipAt: isoAt(0) });
    expect(Number(screen.getByTestId("heatmap-flip-line").getAttribute("x1"))).toBe(298);
  });

  test("a flip past the last bucket clamps to the final bucket centre", () => {
    renderHeatmap({ flipAt: isoAt(30) });
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
    renderHeatmap({ flipAt: isoAt(-10) }); // 09:05 — before the 09:15 axis start
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
    const [rows, setRows] = createSignal([
      row(isoAt(0), 25750, chainAt(STRIKES, 1000, 1000)),
      row(isoAt(6), 25760, chainAt(STRIKES, 2000, 1000)),
    ]);
    const view = r(() => <NiftyOiHeatmap rows={rows()} bucketMin={5} widthPts={500} startTime={isoAt(0)} />);
    expect(ro.constructed()).toBe(1);
    setRows((prev) => [...prev]);
    expect(ro.constructed()).toBe(1);
    view.unmount();
    expect(ro.disconnect).toHaveBeenCalledTimes(1);
  });
});

describe("model memo gating", () => {
  test("does not rebuild buildOiHeatmap on a fresh-but-equal rows array", () => {
    const buildSpy = vi.spyOn(heatmapModule, "buildOiHeatmap");
    const [rows, setRows] = createSignal([
      row(isoAt(0), 25750, chainAt(STRIKES, 1000, 1000)),
      row(isoAt(6), 25760, chainAt(STRIKES, 2000, 1000)),
    ]);
    r(() => <NiftyOiHeatmap rows={rows()} bucketMin={5} widthPts={500} startTime={isoAt(0)} />);
    const buildsAfterMount = buildSpy.mock.calls.length;
    expect(buildsAfterMount).toBeGreaterThan(0);

    setRows((prev) => [...prev]);
    expect(buildSpy.mock.calls.length).toBe(buildsAfterMount);

    setRows((prev) => [...prev, row(isoAt(7), 25800, chainAt(STRIKES, 1000, 1000))]);
    expect(buildSpy.mock.calls.length).toBe(buildsAfterMount + 1);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
