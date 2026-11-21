// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import { TOOLBAR_CLASS } from "./ReportToolbar";
import { replayBarLayout } from "./NiftyReplayBar";
import { flowWindowsLayout } from "./NiftyFlowWindows";
import { planHeadlineStyle, verdictWrapLayout } from "./ReportDecisionStrip";
import { VERDICT_BLOCK_HEIGHT } from "./ReportDecisionStrip";
import { DESK_DOCK_BAR_HEIGHT, dockLayout } from "./DeskDock";
import { intelStripLayout } from "./NiftyIntelStrip";

/**
 * The browser audit measured these intrinsic content widths at 390px. A
 * layout that does not wrap/stack packs them into one row, which is exactly
 * the overflow/overlap the audit found. The helpers under test are the same
 * ones the components use to choose their layout at runtime, so the geometry
 * below is driven by production decisions, not by a parallel test list.
 */
const AUDIT = {
  toolbar: { client: 388, children: [116, 96, 96, 96, 112, 104, 64, 72, 54, 96, 96, 84, 96] },
  replayBar: { client: 388, children: [54, 160, 42, 96, 34, 42, 14] },
  flowWindows: { client: 382, children: [58, 14, 195, 246, 239, 78] },
  verdictWrap: { client: 382, children: [172, 61, 137, 66, 291] },
  dock: { client: 382, children: [78, 86, 78, 102, 70, 92, 76] },
  intelStrip: { client: 484, children: [46, 92, 92, 168, 60, 58, 54, 14] },
} as const;

type Rect = { left: number; right: number; top: number; bottom: number };
type Layout = {
  wrap: boolean;
  direction: "row" | "column";
  height: string;
  minHeight: string;
  overflow?: string;
  overflowX?: string;
  overflowY?: string;
  whiteSpace?: string;
  gapX?: string;
  gapY?: string;
  showHint?: boolean;
};

const GAP = 6;
const ROW_H = 24;

function model(layout: Layout, children: readonly number[], clientWidth: number) {
  const rects: Rect[] = [];
  if (!layout.wrap && layout.direction === "row") {
    let x = 0;
    children.forEach((w, i) => {
      rects.push({ left: x, right: x + w, top: 0, bottom: ROW_H });
      x += w + (i < children.length - 1 ? GAP : 0);
    });
    return { scrollWidth: x, clientWidth, rects };
  }

  if (layout.direction === "column") {
    let y = 0;
    children.forEach((w) => {
      const width = Math.min(w, clientWidth);
      rects.push({ left: 0, right: width, top: y, bottom: y + ROW_H });
      y += ROW_H + GAP;
    });
    return { scrollWidth: Math.min(...children.map((w) => Math.min(w, clientWidth))), clientWidth, rects };
  }

  // Wrapping row: pack whole children into lines, never splitting a value.
  let lineWidth = 0;
  let line = 0;
  children.forEach((w) => {
    if (lineWidth > 0 && lineWidth + w + GAP > clientWidth) {
      line += 1;
      lineWidth = 0;
    }
    const width = Math.min(w, clientWidth);
    rects.push({ left: lineWidth, right: lineWidth + width, top: line * (ROW_H + GAP), bottom: line * (ROW_H + GAP) + ROW_H });
    lineWidth += width + GAP;
  });
  return { scrollWidth: Math.max(...rects.map((r) => r.right)), clientWidth, rects };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function expectFits(layout: Layout, audit: { client: number; children: readonly number[] }) {
  const { scrollWidth, clientWidth, rects } = model(layout, audit.children, audit.client);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      expect(overlaps(rects[i], rects[j]), `siblings ${i}/${j} overlap`).toBe(false);
    }
  }
}

