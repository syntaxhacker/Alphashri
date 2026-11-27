// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { DockPanelSpec } from "./types";
import {
  clampPaneWidth,
  MAX_PANE_SIZE,
  MIN_PANE_SIZE,
  normalizeLayout,
  parseLayout,
  serializeLayout,
} from "./layout";

function spec(overrides: Partial<DockPanelSpec> & Pick<DockPanelSpec, "id">): DockPanelSpec {
  return {
    page: "report",
    title: overrides.id,
    size: 1,
    minWidth: 200,
    singleton: false,
    requires: [],
    mount: () => null,
    ...overrides,
  };
}

const SPECS: DockPanelSpec[] = [
  spec({ id: "report.chart", size: 1, singleton: true }),
  spec({ id: "report.walls", size: 0.5 }),
  spec({ id: "report.breadth", size: 0.42, singleton: true }),
];

describe("normalizeLayout", () => {
  it("drops an unknown pane id and appends a missing singleton at its default size", () => {
    const result = normalizeLayout(
      {
        panes: [
          { id: "report.chart", size: 1 },
          { id: "ghost.panel", size: 99 },
          { id: "report.walls", size: 0.5 },
        ],
        hidden: [],
      },
      SPECS,
    );

    expect(result.panes.map((p) => p.id)).toEqual(["report.chart", "report.walls", "report.breadth"]);
    expect(result.panes.find((p) => p.id === "report.breadth")?.size).toBe(0.42);
    expect(result.panes.some((p) => p.id === "ghost.panel")).toBe(false);
  });

  it("clamps out-of-range sizes into the sane band", () => {
    const result = normalizeLayout(
      {
        panes: [
          { id: "report.chart", size: 1000 },
          { id: "report.walls", size: -5 },
          { id: "report.breadth", size: Number.NaN },
        ],
        hidden: [],
      },
      SPECS,
    );

    expect(result.panes.map((p) => p.size)).toEqual([MAX_PANE_SIZE, MIN_PANE_SIZE, MIN_PANE_SIZE]);
  });

  it("does not re-append a singleton that is intentionally hidden", () => {
    const result = normalizeLayout({ panes: [{ id: "report.chart", size: 1 }], hidden: ["report.breadth"] }, SPECS);

    expect(result.panes.map((p) => p.id)).toEqual(["report.chart"]);
    expect(result.hidden).toEqual(["report.breadth"]);
  });

  it("degrades stale/corrupt saved layouts instead of throwing", () => {
    expect(normalizeLayout(null, SPECS).panes.map((p) => p.id)).toEqual(["report.chart", "report.breadth"]);
    expect(normalizeLayout({ panes: "oops" }, SPECS).panes.map((p) => p.id)).toEqual([
      "report.chart",
      "report.breadth",
    ]);
    expect(normalizeLayout(undefined, SPECS).panes).toHaveLength(2);
  });

  it("drops unknown ids from hidden", () => {
    const result = normalizeLayout({ panes: [], hidden: ["ghost.panel", "report.breadth"] }, SPECS);
    expect(result.hidden).toEqual(["report.breadth"]);
  });
});

describe("clampPaneWidth", () => {
  it("bounds a desired width between the pane's floor and ceiling", () => {
    expect(clampPaneWidth(1000, 0, 420)).toBe(420);
    expect(clampPaneWidth(120, 0, 420)).toBe(120);
    expect(clampPaneWidth(10, 200, 420)).toBe(200);
  });

  it("treats an absent or non-finite ceiling as unbounded above", () => {
    expect(clampPaneWidth(1000, 200)).toBe(1000);
    expect(clampPaneWidth(1000, 200, Number.NaN)).toBe(1000);
    expect(clampPaneWidth(100, 200, 50)).toBe(200); // ceiling below floor → floor wins
  });

  it("reproduces the report grid's minmax(0, 420px) side column", () => {
    const panes = [
      { id: "main", size: 1 },
      { id: "side", size: 0.42, maxWidth: 420 },
    ];
    const side = panes[1];
    expect(clampPaneWidth(Number.POSITIVE_INFINITY, 0, side.maxWidth)).toBe(420);
    expect(clampPaneWidth(0, 0, side.maxWidth)).toBe(0);
  });
});

describe("normalizeLayout maxWidth", () => {
  it("carries a valid saved maxWidth through and ignores garbage", () => {
    const wallsSpec = spec({ id: "report.walls", size: 0.42, singleton: true, maxWidth: 420 });
    const result = normalizeLayout(
      { panes: [{ id: "report.walls", size: 0.42, maxWidth: 512 }], hidden: [] },
      [wallsSpec],
    );
    expect(result.panes[0].maxWidth).toBe(512);

    const garbage = normalizeLayout(
      { panes: [{ id: "report.walls", size: 0.42, maxWidth: -5 }], hidden: [] },
      [wallsSpec],
    );
    expect(garbage.panes[0].maxWidth).toBeUndefined();
  });

  it("falls back to the spec ceiling for a re-appended singleton", () => {
    const wallsSpec = spec({ id: "report.walls", size: 0.42, singleton: true, maxWidth: 420 });
    const result = normalizeLayout({ panes: [], hidden: [] }, [wallsSpec]);
    expect(result.panes[0].maxWidth).toBe(420);
  });
});

describe("serializeLayout / parseLayout", () => {
  it("round-trips a layout through the wire", () => {
    const layout = { panes: [{ id: "report.chart", size: 1 }], hidden: ["report.breadth"] };
    expect(parseLayout(serializeLayout(layout))).toEqual(layout);
  });

  it("returns null for malformed or missing wire data", () => {
    expect(parseLayout("not json")).toBeNull();
    expect(parseLayout(null)).toBeNull();
    expect(parseLayout(undefined)).toBeNull();
    expect(parseLayout("{}")).toBeNull();
  });
});
