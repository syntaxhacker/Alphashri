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
  // The compact evidence cells carry their full read in `title`, the way the
  // real verdict strip does. The popover test needs those nodes to prove no
  // evidence string is dropped when the columns stop colliding.
  NiftyVerdictStrip: () => (
    <div
      data-testid="nifty-verdict-strip"
      className="flex flex-nowrap items-stretch w-full min-w-0 min-h-6 overflow-hidden [&>*]:flex-[1_1_0] [&>*]:min-w-0"
    >
      <div
        data-testid="nifty-verdict-control"
        title="SESSION · CALL WRITING — ΔOI (chain) C +372K P — · skew -0.11"
      />
      <div data-testid="nifty-coil-gauge" title="COIL — 0.0x · RV — / IV —" />
      <div data-testid="nifty-verdict-vix" title="VIX 17.21 (+0.04%) — day 17.04–17.32" />
      <div data-testid="nifty-verdict-strength" title="WEAK — score 0.0 · RSI —" />
    </div>
  ),
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
  ReportDecisionStrip,
  decisionEvidenceSources,
  resolveDecisionState,
  snapshotTimeLabel,
} from "./ReportDecisionStrip";
import { REPORT_KPI_HERO_HEIGHT } from "./reportTokens";

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
    expect(hero.style.minHeight).toBe(`${REPORT_KPI_HERO_HEIGHT}px`);
    expect(hero.style.maxHeight).toBe("");
    expect(within(hero).getByTestId("nifty-kpi-spot")).toHaveTextContent("SPOT");
    expect(within(hero).queryByTestId("nifty-hero-change")).not.toBeInTheDocument();

    const disclosure = screen.getByTestId("nifty-verdict-disclosure");
    expect(disclosure).toHaveAttribute("data-open", "false");
    const toggle = within(disclosure).getByTestId("nifty-live-tape-toggle");
    expect(toggle).toHaveTextContent("ALL STATS");
    expect(toggle).not.toHaveTextContent("MORE STATS");
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
    expect(screen.getByTestId("nifty-decision-state")).toHaveTextContent("BEARISH");
    expect(screen.getByTestId("nifty-plan-headline")).toHaveTextContent("sell premium");
    expect(screen.getByTestId("nifty-plan-headline")).not.toHaveTextContent("BEARISH");
    expect(screen.queryByTestId("nifty-decision-chip")).toBeNull();
  });
});

describe("reduced band count", () => {
  test("1600 renders one decision band with an inline disclosure, with one claim", () => {
    setNarrow(false);
    mount();
    const bands = document.querySelectorAll("[data-report-band]");
    expect(Array.from(bands).map((el) => el.getAttribute("data-report-band"))).toEqual([
      "decision-hero",
      "decision-band",
    ]);
    expect(screen.getByTestId("nifty-decision-hero").style.height).toBe(
      `${REPORT_KPI_HERO_HEIGHT}px`,
    );
    expect(screen.getByTestId("nifty-kpi-hero").style.height).toBe("32px");
    expect(document.querySelector('[data-report-band="more-stats"]')).toBeNull();
    expect(screen.getAllByTestId("nifty-plan-headline")).toHaveLength(1);
    expect(screen.getAllByTestId("nifty-plan-oneliner")).toHaveLength(1);
    expect(screen.getAllByTestId("nifty-verdict-strip")).toHaveLength(1);
    expect(screen.getByTestId("nifty-stat-strip").textContent).not.toContain("NEUTRAL · no trade");
  });

  test("390 keeps the same single band", () => {
    setNarrow(true);
    mount();
    expect(document.querySelectorAll("[data-report-band]")).toHaveLength(2);
    expect(screen.getAllByTestId("nifty-kpi-hero")).toHaveLength(1);
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
    expect([palette.PRIMARY, palette.TEXT_MUTED]).toContain(state.style.color);
    expect(state.style.color).not.toBe(palette.POSITIVE);
    expect(screen.getByTestId("nifty-plan-headline").style.color).toBe(palette.TEXT_MUTED);
  });

  test("SPOT appears once in the band's token row, not in a second hero", () => {
    mountLiveWithoutCall();
    const hero = screen.getByTestId("nifty-decision-hero");
    expect(within(hero).getAllByTestId("nifty-kpi-spot")).toHaveLength(1);
    expect(hero.textContent!.match(/SPOT/g) ?? []).toHaveLength(1);
    expect(within(hero).queryByTestId("nifty-hero-spot")).not.toBeInTheDocument();
  });
});

