// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { UIProvider } from "@/ui";

vi.mock("@/state/auth", () => ({ fetchWithAuth: vi.fn() }));

const h = vi.hoisted(() => ({
  store: {
    data: {
      report: () => ({
        spot: 25_000,
        strikes: [],
        gex: null,
        walls: null,
        wallsNear: null,
        ohlc: { low: 24_900, high: 25_100 },
        pcrOi: 1,
        pcrVol: 0.9,
        maxPain: 25_000,
        market: {},
        positioning: {},
      }),
      metrics: () => null,
      tapeRows: () => [
        { pcr_oi: 0.9, max_pain: 24_900 },
        { pcr_oi: 1.1, max_pain: 25_100 },
      ],
      setup: () => ({ gates: [] }),
      preMove: () => ({ state: "none" }),
      // Render the live-tape badge so its fill is covered by the nested-border
      // guard below — a mocked-absent badge would hide a card-inside-card.
      tapeSpeed: () => ({ ratio: 2.4, delta: 60 }),
      lastFlip: () => null,
      flowReport: () => ({ flow: "data" }),
    },
    ui: {
      isDesk: () => true,
      openPlanReasons: () => {},
      setDeskDockTab: () => {},
      setGammaOpen: () => {},
      openMovers: () => {},
    },
    selection: {
      symbol: () => "SENSEX",
      mode: () => "live",
      expiry: () => "nearest",
      date: () => null,
    },
  },
}));

vi.mock("./ReportContext", () => ({ useNiftyReport: () => h.store }));
vi.mock("./deskPlan", () => ({
  buildDeskPlan: () => ({
    bias: "neutral",
    spot: 25_000,
    bull: { action: "buy", entryTrigger: 0, stop: 0, target: 0, rr: 0, reasons: [] },
    bear: { action: "sell", entryTrigger: 0, stop: 0, target: 0, rr: 0, reasons: [] },
  }),
}));
vi.mock("./deskPlanSummary", () => ({
  summarizeDeskPlan: () => ({
    headline: "NEUTRAL · no trade",
    confidence: 0,
    tone: "neutral",
    action: "wait",
  }),
}));
vi.mock("./NiftyVerdictStrip", () => ({
  NiftyVerdictStrip: () => <div data-testid="nifty-verdict-strip" />,
  resolveRegimeLabel: () => "NEUTRAL",
  regimeAccent: () => "currentColor",
  regimeDetail: () => "detail",
}));
vi.mock("./niftyGex", () => ({ gexFlipAtSpot: () => null }));
vi.mock("./niftyPin", () => ({ pinRisk: () => null, pinHint: () => "" }));
vi.mock("./niftyWallsFormat", () => ({ resolveWallBoard: () => null }));
vi.mock("./NiftyFlowWindows", () => ({
  NiftyFlowWindows: () => <div data-testid="nifty-flow-windows" />,
}));
vi.mock("./IndexMoversStrip", () => ({
  IndexMoversStrip: () => <div data-testid="movers-strip" />,
}));
vi.mock("./NiftyIntelStrip", () => ({ NiftyIntelStrip: () => null }));
vi.mock("./NiftyGammaStrip", () => ({ NiftyGammaStrip: () => null }));
vi.mock("./SetupRadarStrip", () => ({ SetupRadarStrip: () => null }));
vi.mock("./reportBits", () => ({
  LiveTapeDisclosure: (props: any) => <div data-testid={props.testId}>{props.children}</div>,
}));

import { ReportDecisionStrip } from "./ReportDecisionStrip";
import {
  REPORT_GUTTER,
  REPORT_SECTION_ALIGN,
  REPORT_SECTION_ATTR,
  REPORT_TOP_LEVEL_SECTIONS,
} from "./reportTokens";

const source = (name: string) =>
  readFileSync(resolve(process.cwd(), "src/pages/report", name), "utf8");

function mount() {
  return render(() => (
    <UIProvider>
      <ReportDecisionStrip />
    </UIProvider>
  ));
}

function isCardBorder(el: HTMLElement): boolean {
  const cls = typeof el.className === "string" ? el.className : "";
  if (/\bborder-transparent\b/.test(cls)) return false;
  const fullClass = /(?:^|\s)border(?:\s|$)/.test(cls);
  const inline = el.style.border ?? "";
  return fullClass || (inline.length > 0 && !inline.includes("transparent"));
}

afterEach(cleanup);

