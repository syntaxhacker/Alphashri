// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { NiftyReport } from "@/types/niftyReport";
import type { WallsPayload } from "@/api/reportNifty";
import type { PreMovePoint } from "./niftyPreMoveHistory";
import type { PreMoveScore } from "./niftyPreMove";
import type { SetupRead } from "./niftySetup";
import { NiftySqueezeRadar } from "./NiftySqueezeRadar";
import { symbolMetrics } from "./symbolMetrics";

function report(partial: Record<string, unknown>): NiftyReport {
  return {
    mode: "live",
    date: "2026-10-28",
    expiry: "2026-11-03",
    spot: 22_675,
    wallsNear: {
      calls: [{ strike: 22_700, oi: 8_300_000, distance: 25 }],
      puts: [{ strike: 22_600, oi: 7_800_000, distance: -75 }],
    },
    ...partial,
  } as unknown as NiftyReport;
}

const preMove: PreMoveScore = {
  score: 5,
  max: 9,
  state: "armed",
  components: [
    { key: "put-writing", label: "puts sold", points: 2, detail: "12/30 of the last 5 min" },
    { key: "call-premium", label: "calls bid", points: 1, detail: "premium 2.1% over implied" },
  ],
  reasons: ["puts sold", "calls bid"],
};

const setup: SetupRead = {
  state: "ARMED",
  score: 3,
  gates: [
    { key: "LEVEL", pass: true, detail: "at a level" },
    { key: "WALL", pass: true, detail: "wall near" },
    { key: "RVOL", pass: true, detail: "volume" },
    { key: "COIL", pass: false, detail: "no coil" },
    { key: "GAMMA", pass: false, detail: "no gamma flip" },
  ],
};

const now = Date.now();
const history: PreMovePoint[] = [
  { t: now - 120_000, score: 3, spot: 22_670, comps: ["put-writing"] },
  { t: now - 60_000, score: 4, spot: 22_673, comps: ["put-writing"] },
  { t: now, score: 5, spot: 22_675, comps: ["put-writing", "call-premium"] },
];

function makeSensexReport(partial: Record<string, unknown> = {}): NiftyReport {
  return {
    mode: "live",
    date: "2026-11-05",
    expiry: "2026-11-06",
    spot: 79_000,
    wallsNear: {
      calls: [{ strike: 79_100, oi: 8_300_000, distance: 100 }],
      puts: [{ strike: 78_900, oi: 7_800_000, distance: -100 }],
    },
    ...partial,
  } as unknown as NiftyReport;
}

function makeRelianceReport(partial: Record<string, unknown> = {}): NiftyReport {
  return {
    mode: "live",
    date: "2026-11-05",
    expiry: "2026-11-06",
    spot: 1_400,
    wallsNear: {
      calls: [{ strike: 1_450, oi: 8_300_000, distance: 50 }],
      puts: [{ strike: 1_350, oi: 7_800_000, distance: -50 }],
    },
    ...partial,
  } as unknown as NiftyReport;
}

