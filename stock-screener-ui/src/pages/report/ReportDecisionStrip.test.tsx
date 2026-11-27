// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";

const { mockStore } = vi.hoisted(() => ({
  mockStore: {
    data: {
      report: () => ({
        date: "2026-11-19",
        spot: 25_000,
        strikes: [],
        gex: null,
        walls: { calls: [], puts: [] },
        pcrOi: 0.9,
        pcrVol: 1.0,
        maxPain: 25_000,
        positioning: null,
        regime: null,
        market: { is_open: true },
      }),
      metrics: () => null,
      tapeRows: () => [],
      setup: () => ({
        gates: Array.from({ length: 7 }, (_, i) => ({ key: `g${i}`, pass: i < 4 })),
      }),
      preMove: () => ({ state: "quiet" }),
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
      date: () => "2026-11-19",
    },
  },
}));

vi.mock("./ReportContext", () => ({ useNiftyReport: () => mockStore }));
vi.mock("./NiftyVerdictStrip", () => ({
  NiftyVerdictStrip: () => <div data-testid="nifty-verdict-strip" />,
  resolveRegimeLabel: () => "—",
  regimeAccent: () => "",
  regimeDetail: () => "",
}));
vi.mock("./NiftyFlowWindows", () => ({ NiftyFlowWindows: () => null }));
vi.mock("./IndexMoversStrip", () => ({ IndexMoversStrip: () => null }));
vi.mock("./NiftyIntelStrip", () => ({ NiftyIntelStrip: () => null }));
vi.mock("./NiftyGammaStrip", () => ({ NiftyGammaStrip: () => null }));
vi.mock("./SetupRadarStrip", () => ({ SetupRadarStrip: () => null }));
vi.mock("./reportBits", () => ({ LiveTapeDisclosure: (props: any) => props.children }));
vi.mock("./deskPlan", () => ({
  buildDeskPlan: () => ({
    bias: "neutral",
    spot: 25_000,
    bull: { action: "", entryTrigger: 0, stop: 0, target: 0, rr: 0, reasons: [] },
    bear: { action: "", entryTrigger: 0, stop: 0, target: 0, rr: 0, reasons: [] },
  }),
}));
vi.mock("./deskPlanSummary", () => ({ summarizeDeskPlan: () => null }));
vi.mock("./niftyPin", () => ({ pinRisk: () => null, pinHint: () => "" }));

import { ReportDecisionStrip } from "./ReportDecisionStrip";
import { REPORT_FONT } from "./reportTokens";

afterEach(cleanup);

function renderStrip() {
  return render(() => (
    <UIProvider>
      <ReportDecisionStrip />
    </UIProvider>
  ));
}

