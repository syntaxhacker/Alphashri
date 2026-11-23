import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import {
  DECISION_CONTEXT_HEIGHT,
  DECISION_HERO_HEIGHT,
  FLOW_CELLS_MAX_WIDTH,
  VERDICT_BLOCK_HEIGHT,
  VERDICT_EVIDENCE_GAP,
  decisionEvidenceSources,
  planConfidenceLabel,
  planHeadlineStyle,
  resolveDecisionState,
  snapshotTimeLabel,
  statStripGaps,
  verdictWrapLayout,
} from "./ReportDecisionStrip";
import { REPORT_FONT, REPORT_STRIP_METRICS, groupCellGap } from "./reportTokens";

const dir = resolve(process.cwd(), "src/pages/report");
const source = (name: string) => readFileSync(resolve(dir, name), "utf8");
const lines = (name: string) => source(name).split("\n").length;

const FACADE = "ReportDecisionStrip.tsx";
const MODULES = [
  "ReportDecisionStrip.format.ts",
  "ReportDecisionStrip.derive.ts",
  "ReportDecisionStrip.groups.tsx",
  "ReportDecisionStrip.hero.tsx",
  "ReportDecisionStrip.moreStats.tsx",
  "ReportDecisionStrip.tail.tsx",
] as const;
const LINE_BUDGET = 450;

describe("ReportDecisionStrip decomposition", () => {
  test("facade and every module stay under the line budget", () => {
    expect(lines(FACADE), `${FACADE} grew past ${LINE_BUDGET} lines`).toBeLessThan(LINE_BUDGET);
    for (const module of MODULES) {
      expect(lines(module), `${module} grew past ${LINE_BUDGET} lines`).toBeLessThan(LINE_BUDGET);
    }
  });

  test("facade keeps the stable public export and re-exports the pure API", () => {
    const facade = source(FACADE);
    expect(facade).toContain("export function ReportDecisionStrip(");
    expect(facade).toContain('export * from "./ReportDecisionStrip.format"');
    for (const symbol of [
      "VERDICT_BLOCK_HEIGHT",
      "VERDICT_EVIDENCE_GAP",
      "FLOW_CELLS_MAX_WIDTH",
      "DECISION_HERO_HEIGHT",
      "DECISION_CONTEXT_HEIGHT",
      "planConfidenceLabel",
      "decisionEvidenceSources",
      "snapshotTimeLabel",
      "resolveDecisionState",
      "verdictWrapLayout",
      "planHeadlineStyle",
      "statStripGaps",
    ]) {
      expect(source("ReportDecisionStrip.format.ts"), `format dropped ${symbol}`).toContain(
        symbol,
      );
    }
  });

  test("each module keeps its stated responsibility", () => {
    const responsibilities: Record<(typeof MODULES)[number], string> = {
      "ReportDecisionStrip.format.ts": "export function resolveDecisionState(",
      "ReportDecisionStrip.derive.ts": "export function createDecisionView(",
      "ReportDecisionStrip.groups.tsx": "export function DecisionStats(",
      "ReportDecisionStrip.hero.tsx": "export function DecisionHero(",
      "ReportDecisionStrip.moreStats.tsx": "export function MoreStats(",
      "ReportDecisionStrip.tail.tsx": "export function FlowWindowsSection(",
    };
    for (const module of MODULES) {
      expect(source(module), `${module} lost its responsibility`).toContain(
        responsibilities[module],
      );
    }
  });

  test("facade delegates to every module instead of re-inlining their markup", () => {
    const facade = source(FACADE);
    for (const module of MODULES) {
      if (module === "ReportDecisionStrip.groups.tsx") {
        // The groups are composed by More stats, not re-inlined in the facade.
        expect(source("ReportDecisionStrip.moreStats.tsx"), "MoreStats lost DecisionStats").toContain(
          `./${module.replace(/\.(ts|tsx)$/, "")}"`,
        );
        continue;
      }
      expect(facade, `facade no longer imports ${module}`).toContain(
        `./${module.replace(/\.(ts|tsx)$/, "")}"`,
      );
    }
    for (const testid of [
      'data-testid="nifty-decision-hero"',
      'data-testid="nifty-decision-stats"',
      'data-testid="nifty-verdict-wrap"',
      'data-testid="nifty-plan-headline"',
      'data-testid="nifty-flow-windows-disclosure"',
      'data-testid="nifty-context-rail"',
    ]) {
      expect(facade, `facade re-inlined ${testid}`).not.toContain(testid);
    }
  });

  test("every data-testid survives the split", () => {
    const all = [FACADE, ...MODULES].map((module) => source(module)).join("\n");
    for (const testid of [
      "nifty-stat-strip",
      "nifty-decision-hero",
      "nifty-hero-spot",
      "nifty-hero-spot-read",
      "nifty-hero-change",
      "nifty-hero-change-read",
      "nifty-plan-oneliner",
      "nifty-plan-headline",
      "nifty-plan-confidence",
      "nifty-plan-tape",
      "nifty-plan-reasons-button",
      "nifty-decision-state",
      "nifty-decision-chip",
      "nifty-verdict-disclosure",
      "nifty-verdict-wrap",
      "nifty-verdict-block",
      "nifty-verdict-rail",
      "nifty-verdict-evidence",
      "nifty-verdict-divider",
      "nifty-india-vix-label",
      "nifty-decision-stats",
      "nifty-stat-group-price",
      "nifty-stat-symbol",
      "nifty-stat-change",
      "nifty-stat-spot",
      "nifty-stat-regime",
      "nifty-stat-flip",
      "nifty-stat-group-walls",
      "nifty-stat-call-wall",
      "nifty-stat-put-wall",
      "nifty-stat-pin",
      "nifty-stat-max-pain",
      "nifty-maxpain-spark",
      "nifty-stat-group-volatility",
      "nifty-context-stats",
      "nifty-squeeze-fuel",
      "nifty-stat-pcr-oi",
      "nifty-pcr-spark",
      "nifty-stat-pcr-vol",
      "nifty-stat-group-flow",
      "nifty-chip-setup",
      "nifty-chip-intel",
      "nifty-chip-gamma",
      "nifty-flow-windows-disclosure",
      "nifty-context-rail",
      "nifty-intel-cell",
      "nifty-gamma-cell",
    ]) {
      expect(
        all.includes(`data-testid="${testid}"`) ||
          all.includes(`testId="${testid}"`) ||
          all.includes(`cellsTestId="${testid}"`),
        `lost testid: ${testid}`,
      ).toBe(true);
    }
  });

  test("A++ hero and closed-state behaviour stays in the hero/format modules", () => {
    const hero = source("ReportDecisionStrip.hero.tsx");
    const format = source("ReportDecisionStrip.format.ts");
    for (const marker of [
      "No live feed — this is a stored snapshot",
      "nifty-decision-state",
      "nifty-decision-chip",
      'data-decision-kind={view.decision().kind}',
    ]) {
      expect(hero, `hero lost ${marker}`).toContain(marker);
    }
    for (const marker of [
      'stateLabel: "MARKET CLOSED"',
      'stateLabel: "AWAITING DATA"',
      'stateLabel: directional ? "LIVE READ" : "AWAITING TRIGGER"',
      "showing last snapshot",
      'reason: directional ? "" : snapshot',
    ]) {
      expect(format, `closed-state logic lost ${marker}`).toContain(marker);
    }
  });

  test("the 12/13/16 hierarchy and strip geometry stay token-driven", () => {
    const groups = source("ReportDecisionStrip.groups.tsx");
    const hero = source("ReportDecisionStrip.hero.tsx");
    const format = source("ReportDecisionStrip.format.ts");
    expect(groups).toContain("valueSize={REPORT_FONT.value}");
    expect(hero).toContain('style={{ ...HERO_CLAIM_STYLE, color: view.claimTone() }}');
    expect(format).toContain('...planHeadlineStyle(false),\n  "font-size": `${REPORT_FONT.value}px`');
    expect(format).toContain('"font-size": `${REPORT_FONT.body}px`');
    expect(format).toContain('"font-size": `${REPORT_FONT.micro}px`');
    expect(REPORT_FONT.micro).toBe(12);
    expect(REPORT_FONT.body).toBe(13);
    expect(REPORT_FONT.value).toBe(16);
  });
});