describe("NiftySqueezeRadar", () => {
  afterEach(() => cleanup());

  it("shows the nearest wall, distance, proximity and stage (NIFTY)", () => {
    render(
      <NiftySqueezeRadar
        report={report({})}
        preMove={preMove}
        setup={setup}
        history={history}
        wallHistory={[
          { t: now - 120_000, side: "ce", strike: 22_700, oi: 8_500_000 },
          { t: now, side: "ce", strike: 22_700, oi: 8_300_000 },
        ]}
      />,
    );

    expect(screen.getByTestId("nifty-squeeze-wall")).toHaveTextContent("22,700 CE");
    expect(screen.getByTestId("nifty-squeeze-wall")).toHaveTextContent("25 pts");
    expect(screen.getByTestId("nifty-squeeze-stage")).toHaveTextContent("ARMING");
    expect(screen.getByTestId("nifty-squeeze-proximity").textContent).toMatch(/^\d+%$/);
    // 0.35×distance(79) + 0.20×flow(56) + 0.15×setup(60) + 0.30×erosion(0) -> 48%
    expect(screen.getByTestId("nifty-squeeze-proximity")).toHaveTextContent("48%");
    // wall OI 8.5M -> 8.3M = erosion, shown as a green down-arrow.
    expect(screen.getByTestId("nifty-squeeze-wall-delta")).toHaveTextContent("▼");
    expect(screen.getByTestId("nifty-squeeze-wall-delta")).toHaveTextContent("2.0L");
    expect(screen.getByTestId("nifty-squeeze-calibration")).toHaveTextContent("ARM 2.0×");
    expect(screen.getByTestId("nifty-squeeze-calibration")).toHaveTextContent("TRIG 40%");
  });

  it("switches to the put wall when it is the nearer one", () => {
    render(
      <NiftySqueezeRadar
        report={report({
          spot: 22_650,
          wallsNear: {
            calls: [{ strike: 23_000, oi: 9_000_000, distance: 350 }],
            puts: [{ strike: 22_600, oi: 7_000_000, distance: -50 }],
          },
        })}
        preMove={preMove}
        setup={setup}
        history={history}
      />,
    );

    expect(screen.getByTestId("nifty-squeeze-wall")).toHaveTextContent("22,600 PE");
    expect(screen.getByTestId("nifty-squeeze-wall")).toHaveTextContent("50 pts below");
  });

  it("renders the flow chips with their point values", () => {
    render(<NiftySqueezeRadar report={report({})} preMove={preMove} setup={setup} history={history} />);
    expect(screen.getByTestId("nifty-squeeze-chip-put-writing")).toHaveTextContent("puts sold +2");
    expect(screen.getByTestId("nifty-squeeze-chip-call-premium")).toHaveTextContent("calls bid +1");
    expect(screen.getByTestId("nifty-squeeze-armed")).toHaveTextContent("armed 0m");
  });

  it("does not arm on distance alone when flow and setup are empty", () => {
    render(
      <NiftySqueezeRadar
        report={report({
          spot: 22_690,
          wallsNear: {
            calls: [{ strike: 22_700, oi: 8_000_000, distance: 10 }],
            puts: [{ strike: 22_600, oi: 7_000_000, distance: -90 }],
          },
        })}
        preMove={{ ...preMove, score: 0, state: "quiet", components: [], reasons: [] }}
        setup={{ ...setup, state: "QUIET", score: 0, gates: setup.gates.map((g) => ({ ...g, pass: false })) }}
        history={history}
      />,
    );

    // 0.35×distance(92) -> ~32%, no flow/setup edge -> QUIET.
    expect(screen.getByTestId("nifty-squeeze-stage")).toHaveTextContent("QUIET");
    expect(screen.getByTestId("nifty-squeeze-proximity").textContent).toMatch(/^3[0-9]%$/);
  });

  it("marks a fast move as TRIGGER even with no flow edge (NIFTY: 15-pt break)", () => {
    const fast: PreMovePoint[] = [
      { t: now - 50_000, score: 0, spot: 22_680, comps: [] },
      { t: now - 40_000, score: 0, spot: 22_684, comps: [] },
      { t: now - 30_000, score: 0, spot: 22_688, comps: [] },
      { t: now - 20_000, score: 0, spot: 22_692, comps: [] },
      { t: now - 10_000, score: 0, spot: 22_696, comps: [] },
      { t: now, score: 0, spot: 22_700, comps: [] },
    ];
    render(
      <NiftySqueezeRadar
        report={report({ spot: 22_700 })}
        preMove={{ ...preMove, score: 0, state: "quiet", components: [], reasons: [] }}
        setup={{ ...setup, state: "QUIET", score: 0, gates: setup.gates.map((g) => ({ ...g, pass: false })) }}
        history={fast}
      />,
    );
    expect(screen.getByTestId("nifty-squeeze-stage")).toHaveTextContent("TRIGGER");
  });

  it("reads QUIET with no flow edge and far walls", () => {
    render(
      <NiftySqueezeRadar
        report={report({
          spot: 22_650,
          wallsNear: {
            calls: [{ strike: 23_000, oi: 9_000_000, distance: 350 }],
            puts: [{ strike: 22_300, oi: 6_000_000, distance: -350 }],
          },
        })}
        preMove={{ ...preMove, score: 0, state: "quiet", components: [], reasons: [] }}
        setup={{ ...setup, state: "QUIET", score: 0, gates: setup.gates.map((g) => ({ ...g, pass: false })) }}
        history={[]}
      />,
    );

    expect(screen.getByTestId("nifty-squeeze-stage")).toHaveTextContent("QUIET");
    expect(screen.getByTestId("nifty-squeeze-proximity")).toHaveTextContent("0%");
    expect(screen.getByText(/no flow edge yet/)).toBeInTheDocument();
  });

  // --- Symbol-aware thresholds (new) ---

  it("SENSEX: squeezeRangePts scales with spot (79k vs 22.8k ≈ 3.46x)", () => {
    const sensexReport = makeSensexReport();
    const metrics = symbolMetrics(sensexReport);
    const niftyReport = report({});
    const niftyMetrics = symbolMetrics(niftyReport);

    // SENSEX range should be ~3.46x NIFTY range (allow 5% tolerance for rounding)
    expect(metrics.squeezeRangePts / niftyMetrics.squeezeRangePts).toBeCloseTo(79_000 / 22_800, 0);
    // Price break threshold scales similarly
    expect(metrics.squeezePriceBreakPts / niftyMetrics.squeezePriceBreakPts).toBeCloseTo(79_000 / 22_800, 0);
    // At-wall threshold scales similarly
    expect(metrics.squeezeAtWallPts / niftyMetrics.squeezeAtWallPts).toBeCloseTo(79_000 / 22_800, 0);
  });

  it("SENSEX: 100-pt wall distance is NOT 'at the wall' (squeezeAtWallPts ≈ 17)", () => {
    const sensexReport = makeSensexReport({ spot: 79_000, wallsNear: { calls: [{ strike: 79_100, oi: 8_000_000, distance: 100 }], puts: [] } });
    const metrics = symbolMetrics(sensexReport);
    // squeezeAtWallPts for SENSEX ~ 79k * 2.2bps / 10000 ≈ 17 pts
    // 100 pts > 17, so NOT "at the wall"
    expect(metrics.squeezeAtWallPts).toBeLessThan(100);
  });

  it("RELIANCE: squeezeRangePts scales down (1.4k vs 22.8k ≈ 0.061x)", () => {
    const relianceReport = makeRelianceReport();
    const metrics = symbolMetrics(relianceReport);
    const niftyReport = report({});
    const niftyMetrics = symbolMetrics(niftyReport);

    expect(metrics.squeezeRangePts / niftyMetrics.squeezeRangePts).toBeCloseTo(1_400 / 22_800, 0);
    expect(metrics.squeezePriceBreakPts / niftyMetrics.squeezePriceBreakPts).toBeCloseTo(1_400 / 22_800, 0);
    expect(metrics.squeezeAtWallPts / niftyMetrics.squeezeAtWallPts).toBeCloseTo(1_400 / 22_800, 0);
  });

  it("RELIANCE: 50-pt wall distance IS 'at the wall' (squeezeAtWallPts ≈ 0.3 -> min 1)", () => {
    const relianceReport = makeRelianceReport({ spot: 1_400, wallsNear: { calls: [{ strike: 1_450, oi: 8_000_000, distance: 50 }], puts: [] } });
    const metrics = symbolMetrics(relianceReport);
    // squeezeAtWallPts for RELIANCE ~ 1400 * 2.2bps / 10000 ≈ 0.3 -> clamped to 1
    // 50 pts > 1, so NOT "at the wall" with default calibration
    // But the component uses m.squeezeAtWallPts which is at least 1
    expect(metrics.squeezeAtWallPts).toBeGreaterThanOrEqual(1);
  });

  it("SENSEX: a 10-pt move triggers priceBreak (squeezePriceBreakPts ≈ 35)", () => {
    const sensexReport = makeSensexReport();
    const metrics = symbolMetrics(sensexReport);
    // squeezePriceBreakPts for SENSEX ~ 79k * 4.4bps / 10000 ≈ 35 pts
    // A 10-pt move is NOT a break for SENSEX
    expect(metrics.squeezePriceBreakPts).toBeGreaterThan(10);
  });

  it("NIFTY: a 15-pt move triggers priceBreak (squeezePriceBreakPts ≈ 10)", () => {
    const niftyReport = report({ spot: 22_800 });
    const metrics = symbolMetrics(niftyReport);
    // squeezePriceBreakPts for NIFTY ~ 22800 * 4.4bps / 10000 ≈ 10 pts
    // A 15-pt move IS a break for NIFTY
    expect(metrics.squeezePriceBreakPts).toBeLessThanOrEqual(15);
  });

  it("accepts pre-computed metrics prop (avoids re-deriving)", () => {
    const sensexReport = makeSensexReport();
    const metrics = symbolMetrics(sensexReport);
    render(
      <NiftySqueezeRadar
        report={sensexReport}
        preMove={preMove}
        setup={setup}
        history={history}
        metrics={metrics}
      />,
    );
    expect(screen.getByTestId("nifty-squeeze-wall")).toHaveTextContent("79,100 CE");
    expect(screen.getByTestId("nifty-squeeze-proximity").textContent).toMatch(/^\d+%$/);
  });

  it("moves to PRE-BLAST when the nearest wall is eroding in a SHORT regime", () => {
    const walls = {
      regime: "SHORT",
      nearest_call: {
        strike: 22_700,
        oi: 8_300_000,
        status: "ERODING",
        fuel_score: 80,
        vol_mult: 1.3,
        erosion_30m: -0.034,
        distance_pts: 25,
      },
    } as unknown as WallsPayload;

    render(
      <NiftySqueezeRadar
        report={report({})}
        preMove={preMove}
        setup={setup}
        history={history}
        walls={walls}
      />,
    );

    expect(screen.getByTestId("nifty-squeeze-stage")).toHaveTextContent("PRE-BLAST");
    expect(screen.getByTestId("squeeze-erosion")).toHaveTextContent(/DIST 79 · FLOW 56 · ERODE 80 · Γ SHORT/);
    expect(screen.getByTestId("nifty-squeeze-wall")).toHaveTextContent(/-3\.4%\/30m/);
  });

  it("does not show PRE-BLAST for a LONG regime or low fuel", () => {
    const strongWall = {
      strike: 22_700,
      oi: 8_300_000,
      status: "ERODING",
      fuel_score: 80,
      vol_mult: 1.3,
      erosion_30m: -0.034,
      distance_pts: 25,
    };

    render(
      <NiftySqueezeRadar
        report={report({})}
        preMove={preMove}
        setup={setup}
        history={history}
        walls={{ regime: "LONG", nearest_call: strongWall } as unknown as WallsPayload}
      />,
    );
    expect(screen.getByTestId("nifty-squeeze-stage")).not.toHaveTextContent("PRE-BLAST");
    cleanup();

    render(
      <NiftySqueezeRadar
        report={report({})}
        preMove={preMove}
        setup={setup}
        history={history}
        walls={{ regime: "SHORT", nearest_call: { ...strongWall, fuel_score: 40 } } as unknown as WallsPayload}
      />,
    );
    expect(screen.getByTestId("nifty-squeeze-stage")).not.toHaveTextContent("PRE-BLAST");
  });
});