describe("Index Report — one grid, one border per section", () => {
  test("(a) every top-level section is pinned to the shared left-edge contract", () => {
    mount();
    for (const id of ["nifty-stat-strip", "nifty-flow-windows", "movers-strip"]) {
      const section = screen.getByTestId(id);
      const marker = section.closest(`[${REPORT_SECTION_ATTR}]`);
      expect(marker, `${id} must share the section marker`).not.toBeNull();
    }

    // Sections rendered by other lanes are aligned by the shell's descendant
    // rules, which are the second half of the same contract.
    const shell = source("NiftyReportShell.tsx");
    expect(REPORT_SECTION_ATTR).toBe("data-report-section");
    expect(shell).toContain("REPORT_SECTION_ATTR");
    expect(REPORT_TOP_LEVEL_SECTIONS).toEqual([
      "nifty-toolbar",
      "nifty-stat-strip",
      "nifty-flow-windows",
      "movers-strip",
      "nifty-main-row",
      "desk-insight-rail",
      "desk-dock-region",
    ]);
    for (const id of ["nifty-toolbar", "nifty-chart-panel", "nifty-main-row"]) {
      expect(REPORT_SECTION_ALIGN.panel + REPORT_SECTION_ALIGN.content, id).toContain(id);
    }
  });

  test("(b) section gutters are 8px and inline items stay at 4px", () => {
    expect(REPORT_GUTTER).toEqual({ inline: 4, section: 8, outer: 16 });
    const shell = source("NiftyReportShell.tsx");
    // The gap is expressed once, in the token, not as a 4px class in the shell.
    expect(shell).toContain("REPORT_GUTTER.section");
    expect(shell).not.toContain('gap: "4px"');
    expect(shell).not.toContain("flex flex-col gap-1 ");
    // No dead band: the stretched row may grow past the old 58vh cap.
    expect(REPORT_SECTION_ALIGN.content).toContain("nifty-main-row");
    expect(REPORT_SECTION_ALIGN.content).toContain("max-h-none!");
  });

  test("(c) no card border nested inside the bordered stat strip", () => {
    mount();
    const strip = screen.getByTestId("nifty-stat-strip");
    expect(isCardBorder(strip)).toBe(true); // the one section border
    const nested = Array.from(strip.querySelectorAll("*")) as HTMLElement[];
    const offenders = nested.filter(isCardBorder);
    expect(offenders.map((el) => el.getAttribute("data-testid"))).toEqual([]);
    // Chips and the plan line use a tint, derived from the palette anchor.
    expect(strip.querySelector('[data-testid="nifty-chip-setup"]')).not.toBeNull();
    for (const id of ["nifty-chip-setup", "nifty-chip-intel", "nifty-chip-gamma", "nifty-plan-tape"]) {
      const el = screen.getByTestId(id);
      expect(el.style.border, `${id} must not draw a second border`).toBe("");
      expect(el.style.backgroundColor, `${id} must use a palette tint`).toContain("rgba");
    }
    expect(screen.getByTestId("nifty-plan-oneliner").style.border).toBe("");
  });

  test("(d) every testid asserted by the report suites survives", () => {
    mount();
    for (const id of [
      "nifty-stat-strip",
      "nifty-decision-stats",
      "nifty-context-stats",
      "nifty-stat-group-price",
      "nifty-stat-group-walls",
      "nifty-stat-group-volatility",
      "nifty-stat-group-flow",
      "nifty-stat-spot",
      "nifty-stat-spot-value",
      "nifty-stat-regime",
      "nifty-stat-regime-value",
      "nifty-stat-flip",
      "nifty-stat-flip-value",
      "nifty-stat-call-wall",
      "nifty-stat-call-wall-value",
      "nifty-stat-put-wall",
      "nifty-stat-put-wall-value",
      "nifty-stat-pin",
      "nifty-stat-pin-value",
      "nifty-stat-max-pain",
      "nifty-pcr-spark",
      "nifty-maxpain-spark",
      "nifty-chip-setup",
      "nifty-chip-intel",
      "nifty-chip-gamma",
      "nifty-verdict-wrap",
      "nifty-verdict-strip",
      "nifty-plan-oneliner",
      "nifty-plan-headline",
      "nifty-plan-confidence",
      "nifty-plan-reasons-button",
      "nifty-flow-windows",
      "movers-strip",
      "nifty-india-vix-label",
    ]) {
      expect(screen.getByTestId(id), id).toBeInTheDocument();
    }
  });
});