describe("narrow-viewport layout contract (390 × 844)", () => {
  test("toolbar wraps instead of hiding primary controls behind horizontal scroll", () => {
    expect(TOOLBAR_CLASS).toMatch(/(^|\s)flex-wrap(\s|$)/);
    expect(TOOLBAR_CLASS).toContain("min-[1200px]:flex-nowrap");
    expect(TOOLBAR_CLASS).not.toMatch(/(^|\s)overflow-x-auto(\s|$)/);
  });

  test("replay bar wraps readouts so numbers are never cut mid-value", () => {
    const layout = replayBarLayout(true) as Layout;
    expect(layout.wrap).toBe(true);
    expect(layout.overflowX).toBe("visible");
    expect(layout.whiteSpace).toBe("nowrap");
    expectFits(layout, AUDIT.replayBar);
  });

  test("flow windows stack so no cell draws over another", () => {
    const layout = flowWindowsLayout(true) as Layout;
    expect(layout.direction).toBe("column");
    expect(layout.wrap).toBe(true);
    expectFits(layout, AUDIT.flowWindows);
  });

  test("verdict chips and plan headline stack and stop clipping mid-word", () => {
    const layout = verdictWrapLayout(true) as Layout;
    expect(layout.direction).toBe("column");
    expect(layout.overflow).toBe("visible");
    expect(planHeadlineStyle(true)["white-space"]).toBe("normal");
    expectFits(layout, AUDIT.verdictWrap);
  });

  test("desk dock wraps its tabs so the DATA tab is reachable", () => {
    const layout = dockLayout(true) as Layout;
    expect(layout.wrap).toBe(true);
    expect(layout.showHint).toBe(false);
    // A wrapped second row is useless if overflow-y stays hidden — that was
    // the original "DATA tab off-screen" defect in a different guise.
    expect(layout.overflowY).toBe("visible");
    expectFits(layout, AUDIT.dock);
  });

  test("intel strip wraps readouts and never truncates a value", () => {
    const layout = intelStripLayout(true) as Layout;
    expect(layout.wrap).toBe(true);
    expect(layout.whiteSpace).toBe("nowrap");
    expectFits(layout, AUDIT.intelStrip);
  });
});

describe("desktop layout is unchanged (1600 × 950)", () => {
  test("replay bar stays one 24px row", () => {
    expect(replayBarLayout(false)).toEqual({
      wrap: false,
      direction: "row",
      height: "24px",
      minHeight: "24px",
      overflowX: "hidden",
      whiteSpace: "nowrap",
      gapX: "16px",
      gapY: "0",
    });
  });

  test("flow windows stay one 24px row", () => {
    expect(flowWindowsLayout(false)).toEqual({
      wrap: false,
      direction: "row",
      height: "24px",
      minHeight: "24px",
      overflow: "hidden",
      whiteSpace: "nowrap",
    });
  });

  test("verdict wrap stays one block row and the headline keeps its ellipsis", () => {
    expect(verdictWrapLayout(false)).toEqual({
      wrap: false,
      direction: "row",
      height: `${VERDICT_BLOCK_HEIGHT}px`,
      minHeight: `${VERDICT_BLOCK_HEIGHT}px`,
      overflow: "hidden",
    });
    expect(planHeadlineStyle(false)["white-space"]).toBe("nowrap");
    expect(planHeadlineStyle(false).overflow).toBe("hidden");
  });

  test("desk dock stays one bar row with the shortcut hint", () => {
    expect(dockLayout(false)).toEqual({
      wrap: false,
      direction: "row",
      height: `${DESK_DOCK_BAR_HEIGHT}px`,
      minHeight: `${DESK_DOCK_BAR_HEIGHT}px`,
      overflowX: "auto",
      overflowY: "hidden",
      showHint: true,
    });
  });

  test("intel strip stays one 24px row", () => {
    expect(intelStripLayout(false)).toEqual({
      wrap: false,
      direction: "row",
      height: "24px",
      minHeight: "24px",
      overflowX: "auto",
      whiteSpace: "nowrap",
    });
  });
});
