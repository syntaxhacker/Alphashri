// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, test, vi } from "vitest";

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
      tapeRows: () => [],
      setup: () => ({ gates: [] }),
      preMove: () => ({ state: "none" }),
      tapeSpeed: () => null,
      lastFlip: () => null,
      flowReport: () => null,
    },
    ui: {
      isDesk: () => true,
      openPlanReasons: () => {},
      setDeskDockTab: () => {},
      setGammaOpen: () => {},
      openMovers: () => {},
    },
    selection: {
      symbol: () => "NIFTY",
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
    headline: "NEUTRAL · no trade — wait for a trigger",
    confidence: 0,
    tone: "neutral",
    action: "wait",
  }),
}));

vi.mock("./reportCells", () => ({
  DecisionCell: (props: any) => (
    <div data-testid={props.testId}>
      <span>{props.label}</span>
      <span data-testid={`${props.testId}-value`}>{props.value}</span>
    </div>
  ),
  ContextCell: (props: any) => (
    <div data-testid={props.testId}>
      <span>{props.label}</span>
      <span>{props.value}</span>
    </div>
  ),
  DecisionChip: (props: any) => (
    <button data-testid={props.testId} onClick={() => props.onClick()}>
      {props.label} {props.value}
    </button>
  ),
  NiftySpotValue: (props: any) => <span>{props.fallback}</span>,
  formatOiCr: () => "1 Cr",
  formatSignedPoints: () => "+0 pts",
}));

vi.mock("./NiftyVerdictStrip", () => ({
  NiftyVerdictStrip: () => (
    <div data-testid="nifty-verdict-strip">
      <span data-testid="nifty-verdict-control">SESSION</span>
      <span data-testid="nifty-verdict-vix">VIX</span>
      <span data-testid="nifty-verdict-strength">STRONG</span>
    </div>
  ),
  resolveRegimeLabel: () => "NEUTRAL",
  regimeAccent: () => "currentColor",
  regimeDetail: () => "detail",
}));

vi.mock("./niftyGex", () => ({ gexFlipAtSpot: () => null }));
vi.mock("./niftyPin", () => ({ pinRisk: () => null, pinHint: () => "" }));
vi.mock("./niftyWallsFormat", () => ({ resolveWallBoard: () => null }));
vi.mock("./NiftyFlowWindows", () => ({ NiftyFlowWindows: () => null }));
vi.mock("./IndexMoversStrip", () => ({ IndexMoversStrip: () => null }));
vi.mock("./NiftyIntelStrip", () => ({ NiftyIntelStrip: () => null }));
vi.mock("./NiftyGammaStrip", () => ({ NiftyGammaStrip: () => null }));
vi.mock("./SetupRadarStrip", () => ({ SetupRadarStrip: () => null }));
vi.mock("./reportBits", () => ({
  LiveTapeDisclosure: (props: any) => <div data-testid={props.testId}>{props.children}</div>,
}));

import { UIProvider } from "@/ui";
import {
  ReportDecisionStrip,
  VERDICT_BLOCK_HEIGHT,
  planConfidenceLabel,
  planHeadlineStyle,
  verdictWrapLayout,
} from "./ReportDecisionStrip";
import { REPORT_FONT, REPORT_KPI_HERO_HEIGHT } from "./reportTokens";

function mount() {
  return render(() => (
    <UIProvider>
      <ReportDecisionStrip />
    </UIProvider>
  ));
}

afterEach(cleanup);

const DECISION_VALUE_IDS = [
  "nifty-stat-spot-value",
  "nifty-stat-regime-value",
  "nifty-stat-flip-value",
  "nifty-stat-call-wall-value",
  "nifty-stat-put-wall-value",
  "nifty-stat-pin-value",
];