describe("decision strip pure contracts through the facade", () => {
  test("gate constants keep their measured values", () => {
    expect(VERDICT_BLOCK_HEIGHT).toBe(48);
    expect(VERDICT_EVIDENCE_GAP).toBe(8);
    expect(FLOW_CELLS_MAX_WIDTH).toBe(700);
    expect(DECISION_HERO_HEIGHT).toEqual({ narrowMax: 72, wide: 60 });
    expect(DECISION_CONTEXT_HEIGHT).toBe(28);
    expect(statStripGaps()).toEqual({
      withinGroup: REPORT_STRIP_METRICS.cellGap,
      betweenGroups: groupCellGap(),
      trailing: REPORT_STRIP_METRICS.outerPad,
      cellHeight: REPORT_STRIP_METRICS.cellHeight,
    });
  });

  test("confirmation and wrap/hint helpers preserve their contracts", () => {
    expect(planConfidenceLabel(0).text).toBe("");
    expect(planConfidenceLabel(40).text).toBe("confidence 40%");
    expect(snapshotTimeLabel("2026-11-19T10:00:00+05:30")).toBe("10:00");
    expect(snapshotTimeLabel("2026-11-19 25:99")).toBeNull();
    expect(planHeadlineStyle(false)["white-space"]).toBe("nowrap");
    expect(planHeadlineStyle(true)["white-space"]).toBe("normal");
    expect(verdictWrapLayout(false).height).toBe("48px");
    expect(verdictWrapLayout(true).direction).toBe("column");
  });

  test("closed state names the snapshot and never asserts an unbacked claim", () => {
    const closed = resolveDecisionState({
      marketClosed: true,
      eod: false,
      snapshotTime: "10:00",
      evidenceSources: decisionEvidenceSources({
        gexPresent: false,
        hasWalls: false,
        hasTape: false,
        hasFlow: false,
        vixPresent: false,
        setupReady: false,
      }),
      headline: "BEARISH · sell",
      confidenceComputed: true,
    });
    expect(closed).toEqual({
      kind: "closed",
      stateLabel: "MARKET CLOSED",
      claim: "",
      chip: "closed",
      reason: "showing 10:00 snapshot",
    });
    const live = resolveDecisionState({
      marketClosed: false,
      eod: false,
      snapshotTime: null,
      evidenceSources: ["chain"],
      headline: "BULLISH · buy",
      confidenceComputed: true,
    });
    expect(live.kind).toBe("live");
    expect(live.stateLabel).toBe("LIVE READ");
    expect(live.claim).toBe("BULLISH · buy");
    expect(live.chip).toBe("decision");
    expect(live.reason).toBe("");
  });
});
