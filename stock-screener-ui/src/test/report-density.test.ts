// @vitest-environment node
/**
 * Source guard for the A++ Index Report composition.
 *
 * The report's readability is decided by a handful of source-level contracts —
 * the 12/13/16 hierarchy, the decision hero behind one More stats disclosure,
 * the labelled chart cut-off and axis gutters, the desk chain's measured width
 * budget, and the toolbar's two bands. None of these are visible in a unit
 * render, and a well-meaning refactor can erase them without failing any other
 * suite, so they are pinned against the source here.
 *
 * Every scanner and arithmetic helper below is exercised by an offender
 * fixture: a guard that cannot fail is not a guard.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const REPORT = join(SRC, "pages", "report");

const source = (name: string): string => readFileSync(join(REPORT, name), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

const SOURCE_FILES = walk(REPORT).filter((path) => !/\.(test|stories)\./.test(path));

export interface Offender {
  file: string;
  line: number;
  detail: string;
}

/** Literal `text-[Npx]` — interpolated token classes are deliberately not matched. */
const TEXT_PX = /text-\[(\d+(?:\.\d+)?)px\]/g;
/** Inline literal font sizes; `${TOKEN}px` template strings are token-driven. */
const FONT_LITERAL =
  /"font-size"\s*:\s*"(\d+(?:\.\d+)?)(?:px|em)"|fontSize\s*:\s*(\d+(?:\.\d+)?)\b|font-size\s*=\s*"(\d+(?:\.\d+)?)"/g;