describe("collapsed top section — one decision band", () => {
  function mountDirectional() {
    setNarrow(false);
    h.state.report.market = { is_open: true, as_of: "2026-11-19T10:05:00+05:30" };
    h.state.report.regime = { verdict: "trend" };
    h.state.report.gex = { regime: "short", strikes: [], netTotal: 0 };
    h.state.plan = {
      headline: "BEARISH · sell at 22,300 · cut 22,450 · target 22,100",
      action: "sell",
      confidence: 83,
      tone: "negative",
    };
    return mount();
  }

  test("a single 32px band owns the verdict chip, action levels and percentage once", () => {
    mountDirectional();
    expect(screen.getAllByTestId("nifty-kpi-hero")).toHaveLength(1);
    const band = screen.getByTestId("nifty-kpi-hero");
    expect(band.style.height).toBe("32px");
    expect(band.textContent!.match(/SPOT/g) ?? []).toHaveLength(1);
    const headline = within(band).getByTestId("nifty-plan-headline");
    expect(headline).toHaveTextContent("sell at 22,300");
    expect(headline).toHaveTextContent("cut 22,450");
    expect(headline).toHaveTextContent("target 22,100");
    const percent = within(band).getByTestId("nifty-plan-confidence");
    expect(percent.textContent).toBe("83%");
    expect(percent.textContent).not.toContain("confidence");
    expect(band.textContent).not.toMatch(/confidence\s+confidence/i);
    expect(within(band).getByTestId("nifty-decision-state")).toHaveTextContent("BEARISH");
  });

  test("ALL STATS is a compact button inside the band and its disclosure still works", () => {
    mountDirectional();
    const band = screen.getByTestId("nifty-kpi-hero");
    const disclosure = within(band).getByTestId("nifty-verdict-disclosure");
    const toggle = within(disclosure).getByTestId("nifty-live-tape-toggle");
    expect(toggle.className).not.toContain("w-full");
    expect(toggle.textContent).not.toContain("walls · volatility · evidence");
    expect(within(disclosure).getByTestId("nifty-live-tape-content").style.display).toBe("none");
    fireEvent.click(toggle);
    expect(disclosure).toHaveAttribute("data-open", "true");
    expect(within(disclosure).getByTestId("nifty-live-tape-content").style.display).toBe("flex");
    expect(within(disclosure).getByTestId("nifty-verdict-wrap")).toBeInTheDocument();
    expect(within(disclosure).getByTestId("nifty-stat-group-walls")).toBeInTheDocument();
    expect(document.querySelectorAll('[data-testid="nifty-verdict-disclosure"]')).toHaveLength(1);
  });

  test("no full-width ALL STATS row sits between the band and the chart", () => {
    mountDirectional();
    expect(document.querySelectorAll('[data-report-band]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-report-band="more-stats"]')).toHaveLength(0);
  });

  test("replay / closed market carries a stored-snapshot chip and no live claim", () => {
    setNarrow(false);
    h.state.mode = "eod";
    mount();
    const band = screen.getByTestId("nifty-kpi-hero");
    expect(within(band).getByTestId("nifty-decision-state")).toHaveTextContent("MARKET CLOSED");
    expect(within(band).getByTestId("nifty-plan-headline").textContent).toBe("");
  });

  test("a directional call reads as one semantic verdict chip plus levels", () => {
    mountDirectional();
    const band = screen.getByTestId("nifty-kpi-hero");
    const chip = within(band).getByTestId("nifty-decision-state");
    expect(chip).toHaveTextContent("BEARISH");
    expect(chip.style.color).toBe(palette.NEGATIVE);
    const headline = within(band).getByTestId("nifty-plan-headline");
    expect(headline.textContent).not.toMatch(/bearish|bullish|neutral/i);
    expect(headline).toHaveTextContent("sell at 22,300");
    expect(headline).toHaveTextContent("cut 22,450");
    expect(headline).toHaveTextContent("target 22,100");
  });

  test("SPOT and confidence each appear once in the band", () => {
    mountDirectional();
    const band = screen.getByTestId("nifty-kpi-hero");
    expect(within(band).getAllByTestId("nifty-kpi-spot")).toHaveLength(1);
    expect(band.textContent!.match(/SPOT/g) ?? []).toHaveLength(1);
    expect(within(band).getAllByTestId("nifty-plan-confidence")).toHaveLength(1);
    expect(band.textContent!.match(/83%/g) ?? []).toHaveLength(1);
  });
});

