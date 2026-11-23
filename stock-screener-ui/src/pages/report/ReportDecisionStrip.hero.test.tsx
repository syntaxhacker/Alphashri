// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { UIProvider } from "@/ui";
import * as palette from "@/ui/palette";

const h = vi.hoisted(() => ({
  state: {
    report: {
      date: "2026-11-19",
      spot: 22_363,
      strikes: [],
      gex: null,
      regime: null,
      control: null,
      vix: null,
      walls: { calls: [], puts: [] },
      pcrOi: 0.6,
      pcrVol: 1.21,
      maxPain: 22_400,
      market: { is_open: false, as_of: "2026-11-19T10:00:00+05:30" },
    } as any,
    tapeRows: [] as any[],
    flowReport: null as any,
    gates: [] as any[],
    plan: {
      headline: "NEUTRAL · no trade — wait for a trigger",
      action: "wait",
      confidence: 0,
      tone: "neutral",
    } as any,
    symbol: "NIFTY",
    mode: "live",
  },
}));

vi.mock("@/state/auth", () => ({ fetchWithAuth: vi.fn() }));
vi.mock("./ReportContext", () => ({
  useNiftyReport: () => ({
    data: {
      report: () => h.state.report,
      metrics: () => null,
      tapeRows: () => h.state.tapeRows,
      setup: () => ({ gates: h.state.gates }),
      preMove: () => ({ state: "quiet" }),
      tapeSpeed: () => null,
      lastFlip: () => null,
      flowReport: () => h.state.flowReport,
    },
    ui: {
      isDesk: () => true,
      openPlanReasons: () => {},
      setDeskDockTab: () => {},
      setGammaOpen: () => {},
      openMovers: () => {},
    },
    selection: {
      symbol: () => h.state.symbol,
      mode: () => h.state.mode,
      expiry: () => "nearest",
      date: () => "2026-11-19",
    },
  }),
}));
vi.mock("./deskPlan", () => ({
  buildDeskPlan: () => ({
    bias: "neutral",
    spot: 22_363,
    bull: { action: "", entryTrigger: 0, stop: 0, target: 0, rr: 0, reasons: [] },
    bear: { action: "", entryTrigger: 0, stop: 0, target: 0, rr: 0, reasons: [] },
  }),
}));
vi.mock("./deskPlanSummary", () => ({ summarizeDeskPlan: () => h.state.plan }));
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
    <button data-testid={props.testId}>
      {props.label} {props.value}
    </button>
  ),
  NiftySpotValue: (props: any) => <span>{props.fallback}</span>,
  formatOiCr: () => "0 Cr",
  formatSignedPoints: () => "+63 pts",
}));
vi.mock("./NiftyVerdictStrip", () => ({
  NiftyVerdictStrip: () => <div data-testid="nifty-verdict-strip" />,
  resolveRegimeLabel: () => "—",
  regimeAccent: () => "",
  regimeDetail: () => "",
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
  LiveTapeDisclosure: (props: any) => (
    <div data-testid={props.testId} data-open={props.open ? "true" : "false"}>
      <button data-testid="nifty-live-tape-toggle" onClick={() => props.onToggle()}>
        {props.label}
      </button>
      <div data-testid="nifty-live-tape-content" style={{ display: props.open ? "flex" : "none" }}>
        {props.children}
      </div>
    </div>
  ),
}));

import {
  DECISION_CONTEXT_HEIGHT,
  DECISION_HERO_HEIGHT,
  ReportDecisionStrip,
  decisionEvidenceSources,
  resolveDecisionState,
  snapshotTimeLabel,
} from "./ReportDecisionStrip";