/** Only positive values hijack the tab order; `tabIndex={0}` is intentional. */
const POSITIVE_TABINDEX =
  /\b(?:tabIndex|tabindex)\s*=\s*(?:\{\s*([1-9]\d*)\s*\}|["']([1-9]\d*)["'])/g;

function scan(
  file: string,
  text: string,
  pattern: RegExp,
  detail: (match: RegExpExecArray) => string,
): Offender[] {
  const out: Offender[] = [];
  text.split("\n").forEach((line, i) => {
    pattern.lastIndex = 0;
    for (const match of line.matchAll(pattern)) {
      out.push({ file, line: i + 1, detail: detail(match) });
    }
  });
  return out;
}

export function findTextPxLiterals(file: string, text: string): Offender[] {
  return scan(file, text, TEXT_PX, (m) => `text-[${m[1]}px]`);
}

export function findPrivateFontLiterals(file: string, text: string): Offender[] {
  return [
    ...findTextPxLiterals(file, text),
    ...scan(file, text, FONT_LITERAL, (m) => `private font-size ${m[1] ?? m[2] ?? m[3]}`),
  ].sort((a, b) => a.line - b.line);
}

export function findPositiveTabindex(file: string, text: string): Offender[] {
  return scan(file, text, POSITIVE_TABINDEX, (m) => `tabindex ${m[1] ?? m[2]}`);
}

export function missingMarkers(text: string, markers: readonly string[]): string[] {
  return markers.filter((marker) => !text.includes(marker));
}

export function deskChainArithmetic(
  oi: number,
  signal: number,
  strike: number,
  budget: number,
): { sum: number; fits: boolean } {
  const sum = oi * 2 + signal * 2 + strike;
  return { sum, fits: sum <= budget };
}

/** The phone axis lane must fit a full price tag; 92px is the measured floor. */
export function mobileGutterAtLeast(px: number, floor = 92): boolean {
  return Number.isFinite(px) && px >= floor;
}

function intConst(name: string, file: string): number {
  const match = source(file).match(new RegExp(`export const ${name}\\s*=\\s*(\\d+)\\s*;`));
  expect(match, `${file} no longer declares ${name}`).not.toBeNull();
  return Number(match![1]);
}

const SHELL = "NiftyReportShell.tsx";
const WORKSPACE = "ReportWorkspace.tsx";
const CHAIN_METRICS = "reportCells.chainMetrics.ts";
const CHART_CONSTANTS = "NiftyChartPanel.constants.ts";
const CHART_BODY = "NiftyChartPanel.body.tsx";
const TOOLBAR = "ReportToolbar.tsx";

function expectMarkers(file: string, markers: readonly string[]): void {
  expect(missingMarkers(source(file), markers), `${file} lost markers`).toEqual([]);
}

describe("report composition — shell hierarchy", () => {
  it("reads the 12/13/16 ladder from the shared scale, not a private fifth step", () => {
    expectMarkers("reportTokens.ts", [
      "value: TYPE_SCALE.title.size", // 16
      "body: TYPE_SCALE.body.size", // 13
      "micro: TYPE_SCALE.micro.size", // 12
      "verdict: TYPE_SCALE.display.size",
    ]);
    expectMarkers(SHELL, ["REPORT_FONT.value", "REPORT_FONT.body", "REPORT_FONT.micro"]);
  });

  it("paints no private font literal in the shell or workspace", () => {
    const offenders = [SHELL, WORKSPACE].flatMap((file) =>
      findPrivateFontLiterals(file, source(file)),
    );
    expect(offenders, `\n${offenders.map((o) => `${o.file}:${o.line} ${o.detail}`).join("\n")}`).toEqual(
      [],
    );
  });
});

describe("report composition — decision and unavailable bands", () => {
  it("keeps the decision hero and the single More stats disclosure", () => {
    expectMarkers("ReportDecisionStrip.hero.tsx", [
      "export function DecisionHero(",
      'data-testid="nifty-decision-hero"',
      'data-report-band="decision-hero"',
    ]);
    expectMarkers("ReportDecisionStrip.moreStats.tsx", [
      "export function MoreStats(",
      'data-report-band="more-stats"',
      'label="MORE STATS"',
      'testId="nifty-verdict-disclosure"',
    ]);
    expectMarkers("ReportDecisionStrip.tsx", [
      "import { DecisionHero }",
      "import { MoreStats }",
      "<DecisionHero view={view} />",
      "<MoreStats",
    ]);
  });

  it("collapses unavailable live-only bands behind one reason on a phone", () => {
    expectMarkers(SHELL, [
      "max-[600px]:[&_[data-testid='movers-strip']:not([data-report-spacing])]:hidden!",
      "max-[600px]:[&_[data-testid='desk-dock']]:flex-nowrap!",
      "max-[600px]:[&_[data-testid='desk-dock']]:overflow-x-auto!",
    ]);
    expectMarkers("BreadthStrip.tsx", [
      'REPLAY_UNAVAILABLE_TEXT = "Not captured in replay"',
      'data-replay-unavailable="true"',
    ]);
    expectMarkers("IndexMoversStrip.tsx", ["export function UnavailableBandsStrip("]);
  });
});

describe("report composition — chart boundary and gutters", () => {
  it("pins the 88px desktop / >=92px mobile axis, 24px cutoff lane and last-data marker", () => {
    expectMarkers(CHART_CONSTANTS, [
      "dataCutoffLane: 24",
      "axisMinWidth: 88",
      "export const CHART_CUTOFF_RIGHT",
      "export function applyChartPlotMargin",
    ]);
    expect(source(CHART_CONSTANTS)).toMatch(/axisMinWidth:\s*88\b/);
    expectMarkers(CHART_BODY, [
      "export const MOBILE_AXIS_MIN_WIDTH =",
      "export const MOBILE_CUTOFF_RIGHT",
      'data-testid="nifty-chart-last-data-boundary"',
      "data-cutoff-right={CHART_CUTOFF_RIGHT}",
      "data-cutoff-lane={CHART_PLOT_MARGIN.dataCutoffLane}",
      "data-mobile-axis-gutter={MOBILE_AXIS_MIN_WIDTH}",
      "--chart-cutoff-right",
    ]);
    // 92px fits a full 8-glyph tag once the volume tag is hidden; widening is
    // fine, shrinking below this measured floor is not.
    const mobileAxis = Number(
      source(CHART_BODY).match(/MOBILE_AXIS_MIN_WIDTH\s*=\s*(\d+)/)?.[1],
    );
    expect(mobileGutterAtLeast(mobileAxis), `${CHART_BODY} shrank the mobile axis gutter`).toBe(
      true,
    );
    expectMarkers("NiftyChartPanel.tsx", [
      "const lastDataBoundary = createMemo(",
      "LAST DATA",
      "lastDataBoundary={lastDataBoundary()}",
    ]);
  });
});

describe("report composition — desk chain budget", () => {
  it("spends 76+60+112+60+76 inside the measured 420px panel", () => {
    const oi = intConst("OI_DESK_OI_W", CHAIN_METRICS);
    const signal = intConst("OI_DESK_SIG_W", CHAIN_METRICS);
    const strike = intConst("OI_DESK_STRIKE_W", CHAIN_METRICS);
    const budget = intConst("OI_CHAIN_PANEL_BUDGET", CHAIN_METRICS);
    expect([oi, signal, strike, budget]).toEqual([76, 60, 112, 420]);
    expectMarkers(CHAIN_METRICS, [
      "76 + 60 + 112 + 60 + 76",
      "OI_DESK_OI_W * 2 + OI_DESK_SIG_W * 2 + OI_DESK_STRIKE_W",
      "export const OI_CHAIN_DESK_WIDTH",
    ]);
    const { sum, fits } = deskChainArithmetic(oi, signal, strike, budget);
    expect(sum).toBe(384);
    expect(fits).toBe(true);
  });
});

describe("report composition — source hygiene", () => {
  it("has no literal text-[Npx] class in report source", () => {
    const offenders = SOURCE_FILES.flatMap((path) =>
      findTextPxLiterals(relative(SRC, path), readFileSync(path, "utf8")),
    );
    expect(offenders, `\n${offenders.map((o) => `${o.file}:${o.line} ${o.detail}`).join("\n")}`).toEqual(
      [],
    );
  });

  it("never uses a positive tabindex to shortcut the DOM order", () => {
    const offenders = SOURCE_FILES.flatMap((path) =>
      findPositiveTabindex(relative(SRC, path), readFileSync(path, "utf8")),
    );
    expect(offenders, `\n${offenders.map((o) => `${o.file}:${o.line} ${o.detail}`).join("\n")}`).toEqual(
      [],
    );
  });
});

describe("report composition — toolbar bands", () => {
  it("marks two mobile bands that inline into one desktop row", () => {
    expectMarkers(TOOLBAR, [
      'data-testid="toolbar-primary-row"',
      'data-testid="toolbar-secondary-row"',
      'data-testid="toolbar-scroll-cue"',
      "min-[1200px]:flex-nowrap",
      "min-[1200px]:h-auto",
      "TOOLBAR_PRIMARY_CLASS",
      "TOOLBAR_SECONDARY_CLASS",
    ]);
    const primary = intConst("TOOLBAR_PRIMARY_HEIGHT", TOOLBAR);
    const secondary = intConst("TOOLBAR_SECONDARY_HEIGHT", TOOLBAR);
    expect([primary, secondary]).toEqual([48, 20]);
    expectMarkers(TOOLBAR, ["TOOLBAR_PRIMARY_HEIGHT + TOOLBAR_SECONDARY_HEIGHT"]);
    expect(primary + secondary).toBe(68);
  });
});

describe("report density guard — offender self-tests", () => {
  it("flags literal font sizes but accepts token-driven classes and template sizes", () => {
    const fixture = [
      '<span className="text-[11px]" />',
      '<span style={{ "font-size": "9px" }} />',
      "<span style={{ fontSize: 10 }} />",
      '<span style={{ "font-size": `${REPORT_FONT.micro}px` }} />',
      '<span className="text-ui-micro" />',
      '<span className="text-[${REPORT_FONT.xs}px]" />',
    ].join("\n");
    expect(findTextPxLiterals("fixture.tsx", fixture).map((o) => o.line)).toEqual([1]);
    expect(findPrivateFontLiterals("fixture.tsx", fixture).map((o) => o.line)).toEqual([1, 2, 3]);
  });

  it("flags positive tabindex but accepts 0, -1 and prose", () => {
    const fixture = [
      "<button tabIndex={3}>x</button>",
      '<a tabindex="1">y</a>',
      "<div tabIndex={0}>z</div>",
      "<div tabIndex={-1}>w</div>",
      "// no positive tabindex is needed (or allowed)",
    ].join("\n");
    expect(findPositiveTabindex("fixture.tsx", fixture).map((o) => o.line)).toEqual([1, 2]);
  });

  it("detects a drifted chain sum and a shrunk panel budget", () => {
    expect(deskChainArithmetic(76, 60, 112, 420)).toEqual({ sum: 384, fits: true });
    expect(deskChainArithmetic(120, 60, 112, 420)).toEqual({ sum: 472, fits: false });
    expect(deskChainArithmetic(76, 60, 112, 380)).toEqual({ sum: 384, fits: false });
  });

  it("detects a shrunk mobile axis gutter", () => {
    expect(mobileGutterAtLeast(132)).toBe(true);
    expect(mobileGutterAtLeast(144)).toBe(true);
    expect(mobileGutterAtLeast(88)).toBe(false);
    expect(mobileGutterAtLeast(Number.NaN)).toBe(false);
  });

  it("detects a missing composition marker", () => {
    expect(missingMarkers("alpha beta", ["alpha", "beta"])).toEqual([]);
    expect(missingMarkers("alpha", ["alpha", "gamma"])).toEqual(["gamma"]);
  });
});
