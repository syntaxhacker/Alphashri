// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const dir = resolve(process.cwd(), "src/pages/report");
const source = (name: string) => readFileSync(resolve(dir, name), "utf8");
const lines = (name: string) => source(name).split("\n").length;

const FACADE = "NiftyChartPanel.tsx";
const LINE_BUDGET = 450;

const MODULES: Record<string, string> = {
  "NiftyChartPanel.constants.ts": "export const CHART_PLOT_MARGIN",
  "NiftyChartPanel.annotations.tsx": "export function LevelLegend",
  "NiftyChartPanel.patterns.ts": "export function createChartPatterns",
  "NiftyChartPanel.controls.tsx": "export function ChartControls",
  "NiftyChartPanel.body.tsx": "export function ChartBody",
};

const MODULE_NAMES = Object.keys(MODULES);

describe("NiftyChartPanel decomposition", () => {
  test("every section stays under the line budget", () => {
    for (const file of [FACADE, ...MODULE_NAMES]) {
      expect(lines(file), `${file} grew past ${LINE_BUDGET} lines`).toBeLessThan(LINE_BUDGET);
    }
  });

  test("facade keeps the stable public export and re-exports", () => {
    const facade = source(FACADE);
    expect(facade).toContain("export function NiftyChartPanel(");
    for (const name of [
      "LevelLegend",
      "CHART_HEIGHTS",
      "CHART_HEADER_METRICS",
      "CHART_PLOT_MARGIN",
      "CHART_CUTOFF_RIGHT",
      "MOBILE_CHART_TARGET",
      "buildMarkLines",
      "candlePriceRange",
      "emaSeries",
      "labelGapPctFor",
      "levelBelongsToScale",
      "levelsWithinScale",
      "mergeCollidingLabels",
      "resampleCandles",
      "candlesFromSpotPoints",
      "candlesFromTape",
      "clipToAsOf",
      "isOnSession",
      "pickFreshestCandles",
      "type SpotPoint",
      "type TapeSpotPoint",
    ]) {
      expect(facade, `facade lost public export ${name}`).toContain(name);
    }
  });

  test("each module keeps its stated responsibility", () => {
    for (const [module, snippet] of Object.entries(MODULES)) {
      expect(source(module), `${module} lost its responsibility`).toContain(snippet);
    }
  });

  test("facade delegates to every section instead of re-inlining them", () => {
    const facade = source(FACADE);
    for (const module of MODULE_NAMES) {
      expect(facade, `facade no longer imports ${module}`).toContain(
        `from "./${module.replace(/\.(ts|tsx)$/, "")}"`,
      );
    }
    for (const inlined of [
      'data-testid="nifty-chart-title"',
      'data-testid="nifty-chart-controls-desktop"',
      'data-testid="nifty-chart-wrap"',
      'data-testid="nifty-patterns-strip"',
      'data-testid="nifty-depth-view"',
      'data-testid="nifty-level-legend"',
      "onChartReady={applyChartPlotMargin}",
    ]) {
      expect(facade, `facade re-inlined ${inlined}`).not.toContain(inlined);
    }
  });

  test("every chart testid survives the split", () => {
    const all = [FACADE, ...MODULE_NAMES].map(source).join("\n");
    for (const token of [
      'testId="nifty-chart-panel"',
      'data-testid="nifty-chart-title"',
      'data-testid="nifty-fyers-feed"',
      'data-testid="nifty-chart-event-badge"',
      'data-testid="nifty-chart-source"',
      'data-testid="nifty-tf-toggle"',
      'data-testid="nifty-chart-asof"',
      'data-testid="nifty-chart-expand"',
      'data-testid="nifty-chart-controls-desktop"',
      'data-testid="nifty-chart-controls-more-desktop"',
      'data-testid="nifty-chart-controls-extra-desktop"',
      'data-testid="nifty-chart-controls-mobile"',
      'data-testid="nifty-chart-controls-more"',
      'data-testid="nifty-chart-controls-extra"',
      'data-testid="nifty-chart-size"',
      'data-testid="nifty-patterns-scan"',
      'data-testid="nifty-chart-view"',
      'data-testid="nifty-chart-offline-slot"',
      'data-testid="nifty-chart-offline-empty"',
      'data-testid="nifty-chart-empty-slot"',
      'data-testid="nifty-chart-empty"',
      'data-testid="nifty-chart-wrap"',
      'data-testid="nifty-chart-last-data-boundary"',
      'data-testid="nifty-patterns-chart-badge"',
      'data-testid="nifty-patterns-empty"',
      'data-testid="nifty-patterns-run"',
      'data-testid="nifty-patterns-strip"',
      'data-testid={`nifty-pattern-${scan.hits[0].pattern_id}`}',
      'data-testid="nifty-patterns-draw"',
      'data-testid="nifty-depth-view"',
      'data-testid="nifty-level-legend"',
      'data-header-role="title"',
      'data-header-role="asof"',
    ]) {
      expect(all, `lost chart testid: ${token}`).toContain(token);
    }
  });

  test("chart geometry and cutoff domain survive the split", () => {
    const constants = source("NiftyChartPanel.constants.ts");
    const body = source("NiftyChartPanel.body.tsx");
    expect(constants).toContain('dataCutoffLane: 24');
    expect(constants).toContain('axisMinWidth: 88');
    expect(constants).toContain("edgeGutter: REPORT_PAD.md");
    expect(constants).toContain("rightOffsetPixels: CHART_PLOT_MARGIN.dataCutoffLane");
    expect(constants).toContain("minimumWidth: CHART_PLOT_MARGIN.axisMinWidth");
    expect(constants).toContain("entireTextOnly: true");
    expect(constants).toContain("s: 180, m: 320, l: 520, xl: 760");
    expect(constants).toContain("export const FILL_MAX_HEIGHT = 300");
    expect(constants).toContain("export const MOBILE_CHART_TARGET = 240");
    expect(constants).toContain("export const CHART_ROW_CHROME = 48");
    for (const token of [
      "data-mobile-chart-min={MOBILE_CHART_TARGET}",
      "data-cutoff-right={CHART_CUTOFF_RIGHT}",
      "data-cutoff-lane={CHART_PLOT_MARGIN.dataCutoffLane}",
      "data-axis-gutter={CHART_PLOT_MARGIN.edgeGutter}",
      '["--chart-cutoff-right"]: `${CHART_CUTOFF_RIGHT}px`',
      '"padding-right": `${CHART_PLOT_MARGIN.edgeGutter}px`',
      '"max-height": `${FILL_MAX_HEIGHT}px`',
      '"min-height": `${FILL_MIN_HEIGHT}px`',
      "right: \"var(--chart-cutoff-right)\"",
      "fitMarkLines",
      "onChartReady={applyChartPlotMargin}",
    ]) {
      expect(body, `lost chart geometry: ${token}`).toContain(token);
    }
  });

  test("data labels, units and feed states survive the split", () => {
    const all = [FACADE, ...MODULE_NAMES].map(source).join("\n");
    for (const token of [
      "AS OF",
      "LAST DATA",
      "No recorded data",
      "Switch to LIVE for the streamed series.",
      "No intraday candles",
      "Showing option-chain levels only.",
      "FYERS LIVE",
      "FYERS RECON",
      "FYERS CLOSED",
      "FYERS OFFLINE",
      "FYERS LINK…",
      "The page header's 'live (WS)' is the separate Upstox report stream.",
      "PATTERNS",
      "DRAW ON",
      "DRAW OFF",
      "Not scanned yet —",
      "Run {props.chartTf} scan",
      "no pattern · up to",
      "scanning…",
      "event{props.eventCount === 1 ? \"\" : \"s\"}",
      "max-OI call wall above spot · resistance",
      "max pain · expiry magnet",
    ]) {
      expect(all, `lost data/unit contract: ${token}`).toContain(token);
    }
  });

  test("A++ chart-first typography stays token-driven", () => {
    const constants = source("NiftyChartPanel.constants.ts");
    const controls = source("NiftyChartPanel.controls.tsx");
    const body = source("NiftyChartPanel.body.tsx");
    expect(constants).toContain("titleSize: REPORT_FONT.value");
    expect(constants).toContain("metaSize: REPORT_FONT.micro");
    expect(constants).toContain("gap: REPORT_PAD.md");
    expect(constants).toContain("[REPORT_FONT_BODY_VAR]: `${REPORT_FONT.micro}px`");
    expect(controls).toContain("REPORT_FONT_WEIGHT.extrabold");
    expect(controls).toContain("REPORT_LETTER_SPACING.wide");
    expect(controls).toContain("REPORT_LINE_HEIGHT.snug");
    expect(controls).toContain("REPORT_CONTROL_LABEL_CLASS");
    expect(body).toContain("REPORT_LINE_HEIGHT.snug");
    expect(body).toContain("palette.alpha(palette.SURFACE, 0.86)");
    expect(body).toContain("palette.MONO");
  });
});
