// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { REPORT_FONT } from "./reportTokens";

// Source-level rhythm contract for the two shell-owned files. Their DOM
// contracts (section order, dock keys, lazy boundaries) live in the co-located
// layout suites; this file pins the spacing/type decisions that make the dense
// desk readable without touching the panels owned by other lanes.
const HERE = join(process.cwd(), "src/pages/report");
const SHELL = readFileSync(join(HERE, "NiftyReportShell.tsx"), "utf8");
const WORKSPACE = readFileSync(join(HERE, "ReportWorkspace.tsx"), "utf8");

const LITERAL_SIZE =
  /text-\[(\d+(?:\.\d+)?)px\]|"font-size":\s*"(\d+(?:\.\d+)?)px"|font-size="(\d+(?:\.\d+)?)"/g;

function offenders(source: string): number[] {
  return [...source.matchAll(LITERAL_SIZE)]
    .map((m) => Number(m[1] ?? m[2] ?? m[3]))
    .filter((px) => px < REPORT_FONT.micro);
}

describe("Index Report shell/workspace readability rhythm", () => {
  test("no private type below the 12px floor", () => {
    expect(offenders(SHELL)).toEqual([]);
    expect(offenders(WORKSPACE)).toEqual([]);
  });

  test("the shell uses the 16/13/12 ladder with 8/12 spacings", () => {
    expect(SHELL).toContain("REPORT_FONT.value"); // 16px replay heading
    expect(SHELL).toContain("REPORT_FONT.body"); // 13px error read
    expect(SHELL).toContain("REPORT_FONT.micro"); // 12px note and unavailable labels
    expect(SHELL).toContain("pb-2"); // 8px below the toolbar
    expect(SHELL).toContain("px-3"); // 12px replay inset
    expect(SHELL).toContain("py-2"); // 8px replay inset
    expect(SHELL).toContain("gap-x-3"); // 12px between heading and note
    expect(SHELL).toContain('className="grid grid-cols-1 gap-2'); // 8px flow gutter
    // Every narrow override stays max-width gated; 1600 keeps the tuned strip.
    for (const rule of SHELL.split('"').filter((s) => s.includes("max-[600px]"))) {
      expect(rule).toContain("max-[600px]:");
    }
  });

  test("the workspace gives controls real height and 8px separation", () => {
    expect(WORKSPACE).toContain('height: "28px"'); // side tabs were 18px
    expect(WORKSPACE).toContain('"padding-left": "8px"');
    expect(WORKSPACE).toContain("gap-2 h-8 min-h-8 px-1"); // side tab bar
    expect(WORKSPACE).toContain("h-[30px] min-h-[30px] shrink-0 px-1 mb-1"); // heatmap toggle row
    expect(WORKSPACE).toContain("gap-2 shrink-0 w-full min-w-0 overflow-hidden"); // desk rail
    expect(WORKSPACE).toContain("items-stretch gap-2 w-full"); // research analytics row
    expect(WORKSPACE).toContain("minmax(0,3fr)_minmax(0,2fr)] gap-2"); // IV skew row
  });

  test("the 390 side row is content-sized and the metric controls meet 24px", () => {
    expect(WORKSPACE).toContain("max-[600px]:grid-rows-[minmax(0,1fr)_auto]");
    expect(WORKSPACE).not.toContain("minmax(0,56px)");
    expect(WORKSPACE).toContain('height: "24px"');
    expect(WORKSPACE).toContain('"min-height": "24px"');
  });

  test("the phone promotes the chart without hiding the decision or moving lazy boundaries", () => {
    // The decision strip owns a default-visible hero call; the shell keeps its
    // secondary disclosures deliberate instead of forcing them open/closed.
    expect(SHELL).not.toContain("nifty-verdict-disclosure']_[data-testid='nifty-live-tape-content']]:flex!");
    expect(SHELL).not.toContain("nifty-verdict-disclosure']_[data-testid='nifty-live-tape-toggle']]:hidden!");
    for (const rule of [
      "max-[600px]:[&_[data-testid='nifty-stat-strip']]:order-1",
      "max-[600px]:[&_[data-testid='nifty-main-row']]:order-2",
      "max-[600px]:order-3",
      "data-report-order=\"chart\"",
    ]) {
      expect(SHELL + WORKSPACE, `chart-first order: ${rule}`).toContain(rule);
    }
    for (const id of ["nifty-stat-strip", "nifty-main-row"]) {
      expect(SHELL, `data contract: ${id}`).toContain(id);
    }
  });

  test("compact chrome is shell-owned and never hides a toolbar overflow affordance", () => {
    expect(SHELL).toContain('data-compact-chrome="true"');
    expect(SHELL).toContain("max-[600px]:pb-1!");
    expect(SHELL).toContain("max-[600px]:overflow-visible!");
    expect(SHELL).toContain("max-[600px]:[&_[data-testid='nifty-replay-mode-banner']]:py-1!");
    // The shell reduced its own hand-off spacing; it does not reach into the
    // toolbar's control groups (that band owns its own single row / cue).
    expect(SHELL).not.toContain("[data-testid='nifty-view-toggle']]:hidden!");
    expect(SHELL).not.toContain("[data-testid='toolbar-group-status']]:hidden!");
  });

  test("the 390 stat strip reads as a dashboard on the shared type ladder", () => {
    for (const rule of [
      "[data-testid$='-label']]:text-ui-title!",
      "[data-testid$='-value']]:text-ui-body!",
      "]>*>*:first-child]:text-ui-micro!",
      "[data-testid$='-label']]:w-[88px]!",
      "[data-testid$='-cells']>*]:flex-row!",
      "[data-testid$='-cells']>*]:border-l-0!",
      "[data-testid$='-cells']>*]:py-0.5!",
    ]) {
      expect(SHELL, `dashboard rhythm: ${rule}`).toContain(rule);
    }
    // The workspace gives the reclaimed phone band back to the chart, but keeps
    // the original 96px track token intact for the desktop contract.
    expect(WORKSPACE).toContain("max-[600px]:grid-rows-[minmax(0,1fr)_minmax(0,80px)]!");
    expect(WORKSPACE).toContain("max-[600px]:grid-rows-[minmax(0,1fr)_minmax(0,96px)]");
  });

  test("all lazy boundaries and dock testids survive the rhythm pass", () => {
    const lazyChunks = [
      "ReportDecisionStrip",
      "ReportStrips",
      "ReportWorkspace",
      "ReportAnalytics",
      "ReportOverlays",
      "NiftyPressureDesk",
    ];
    for (const chunk of lazyChunks) expect(SHELL, chunk).toContain(`import("./${chunk}")`);
    for (const id of [
      "nifty-report-panel",
      "nifty-report-content",
      "nifty-flow-above-chart",
      "nifty-main-row",
      "nifty-side-col",
      "nifty-side-tabs",
      "desk-insight-rail",
      "nifty-analytics-row",
      "nifty-iv-skew-row",
    ]) {
      expect(SHELL + WORKSPACE, id).toContain(id);
    }
  });
});