describe("decision strip — labels and help", () => {
  test("the three context stats that had no help now explain themselves", () => {
    renderStrip();
    for (const id of ["nifty-stat-pcr-oi", "nifty-stat-pcr-vol", "nifty-stat-max-pain"]) {
      const title = screen.getByTestId(id).getAttribute("title") ?? "";
      expect(title.trim(), `${id} title`).not.toBe("");
      expect(title.length, `${id} title length`).toBeGreaterThan(30);
    }
    expect(screen.getByTestId("nifty-stat-pcr-oi").getAttribute("title")).toContain(
      "open interest",
    );
    expect(screen.getByTestId("nifty-stat-pcr-vol").getAttribute("title")).toContain(
      "traded volume",
    );
  });

  test("the open-interest and volume ratios say how they differ on screen", () => {
    renderStrip();
    expect(screen.getByTestId("nifty-stat-pcr-oi")).toHaveTextContent("P/C ratio · OI");
    expect(screen.getByTestId("nifty-stat-pcr-vol")).toHaveTextContent("P/C ratio · volume");
  });

  test("a dash on the gamma flip carries a specific reason, even on the value node", () => {
    renderStrip();
    const value = screen.getByTestId("nifty-stat-flip-value");
    expect(value).toHaveTextContent("—");
    expect(value.getAttribute("title")).toContain("no dealer gamma cross at spot");
    expect(screen.getByTestId("nifty-stat-flip").getAttribute("title")).toContain(
      "no dealer gamma cross at spot",
    );
    expect(screen.getByTestId("nifty-chip-gamma").getAttribute("title")).toContain(
      "does not cross zero at spot",
    );
  });

  test("undecodable chips render plain language with a full explanation", () => {
    renderStrip();
    const setup = screen.getByTestId("nifty-chip-setup");
    expect(setup).toHaveTextContent("Setup checks");
    expect(setup).toHaveTextContent("4 of 7 · quiet");
    expect(setup.getAttribute("title")).toContain("COIL, TREND, RVOL, LEVEL, WALL, GAMMA and FUEL");
    expect(setup.getAttribute("title")).toContain('"quiet" means no setup is armed');

    const intel = screen.getByTestId("nifty-chip-intel");
    expect(intel).toHaveTextContent("Institutional flows");
    expect(intel.getAttribute("title")).toContain("foreign institutional investors");
    expect(intel.getAttribute("title")).toContain("no snapshot is available");

    const gamma = screen.getByTestId("nifty-chip-gamma");
    expect(gamma).toHaveTextContent("Dealer gamma");
    expect(gamma.getAttribute("aria-label")).toContain("Dealer gamma");
  });

  test("every FLOW chip label renders whole, with no mid-word ellipsis", () => {
    renderStrip();
    const labels: Record<string, string> = {
      "nifty-chip-setup": "Setup checks",
      "nifty-chip-intel": "Institutional flows",
      "nifty-chip-gamma": "Dealer gamma",
    };
    for (const [id, fullLabel] of Object.entries(labels)) {
      const chip = screen.getByTestId(id);
      const label = chip.children[0] as HTMLElement;
      expect(label.textContent, `${id} label`).toBe(fullLabel);
      expect(label.textContent, `${id} must not be cut mid-word`).not.toMatch(/…|\.\.\./);
      expect(label.style.textOverflow || "", `${id} label ellipsis`).not.toBe("ellipsis");
      expect(chip.getAttribute("title"), `${id} title`).toContain(fullLabel);
      expect(chip.getAttribute("aria-label"), `${id} aria-label`).toContain(fullLabel);
    }
  });

  test("the gamma concept uses one vocabulary — plain dealer gamma, not Γ or GEX", () => {
    renderStrip();
    const text = screen.getByTestId("nifty-stat-strip").textContent ?? "";
    expect(text).toContain("Dealer gamma");
    expect(text).not.toMatch(/Γ|γ|GEX/);
  });

  test("the squeeze fuel readout is plain language and keeps its explanation", () => {
    // The squeeze cell only renders when fuel is present; the copy helper is
    // exercised through its source contract instead of a fabricated report.
    const source = readFileSync(
      resolve(process.cwd(), "src/pages/report/ReportDecisionStrip.groups.tsx"),
      "utf8",
    );
    expect(source).toContain('label="Squeeze fuel"');
    expect(source).toContain('value="Building ↑"');
    expect(source).toContain("Squeeze fuel: price is pinned under the call wall");
  });
});