function setNarrow(narrow: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: narrow && query.includes("max-width: 600px"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function mount() {
  return render(() => (
    <UIProvider>
      <ReportDecisionStrip />
    </UIProvider>
  ));
}

function reset() {
  h.state.report = {
    date: "2026-11-19",
    spot: 22_363,
    strikes: [],
    gex: null,
    regime: null,
    control: null,
    vix: null,
    walls: { calls: [], puts: [] },
    pcrOi: 0.6,
    pcrVol: 1.21,
    maxPain: 22_400,
    market: { is_open: false, as_of: "2026-11-19T10:00:00+05:30" },
  } as any;
  h.state.tapeRows = [];
  h.state.flowReport = null;
  h.state.gates = [];
  h.state.plan = {
    headline: "NEUTRAL · no trade — wait for a trigger",
    action: "wait",
    confidence: 0,
    tone: "neutral",
  };
  h.state.symbol = "NIFTY";
  h.state.mode = "live";
}

beforeEach(reset);
afterEach(cleanup);

describe("decision state helpers — no invented evidence", () => {
  test("an empty report has zero evidence sources", () => {
    expect(
      decisionEvidenceSources({
        regimeVerdict: null,
        controlVerdict: null,
        gexPresent: false,
        hasWalls: false,
        hasTape: false,
        hasFlow: false,
        vixPresent: false,
        setupReady: false,
      }),
    ).toEqual([]);
  });

  test("only named payloads count as evidence", () => {
    expect(
      decisionEvidenceSources({
        regimeVerdict: "range",
        controlVerdict: null,
        gexPresent: false,
        hasWalls: true,
        hasTape: false,
        hasFlow: false,
        vixPresent: false,
        setupReady: false,
      }),
    ).toEqual(["chain", "regime"]);
  });

  test("a snapshot clock is read only when the payload carries one", () => {
    expect(snapshotTimeLabel("2026-11-19T10:00:00+05:30")).toBe("10:00");
    expect(snapshotTimeLabel("09:05")).toBe("09:05");
    expect(snapshotTimeLabel("2026-11-19")).toBeNull();
    expect(snapshotTimeLabel(null)).toBeNull();
  });

  test("closed state prints one condition and one reason, never a no-trade verdict", () => {
    const state = resolveDecisionState({
      marketClosed: true,
      eod: false,
      snapshotTime: "10:00",
      evidenceSources: [],
      headline: "NEUTRAL · no trade",
      confidenceComputed: false,
    });
    expect(state.stateLabel).toBe("MARKET CLOSED");
    expect(state.reason).toBe("showing 10:00 snapshot");
    expect(state.claim).toBe("");
  });

  test("a live report without a backed call yields one token and one reason", () => {
    const state = resolveDecisionState({
      marketClosed: false,
      eod: false,
      snapshotTime: "10:05",
      evidenceSources: ["gamma", "regime"],
      headline: "NEUTRAL · no trade — wait for a trigger",
      confidenceComputed: false,
    });
    expect(state).toEqual({
      kind: "live",
      stateLabel: "AWAITING TRIGGER",
      claim: "",
      chip: "awaiting",
      reason: "showing 10:05 snapshot",
    });
  });
});

describe("decision hero at 390", () => {
  test("one compact hero is visible and detail sits behind one More stats disclosure", () => {
    setNarrow(true);
    mount();
    const hero = screen.getByTestId("nifty-decision-hero");
    expect(hero).toBeVisible();
    expect(hero.style.maxHeight).toBe(`${DECISION_HERO_HEIGHT.narrowMax}px`);
    expect(within(hero).getByTestId("nifty-hero-spot")).toHaveTextContent("SPOT");
    expect(within(hero).getByTestId("nifty-hero-change")).toHaveTextContent("CHANGE");

    const disclosure = screen.getByTestId("nifty-verdict-disclosure");
    expect(disclosure).toHaveAttribute("data-open", "false");
    expect(within(disclosure).getByTestId("nifty-live-tape-toggle")).toHaveTextContent("MORE STATS");
    expect(within(disclosure).getByTestId("nifty-live-tape-content").style.display).toBe("none");
    // Detail stays in the DOM so every preserved testid is still reachable.
    expect(within(disclosure).getByTestId("nifty-verdict-wrap")).toBeInTheDocument();
    expect(within(disclosure).getByTestId("nifty-stat-group-walls")).toBeInTheDocument();
  });

  test("missing evidence shows one closed snapshot token and one reason", () => {
    setNarrow(true);
    mount();
    const state = screen.getByTestId("nifty-decision-state");
    expect(state).toHaveTextContent("MARKET CLOSED");
    expect(state).not.toHaveTextContent("showing 10:00 snapshot");
    expect(screen.getByTestId("nifty-decision-chip")).toHaveTextContent(
      "showing 10:00 snapshot",
    );
    const headline = screen.getByTestId("nifty-plan-headline");
    expect(headline).toHaveAttribute("data-decision-kind", "closed");
    expect(headline.textContent).toBe("");
    expect(headline).not.toHaveTextContent("NEUTRAL · no trade");
    const strip = screen.getByTestId("nifty-stat-strip");
    expect(strip.textContent).not.toContain("NEUTRAL · no trade");
  });

  test("one click opens the same disclosure without losing a metric", () => {
    setNarrow(true);
    mount();
    fireEvent.click(within(screen.getByTestId("nifty-verdict-disclosure")).getByTestId("nifty-live-tape-toggle"));
    expect(screen.getByTestId("nifty-verdict-disclosure")).toHaveAttribute("data-open", "true");
    expect(screen.getByTestId("nifty-live-tape-content").style.display).toBe("flex");
    expect(screen.getByTestId("nifty-stat-group-volatility")).toBeInTheDocument();
  });

  test("a directional call only appears once evidence exists", () => {
    setNarrow(true);
    h.state.report.market = { is_open: true, as_of: "2026-11-19T10:05:00+05:30" };
    h.state.report.regime = { verdict: "range" };
    h.state.report.gex = { regime: "short", strikes: [], netTotal: 0 };
    h.state.plan = {
      headline: "BEARISH · sell premium",
      action: "sell",
      confidence: 60,
      tone: "negative",
    };
    mount();
    expect(screen.getByTestId("nifty-decision-state")).toHaveTextContent("LIVE READ");
    expect(screen.getByTestId("nifty-plan-headline")).toHaveTextContent("BEARISH · sell premium");
    expect(screen.queryByTestId("nifty-decision-chip")).toBeNull();
  });
});

describe("reduced band count", () => {
  test("1600 renders a decision header and one disclosure row, with one claim", () => {
    setNarrow(false);
    mount();
    const bands = document.querySelectorAll("[data-report-band]");
    expect(Array.from(bands).map((el) => el.getAttribute("data-report-band"))).toEqual([
      "decision-hero",
      "more-stats",
    ]);
    expect(screen.getByTestId("nifty-decision-hero").style.height).toBe(
      `${DECISION_HERO_HEIGHT.wide}px`,
    );
    expect((document.querySelector('[data-report-band="more-stats"]') as HTMLElement).style.minHeight).toBe(
      `${DECISION_CONTEXT_HEIGHT}px`,
    );
    expect(screen.getAllByTestId("nifty-plan-headline")).toHaveLength(1);
    expect(screen.getAllByTestId("nifty-plan-oneliner")).toHaveLength(1);
    expect(screen.getAllByTestId("nifty-verdict-strip")).toHaveLength(1);
    expect(screen.getByTestId("nifty-stat-strip").textContent).not.toContain("NEUTRAL · no trade");
  });

  test("390 keeps the same two bands", () => {
    setNarrow(true);
    mount();
    expect(document.querySelectorAll("[data-report-band]")).toHaveLength(2);
    expect(screen.getAllByTestId("nifty-plan-headline")).toHaveLength(1);
  });
});

describe("decision hero — one status token, neutral tone, no duplicate copy", () => {
  function mountLiveWithoutCall() {
    setNarrow(false);
    h.state.report.market = { is_open: true, as_of: "2026-11-19T10:05:00+05:30" };
    h.state.report.regime = { verdict: "range" };
    h.state.report.gex = { regime: "short", strikes: [], netTotal: 0 };
    h.state.plan = {
      headline: "NEUTRAL · no trade — wait for a trigger",
      action: "wait",
      confidence: 0,
      tone: "neutral",
    };
    return mount();
  }

  test("prints one AWAITING TRIGGER badge and one snapshot reason", () => {
    mountLiveWithoutCall();
    const hero = screen.getByTestId("nifty-decision-hero");
    const state = within(hero).getByTestId("nifty-decision-state");
    expect(state.textContent).toBe("AWAITING TRIGGER");
    expect(within(hero).getByTestId("nifty-decision-chip").textContent).toBe(
      "showing 10:05 snapshot",
    );
    expect(hero.textContent!.match(/AWAITING TRIGGER/g) ?? []).toHaveLength(1);
    expect(hero.textContent!.match(/awaiting trigger/gi) ?? []).toHaveLength(1);
    expect(screen.getByTestId("nifty-plan-headline").textContent).toBe("");
    expect(screen.getByTestId("nifty-plan-confidence").textContent).toBe("");
  });

  test("never prints NO DIRECTIONAL CALL, not computed or a second reason", () => {
    mountLiveWithoutCall();
    const hero = screen.getByTestId("nifty-decision-hero");
    const text = hero.textContent ?? "";
    expect(text).not.toMatch(/no directional call/i);
    expect(text).not.toContain("not computed");
    expect(text).not.toContain("NEUTRAL · no trade");
    expect(within(hero).getAllByTestId("nifty-decision-state")).toHaveLength(1);
    expect(within(hero).getAllByTestId("nifty-decision-chip")).toHaveLength(1);
  });

  test("the awaiting status is amber/neutral, never positive green", () => {
    mountLiveWithoutCall();
    const state = screen.getByTestId("nifty-decision-state");
    expect([palette.WARNING, palette.TEXT_MUTED]).toContain(state.style.color);
    expect(state.style.color).not.toBe(palette.POSITIVE);
    expect(screen.getByTestId("nifty-plan-headline").style.color).toBe(palette.TEXT_MUTED);
  });

  test("SPOT and CHANGE stay one compact stat", () => {
    mountLiveWithoutCall();
    const hero = screen.getByTestId("nifty-decision-hero");
    const spot = within(hero).getByTestId("nifty-hero-spot");
    const change = within(hero).getByTestId("nifty-hero-change");
    expect(spot.parentElement).toBe(change.parentElement);
    expect(within(hero).getAllByTestId("nifty-hero-spot")).toHaveLength(1);
    expect(within(hero).getAllByTestId("nifty-hero-change")).toHaveLength(1);
  });
});