describe("expanded ALL STATS — bounded popover, fixed band", () => {
  function open() {
    setNarrow(false);
    h.state.report.market = { is_open: true, as_of: "2026-11-19T10:05:00+05:30" };
    h.state.report.regime = { verdict: "trend" };
    h.state.report.gex = { regime: "short", strikes: [], netTotal: 0 };
    h.state.plan = {
      headline: "BEARISH · sell at 22,300 · cut 22,450 · target 22,100",
      action: "sell",
      confidence: 83,
      tone: "negative",
    };
    mount();
    const toggle = screen.getByTestId("nifty-live-tape-toggle");
    fireEvent.click(toggle);
    return {
      toggle,
      disclosure: screen.getByTestId("nifty-verdict-disclosure"),
      content: screen.getByTestId("nifty-live-tape-content"),
      band: screen.getByTestId("nifty-kpi-hero"),
      hero: screen.getByTestId("nifty-decision-hero"),
    };
  }

  test("opening the detail never grows the 32px band or the hero", () => {
    const { band, hero, disclosure, content } = open();
    expect(disclosure).toHaveAttribute("data-open", "true");
    expect(content.style.display).toBe("flex");
    expect(band.style.height).toBe("32px");
    expect(band.style.minHeight).toBe("32px");
    expect(hero.style.height).toBe(`${REPORT_KPI_HERO_HEIGHT}px`);
    expect(content.closest('[data-testid="nifty-kpi-hero"]')).toBe(band);
  });

  test("detail is a fixed, bounded, scrollable popover owned by the band", () => {
    const { content } = open();
    expect(content.style.position).toBe("fixed");
    expect(Number.parseInt(content.style.zIndex, 10)).toBeGreaterThan(0);
    expect(Number.parseInt(content.style.maxHeight, 10)).toBeGreaterThan(0);
    expect(content.style.overflowY).toBe("auto");
    expect(content.style.overflowX).toBe("hidden");
    expect(content.style.boxShadow).toContain("inset");
    // The grid belongs to the stats surface, not to the popover shell: two
    // fixed tracks at 720px and one at 390px, never an `auto-fit` guess.
    const stats = within(content).getByTestId("nifty-decision-stats");
    expect(stats.getAttribute("data-stat-layout")).toBe("popover-grid");
    expect(stats.className).toContain("grid-cols-1");
    expect(stats.className).toContain("min-[601px]:grid-cols-2");
    expect(stats.className).not.toContain("auto-fit");
    expect(content.className).toContain("[&>*]:shrink-0!");
  });

  test("measured geometry: capped at 1600, a full-width scroll sheet at 390", () => {
    const { content } = open();
    const originalWidth = window.innerWidth;
    try {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 1600 });
      fireEvent.resize(window);
      expect(content.style.width).toBe("720px");
      expect(content.style.maxHeight).toBe("420px");
      expect(content.style.overflowY).toBe("auto");

      Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
      fireEvent.resize(window);
      expect(content.style.width).toBe("374px");
      expect(content.style.left).toBe("8px");
      expect(content.style.maxHeight).toBe("420px");
      expect(content.style.overflowY).toBe("auto");
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    }
  });

  test("the toggle, Escape and an outside click each dismiss the popover", () => {
    const { toggle, disclosure, content } = open();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(disclosure).toHaveAttribute("data-open", "false");
    expect(content.style.display).toBe("none");

    fireEvent.click(toggle);
    expect(disclosure).toHaveAttribute("data-open", "true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(disclosure).toHaveAttribute("data-open", "false");

    fireEvent.click(toggle);
    expect(disclosure).toHaveAttribute("data-open", "true");
    fireEvent.click(document.body);
    expect(disclosure).toHaveAttribute("data-open", "false");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  test("the expanded surface keeps section detail without duplicating the call", () => {
    const { band, content } = open();
    expect(within(content).getByTestId("nifty-stat-group-price")).toBeInTheDocument();
    expect(within(content).getByTestId("nifty-stat-group-walls")).toBeInTheDocument();
    expect(within(content).getByTestId("nifty-stat-group-volatility")).toBeInTheDocument();
    expect(within(content).getByTestId("nifty-verdict-wrap")).toBeInTheDocument();
    expect(within(content).queryByTestId("nifty-plan-headline")).not.toBeInTheDocument();
    expect(band.textContent!.match(/SPOT/g) ?? []).toHaveLength(1);
  });
});

describe("ALL STATS popover — evidence columns never clip or overlap", () => {
  function openAt(width: number) {
    setNarrow(width <= 600);
    const original = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    mount();
    fireEvent.click(screen.getByTestId("nifty-live-tape-toggle"));
    return {
      restore: () => Object.defineProperty(window, "innerWidth", { configurable: true, value: original }),
      content: screen.getByTestId("nifty-live-tape-content"),
    };
  }

  test.each([1600, 390])("at %ipx every evidence cell is a full row with its full tooltip", (width) => {
    const { content, restore } = openAt(width);
    try {
      expect(content.style.overflowX).toBe("hidden");
      expect(content.style.overflowY).toBe("auto");

      const evidence = within(content).getByTestId("nifty-live-tape-evidence");
      expect(evidence).toHaveAttribute("data-evidence-layout", "rows");
      // The compact verdict strip is nowrap with equal flex cells in the band;
      // inside this bounded popover each cell must take a whole line instead.
      expect(evidence.className).toContain("[&_[data-testid='nifty-verdict-strip']]:flex-wrap!");
      expect(evidence.className).toContain("[&_[data-testid='nifty-verdict-strip']>*]:w-full!");
      expect(evidence.className).toContain(
        "[&_[data-testid='nifty-verdict-strip']>*]:[flex-basis:100%]!",
      );
      // One scroll owner: the inner evidence block never opens a second scroller.
      expect(evidence.style.overflow).not.toMatch(/auto|scroll/);
      expect((within(evidence).getByTestId("nifty-verdict-wrap") as HTMLElement).style.overflow).not.toMatch(
        /auto|scroll/,
      );

      const evidenceCells = [
        "nifty-verdict-control",
        "nifty-coil-gauge",
        "nifty-verdict-vix",
        "nifty-verdict-strength",
      ].map((id) => within(evidence).getByTestId(id));
      expect(evidenceCells).toHaveLength(4);
      for (const cell of evidenceCells) {
        expect(cell.getAttribute("title")).toBeTruthy();
      }
      expect(within(evidence).getByTestId("nifty-verdict-strength").getAttribute("title")).toContain(
        "score 0.0 · RSI —",
      );
      expect(within(evidence).getByTestId("nifty-coil-gauge").getAttribute("title")).toContain(
        "RV — / IV —",
      );
    } finally {
      restore();
    }
  });

  // happy-dom has no layout engine, so "no overlap" is asserted through the
  // layout contract that produces it: a 420px-capped flex column only stacks
  // sections instead of painting them on top of each other when every direct
  // child is `flex-shrink: 0` and the sections themselves are block-level.
  test.each([1600, 390])("at %ipx the capped popover scrolls instead of shrinking its sections", (width) => {
    const { content, restore } = openAt(width);
    try {
      expect(content.className).toContain("[&>*]:shrink-0!");
      expect(content.style.maxHeight).toBe("420px");
      expect(content.style.overflowY).toBe("auto");
      const evidence = within(content).getByTestId("nifty-live-tape-evidence");
      expect(evidence.className).toContain("[&>*]:shrink-0!");
      expect(evidence).toHaveAttribute("data-evidence-layout", "rows");

      // One column of whole cells: no `auto-fit` track guessing, no equal-basis
      // flex row that can clip `COIL 0.0x RV — / IV —` mid-number.
      expect(evidence.className).toContain(
        "[&_[data-testid='nifty-verdict-strip']]:grid!",
      );
      expect(evidence.className).toContain(
        "[&_[data-testid='nifty-verdict-strip']]:grid-cols-1!",
      );
      expect(evidence.className).not.toContain("auto-fit");
      for (const token of [
        "[&_[data-testid='nifty-verdict-strip']>*]:w-full!",
        "[&_[data-testid='nifty-verdict-strip']>*]:[flex:none]!",
        "[&_[data-testid^='nifty-coil-']]:whitespace-normal!",
        "[&_[data-testid$='-secondary']]:[overflow-wrap:anywhere]!",
        "[&_[data-testid^='nifty-verdict-']]:[text-overflow:clip]!",
      ]) {
        expect(evidence.className, token).toContain(token);
      }

      const wrap = within(evidence).getByTestId("nifty-verdict-wrap") as HTMLElement;
      expect(wrap.style.height).toBe("auto");
      expect(wrap.style.minHeight).toBe("0px");
      expect(wrap.style.overflow).toBe("visible");
      expect(wrap.className).toContain("flex-col");
      for (const id of [
        "nifty-verdict-control",
        "nifty-coil-gauge",
        "nifty-verdict-vix",
        "nifty-verdict-strength",
      ]) {
        expect(within(evidence).getByTestId(id).getAttribute("title")).toBeTruthy();
      }
    } finally {
      restore();
    }
  });
});

describe("single source for SPOT", () => {
  test("the strip below does not repeat the hero's SPOT value in its claim", () => {
    setNarrow(false);
    h.state.report.market = { is_open: true, as_of: "2026-11-19T10:05:00+05:30" };
    h.state.report.regime = { verdict: "trend" };
    h.state.report.gex = { regime: "short", strikes: [], netTotal: 0 };
    h.state.plan = {
      headline: "BEARISH · spot 22,363 · sell at 22,300 · cut 22,450 · target 22,100",
      action: "sell",
      confidence: 83,
      tone: "negative",
    };
    mount();
    const headline = screen.getByTestId("nifty-plan-headline");
    expect(headline.textContent).not.toMatch(/spot/i);
    expect(headline.textContent).toContain("sell at 22,300");
    expect(headline.textContent).toContain("cut 22,450");
    expect(headline.textContent).toContain("target 22,100");
  });
});