describe("report label lane — source guards", () => {
  const HERE = resolve(process.cwd(), "src/pages/report");
  const FILES = [
    "ReportDecisionStrip.tsx",
    "NiftyVerdictStrip.tsx",
    "DeskDock.tsx",
    "NiftyIntelStrip.tsx",
    "reportCells.tsx",
  ];
  const FONT_SIZE =
    /text-\[(\d+(?:\.\d+)?)px\]|"font-size":\s*"(\d+(?:\.\d+)?)px"|fontSize:\s*(\d+(?:\.\d+)?)\b|font-size="(\d+(?:\.\d+)?)"/g;

  test("no report text is below the 11px floor", () => {
    const offenders = FILES.flatMap((file) =>
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

  test("the Greek letter and the acronym never both name dealer gamma", () => {
    const source = FILES.map((file) => readFileSync(resolve(HERE, file), "utf8")).join("\n");
    const hasGreek = source.includes("Γ") || source.includes("γ");
    const hasAcronym = /\bGEX\b/.test(source);
    expect(hasGreek && hasAcronym, "Γ and GEX must not both be used for one concept").toBe(
      false,
    );
    expect(source).toContain("Dealer gamma");
  });
});

describe("decision strip — stat labels fit without a mid-word ellipsis", () => {
  // Measured live at 1920×890 with scrollWidth vs clientWidth: the PCR label
  // cells are 148px and the flip label cell 116px at the canonical body step.
  // The long forms were 193/151/124px and clipped; the short forms below
  // measure equal to their client width. Cap the character count so a future
  // long label cannot silently reintroduce the cut.
  const PCR_MAX_CHARS = 18; // "P/C ratio · volume"
  const FLIP_MAX_CHARS = 10; // "Gamma flip"
  const ELLIPSIS = /[…]|\.\.\./;
  const BODY_PX = `${REPORT_FONT.body}px`;

  const labelOf = (id: string) => screen.getByTestId(id).children[0] as HTMLElement;

  test("(a) the PCR labels are short enough to render untruncated at the body step", () => {
    renderStrip();
    for (const [id, expected] of [
      ["nifty-stat-pcr-oi", "P/C ratio · OI"],
      ["nifty-stat-pcr-vol", "P/C ratio · volume"],
    ] as const) {
      const label = labelOf(id);
      expect(label.textContent, `${id} rendered label`).toBe(expected);
      expect(label.textContent!.length, `${id} label length`).toBeLessThanOrEqual(PCR_MAX_CHARS);
      expect(label.textContent, `${id} must show no ellipsis`).not.toMatch(ELLIPSIS);
      expect(label.style.fontSize, `${id} uses the canonical body step`).toBe(BODY_PX);
      expect(label.style.textOverflow, `${id} ellipsis style unchanged`).toBe("ellipsis");
    }
  });

  test("(b) the flip label is short enough to render untruncated at the body step", () => {
    renderStrip();
    const label = labelOf("nifty-stat-flip");
    expect(label.textContent).toBe("Gamma flip");
    expect(label.textContent!.length).toBeLessThanOrEqual(FLIP_MAX_CHARS);
    expect(label.textContent).not.toMatch(ELLIPSIS);
    expect(label.style.fontSize).toBe(BODY_PX);
    expect(label.style.textOverflow).toBe("ellipsis");
  });

  test("(c) each shortened label keeps its full text in a title", () => {
    renderStrip();
    expect(screen.getByTestId("nifty-stat-pcr-oi").getAttribute("title")).toContain(
      "Put/call ratio · open interest",
    );
    expect(screen.getByTestId("nifty-stat-pcr-vol").getAttribute("title")).toContain(
      "Put/call ratio · volume",
    );
    expect(screen.getByTestId("nifty-stat-flip").getAttribute("title")).toContain(
      "Dealer gamma flip",
    );
  });

  test("(d) every nifty-stat-* testid is still present", () => {
    renderStrip();
    for (const id of [
      "nifty-stat-strip",
      "nifty-stat-group-price",
      "nifty-stat-group-price-label",
      "nifty-stat-group-price-cells",
      "nifty-stat-spot",
      "nifty-stat-spot-value",
      "nifty-stat-regime",
      "nifty-stat-regime-value",
      "nifty-stat-flip",
      "nifty-stat-flip-value",
      "nifty-stat-group-walls",
      "nifty-stat-group-walls-label",
      "nifty-stat-group-walls-cells",
      "nifty-stat-call-wall",
      "nifty-stat-call-wall-value",
      "nifty-stat-put-wall",
      "nifty-stat-put-wall-value",
      "nifty-stat-pin",
      "nifty-stat-pin-value",
      "nifty-stat-max-pain",
      "nifty-stat-group-volatility",
      "nifty-stat-group-volatility-label",
      "nifty-stat-pcr-oi",
      "nifty-stat-pcr-vol",
      "nifty-stat-group-flow",
      "nifty-stat-group-flow-label",
      "nifty-stat-group-flow-cells",
    ]) {
      expect(screen.getByTestId(id), id).toBeInTheDocument();
    }
  });
});
