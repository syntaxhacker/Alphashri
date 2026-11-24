import { describe, expect, it } from "vitest";
import {
  createReportWindowFor,
  getReportPanelSpec,
  REPORT_WINDOW_PANELS,
  REPORT_WINDOW_TYPES,
  reportPanelNeedsStore,
} from "./reportWindowPanels";
import {
  REPORT_PANEL_AVAILABILITY,
  REPORT_PANEL_TITLES,
  REPORT_WINDOW_KEYS,
  REPORT_STORE_PANEL_KEYS,
} from "./reportWindowTypes";

describe("report window panel registry", () => {
  it("exposes exactly the six contracted keys, page-scoped to report", () => {
    expect(REPORT_WINDOW_TYPES).toEqual([...REPORT_WINDOW_KEYS]);
    expect(REPORT_WINDOW_PANELS.map((spec) => spec.id)).toEqual([...REPORT_WINDOW_KEYS]);
    expect(REPORT_WINDOW_PANELS.every((spec) => spec.page === "report")).toBe(true);
  });

  it("gives every panel a descriptive registry-owned title and a full dock shape", () => {
    for (const spec of REPORT_WINDOW_PANELS) {
      const key = spec.id as (typeof REPORT_WINDOW_KEYS)[number];
      expect(spec.title, key).toBe(REPORT_PANEL_TITLES[key]);
      expect(spec.title.length, key).toBeGreaterThan(3);
      expect(typeof spec.mount, key).toBe("function");
      expect(Array.isArray(spec.requires), key).toBe(true);
      expect(typeof spec.singleton, key).toBe("boolean");
      expect(spec.minWidth, key).toBeGreaterThan(0);
      expect(spec.size, key).toBeGreaterThan(0);
    }
  });

  it("looks up a known spec and returns undefined for an unknown id", () => {
    expect(getReportPanelSpec("chain")?.title).toBe("OPTIONS CHAIN");
    expect(getReportPanelSpec("chart")?.title).toBe("INDEX CHART");
    expect(getReportPanelSpec("removed.panel")).toBeUndefined();
  });

  it("creates a deterministic window with a finite rect and the registry title", () => {
    const win = createReportWindowFor("chain");
    expect(win).toMatchObject({
      id: "chain-1",
      type: "chain",
      title: "OPTIONS CHAIN",
      z: 1,
      minimized: false,
      maximized: false,
    });
    for (const value of [win.x, win.y, win.w, win.h]) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(win.w).toBeGreaterThan(0);
    expect(win.h).toBeGreaterThan(0);
    expect(createReportWindowFor("removed.panel").title).toBe("removed.panel");
  });

  it("declares which panels need the live report store in the context bag", () => {
    for (const key of REPORT_STORE_PANEL_KEYS) {
      expect(reportPanelNeedsStore(key), key).toBe(true);
      expect(REPORT_PANEL_AVAILABILITY[key].needsReportStore, key).toBe(true);
      expect(REPORT_PANEL_AVAILABILITY[key].key, key).toBe(key);
    }
    for (const key of ["chain", "analytics"] as const) {
      expect(reportPanelNeedsStore(key), key).toBe(false);
      expect(REPORT_PANEL_AVAILABILITY[key].mountSource, key).toBe("window-registry");
    }
  });
});
