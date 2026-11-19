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
    expect(screen.getByTestId("nifty-stat-pcr-oi")).toHaveTextContent(
      "Put/call ratio · open interest",
    );
    expect(screen.getByTestId("nifty-stat-pcr-vol")).toHaveTextContent(
      "Put/call ratio · volume",
    );
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
      resolve(process.cwd(), "src/pages/report/ReportDecisionStrip.tsx"),
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