describe("Index Report decision strip — conclusion before evidence", () => {
  test("(a) the hero claim precedes the evidence chips in the DOM", () => {
    mount();
    const strip = screen.getByTestId("nifty-stat-strip");
    const ids = Array.from(strip.querySelectorAll("[data-testid]")).map((el) =>
      el.getAttribute("data-testid"),
    );
    const headline = ids.indexOf("nifty-plan-headline");
    const chips = ids.indexOf("nifty-verdict-strip");
    expect(headline).toBeGreaterThanOrEqual(0);
    expect(chips).toBeGreaterThan(headline);
    expect(ids.indexOf("nifty-plan-confidence")).toBeLessThan(chips);
    expect(ids.indexOf("nifty-decision-hero")).toBeLessThan(headline);
  });

  test("(b) the hero claim uses the 13px body step in the 32px KPI band", () => {
    mount();
    const headline = screen.getByTestId("nifty-plan-headline");
    expect(headline.style.fontSize).toBe(`${REPORT_FONT.body}px`);
    expect(screen.getByTestId("nifty-decision-hero").style.height).toBe(
      `${REPORT_KPI_HERO_HEIGHT}px`,
    );
    // The legacy helper contracts still hold for the narrow-layout guard.
    expect(planHeadlineStyle(false)["white-space"]).toBe("nowrap");
    expect(verdictWrapLayout(false).height).toBe(`${VERDICT_BLOCK_HEIGHT}px`);
  });

  test("(c) confidence is labelled and adjacent to the headline at ≥11px", () => {
    mount();
    const headline = screen.getByTestId("nifty-plan-headline");
    const confidence = screen.getByTestId("nifty-plan-confidence");
    expect(confidence.parentElement).toBe(headline.parentElement);
    // A neutral plan emits confidence 0 as a sentinel: no confidence copy at all,
    // so the hero keeps one status token and one reason instead of four echoes.
    expect(confidence.textContent).toBe(planConfidenceLabel(0).text);
    expect(confidence.textContent).toBe("");
    expect(Number.parseFloat(confidence.style.fontSize)).toBeGreaterThanOrEqual(
      REPORT_FONT.micro,
    );
    // The headline can no longer stretch and strand the qualifier at x1866.
    expect(planHeadlineStyle(false).flex).toBe("0 1 auto");
    expect(headline.style.flex).not.toBe("1");
  });

  test("(d) decision-cell values are right-aligned while labels stay left", () => {
    mount();
    const stats = screen.getByTestId("nifty-decision-stats");
    expect(stats.className).toContain("[data-testid$='-value']");
    expect(stats.className).toContain("text-right");
    for (const id of DECISION_VALUE_IDS) {
      expect(screen.getByTestId(id), id).toBeInTheDocument();
    }
  });

  test("(e) no text in either strip source is below the 11px floor", () => {
    const HERE = resolve(process.cwd(), "src/pages/report");
    const FONT_SIZE =
      /text-\[(\d+(?:\.\d+)?)px\]|"font-size":\s*"(\d+(?:\.\d+)?)px"|fontSize:\s*(\d+(?:\.\d+)?)\b|font-size="(\d+(?:\.\d+)?)"/g;
    const offenders = ["ReportDecisionStrip.tsx", "NiftyVerdictStrip.tsx"].flatMap((file) =>
      readFileSync(resolve(HERE, file), "utf8")
        .split("\n")
        .flatMap((line, i) =>
          [...line.matchAll(FONT_SIZE)]
            .map((m) => Number(m[1] ?? m[2] ?? m[3] ?? m[4]))
            .filter((px) => px < 11)
            .map((px) => `${file}:${i + 1} (${px}px)`),
        ),
    );
    expect(offenders, `\n${offenders.join("\n")}`).toEqual([]);
  });

  test("(f) every previously rendered cell/testid is still present", () => {
    mount();
    for (const id of [
      "nifty-stat-strip",
      "nifty-decision-stats",
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
      "nifty-context-stats",
      "nifty-stat-pcr-oi",
      "nifty-stat-pcr-vol",
      "nifty-stat-max-pain",
      "nifty-chip-setup",
      "nifty-chip-intel",
      "nifty-chip-gamma",
      "nifty-verdict-wrap",
      "nifty-verdict-strip",
      "nifty-plan-oneliner",
      "nifty-plan-headline",
      "nifty-plan-confidence",
      "nifty-plan-reasons-button",
      ...DECISION_VALUE_IDS,
    ]) {
      expect(screen.getByTestId(id), id).toBeInTheDocument();
    }
  });
});
