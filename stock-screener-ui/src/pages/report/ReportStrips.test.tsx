// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createSignal } from "solid-js";

import type { BreadthPayload, NiftyReport } from "@/api/reportNifty";

// The strips are one band each, so this suite only asserts the container's own
// contract: which bands mount, the breadth fallback, and that no strip adds a
// second border. Every heavy child is stubbed to keep the test about layout.
vi.mock("./Nifty10sStrip", () => ({ Nifty10sStrip: () => <div data-testid="nifty-10s-stub" /> }));
vi.mock("./NiftySqueezeRadar", () => ({ NiftySqueezeRadar: () => <div data-testid="squeeze-stub" /> }));
vi.mock("./NiftyWallErosionBoard", () => ({ NiftyWallErosionBoard: () => <div data-testid="erosion-stub" /> }));
vi.mock("./NiftyWallsCard", () => ({ NiftyWallsCard: () => <div data-testid="walls-stub" /> }));
vi.mock("./NiftyWallsExpanded", () => ({ NiftyWallsExpanded: () => null }));
vi.mock("./NiftyPressureDesk", () => ({ NiftyPressureDesk: () => null }));
vi.mock("./NiftyDeskPlan", () => ({ NiftyDeskPlan: () => null }));
vi.mock("./LevelsInPlay", () => ({ LevelsInPlayContent: () => null }));
vi.mock("@/components/notifications/MarketAlertCard", () => ({
  MarketAlertStack: () => null,
  MarketAlertLog: () => null,
}));

const breadth = (over: Partial<BreadthPayload> = {}): BreadthPayload => ({
  available: true,
  count: 5,
  up: 4,
  rows: [{ label: "NIFTY", last: 24_650, close: 24_450, change_pct: 0.82 }],
  ...over,
});

const mode = createSignal<"live" | "eod">("live");
const wallsData = createSignal<unknown>(null);
const reportData = createSignal<NiftyReport | null>(null);

// A real snapshot needs levels, not just metadata — one side is enough.
const wallsWithLevels = { state: "positioning", calls: [{ strike: 22_500, oi: 1_200 }], puts: [] };

const closedSnapshot = (asOf: string | null) =>
  ({
    date: "2026-11-23",
    market: { is_open: false, as_of: asOf, session_date: "2026-11-23" },
  }) as NiftyReport;

vi.mock("./ReportContext", () => ({
  useNiftyReport: () => ({
    data: {
      report: reportData[0],
      tapeRows: () => [],
      breadth: () => breadth(),
      scorePoints: () => [],
      preMove: () => ({ state: "quiet" }),
      setup: () => ({ state: "quiet", gates: [] }),
      preMoveHistory: () => [],
      metrics: () => null,
      sensex: () => null,
      refresh: () => {},
    },
    selection: { mode: mode[0], symbol: () => "NIFTY" },
    walls: { data: wallsData[0], history: () => [], open: () => false, openDrawer: () => {}, closeDrawer: () => {} },
    replay: { replay: () => null, index: () => 0, breakAt: () => {} },
    alerts: {
      toasts: () => [],
      trail: () => [],
      displayedTrail: () => [],
      criticalCount: () => 0,
      trailCursor: () => null,
      soundMuted: () => false,
      criticalOnly: () => false,
      dismissToast: () => {},
      toggleSound: () => {},
      toggleCriticalOnly: () => {},
      playTrail: () => {},
      clearTrail: () => {},
    },
    ui: { isDesk: () => true, deskOpen: () => false, setDeskOpen: () => {} },
  }),
}));

const { ReportStrips, wallsSnapshotTime, wallsUnavailableCopy } = await import("./ReportStrips");

afterEach(() => {
  cleanup();
  mode[1]("live");
  wallsData[1](null);
  reportData[1](null);
});
describe("ReportStrips", () => {
  test("mounts every band inside one deliberate 8px column", () => {
    mode[1]("live");
    wallsData[1](wallsWithLevels);
    render(() => <ReportStrips />);
    const root = screen.getByTestId("nifty-report-strips");
    expect(root.className).toContain("flex-col");
    expect(root.className).toContain("gap-2");
    expect(root).toHaveAttribute("data-report-spacing", "8");
    expect(root.className).not.toContain("gap-1");
    expect(root.className).not.toContain("gap-4");
    expect(screen.getByTestId("nifty-10s-stub")).toBeInTheDocument();
    expect(screen.getByTestId("walls-stub")).toBeInTheDocument();
  });

  test("live with no walls collapses to a one-line reason with Retry, not an empty card", () => {
    mode[1]("live");
    wallsData[1](null);
    render(() => <ReportStrips />);
    const band = screen.getByTestId("nifty-walls-card");
    expect(band).toHaveAttribute("data-empty-kind", "no-data");
    expect(band).toHaveTextContent(/waiting for the walls recorder/i);
    // One 24px line, not the full-height empty card with its reserved skeleton.
    expect(band.className).toContain("h-6");
    expect(band.className).not.toContain("h-14");
    expect(screen.getByTestId("nifty-walls-retry")).toBeInTheDocument();
    expect(screen.queryByTestId("walls-stub")).toBeNull();
  });

  test("a truthy empty live payload still collapses to the compact reason", () => {
    mode[1]("live");
    wallsData[1]({});
    render(() => <ReportStrips />);
    const band = screen.getByTestId("nifty-walls-card");
    expect(band).toHaveAttribute("data-empty-kind", "no-data");
    expect(band).toHaveTextContent(/waiting for the walls recorder/i);
    expect(band.className).toContain("h-6");
    expect(screen.getByTestId("nifty-walls-retry")).toBeInTheDocument();
    expect(screen.queryByTestId("walls-stub")).toBeNull();
  });

  test("a metadata-only live payload with empty call and put rows stays compact", () => {
    mode[1]("live");
    wallsData[1]({ state: "positioning", calls: [], puts: [], spot: 22_350 });
    render(() => <ReportStrips />);
    expect(screen.getByTestId("nifty-walls-card")).toHaveTextContent(/waiting for the walls recorder/i);
    expect(screen.queryByTestId("walls-stub")).toBeNull();
  });

  test("placeholder rows with zero OI stay compact", () => {
    mode[1]("live");
    wallsData[1]({ state: "positioning", calls: [{ strike: 22_500, oi: 0 }], puts: [] });
    render(() => <ReportStrips />);
    expect(screen.getByTestId("nifty-walls-card")).toHaveTextContent(/waiting for the walls recorder/i);
    expect(screen.queryByTestId("walls-stub")).toBeNull();
  });

  test("a closed snapshot names its own as-of time, never the next open", () => {
    mode[1]("live");
    wallsData[1](null);
    reportData[1](closedSnapshot("2026-11-23T10:00:00+05:30"));
    render(() => <ReportStrips />);

    const band = screen.getByTestId("nifty-walls-card");
    expect(band).toHaveAttribute("data-empty-kind", "market-closed");
    expect(band).toHaveTextContent("No walls snapshot for 10:00");
    expect(band).not.toHaveTextContent("09:15");
    expect(band).not.toHaveTextContent("Opens");
    expect(band.className).toContain("h-6");
    expect(screen.getByTestId("nifty-walls-retry")).toBeInTheDocument();
    expect(screen.queryByTestId("walls-stub")).toBeNull();
  });

  test("a closed snapshot without a clock stays truthful and generic", () => {
    mode[1]("live");
    wallsData[1](null);
    reportData[1](closedSnapshot(null));
    render(() => <ReportStrips />);

    const band = screen.getByTestId("nifty-walls-card");
    expect(band).toHaveAttribute("data-empty-kind", "market-closed");
    expect(band).toHaveTextContent("No walls snapshot for this session");
    expect(band).not.toHaveTextContent("09:15");
    expect(screen.getByTestId("nifty-walls-retry")).toBeInTheDocument();
  });

  test("a live open frame still waits on the recorder, not a closed snapshot", () => {
    mode[1]("live");
    wallsData[1](null);
    reportData[1]({
      market: { is_open: true, as_of: "2026-11-23T10:00:00+05:30", session_date: "2026-11-23" },
    } as NiftyReport);
    render(() => <ReportStrips />);

    const band = screen.getByTestId("nifty-walls-card");
    expect(band).toHaveAttribute("data-empty-kind", "no-data");
    expect(band).toHaveTextContent("Waiting for the walls recorder");
    expect(band).not.toHaveTextContent("No walls snapshot for 10:00");
  });

  test("live with real walls mounts the full card and no compact reason", () => {
    mode[1]("live");
    wallsData[1](wallsWithLevels);
    render(() => <ReportStrips />);
    expect(screen.getByTestId("walls-stub")).toBeInTheDocument();
    expect(screen.queryByTestId("nifty-walls-card")).toBeNull();
    expect(screen.queryByTestId("nifty-walls-retry")).toBeNull();
  });

  test("replay keeps one compact header with one reason and no dead bands", async () => {
    mode[1]("live");
    render(() => <ReportStrips />);
    expect(screen.getByTestId("nifty-breadth-strip")).toBeInTheDocument();

    mode[1]("eod");
    const toggle = await screen.findByTestId("nifty-live-tape-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // The single, shared reason lives in the one header — no per-band repeat.
    expect(toggle).toHaveTextContent(/Not captured in replay/i);
    expect(screen.queryByTestId("nifty-breadth-live-only")).toBeNull();
    expect(screen.queryByTestId("walls-stub")).toBeNull();
    expect(screen.queryByTestId("nifty-breadth-strip")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nifty-walls-card")).toBeNull();
    expect(screen.queryByTestId("nifty-walls-retry")).toBeNull();
  });

  test("a replay that reconstructed walls still mounts the real WALLS band", () => {
    wallsData[1](wallsWithLevels);
    mode[1]("eod");
    render(() => <ReportStrips />);
    expect(screen.getByTestId("walls-stub")).toBeInTheDocument();
  });

  test("uses the 8/12px section rhythm and a 16px section title", () => {
    const source = readFileSync(resolve(process.cwd(), "src/pages/report/ReportStrips.tsx"), "utf8");
    expect(source).toContain('data-report-spacing="8"');
    expect(source).toContain('gap: "8px"');
    expect(source).toContain("`${REPORT_FONT.value}px`");
    expect(source).not.toContain("gap-1 ");
  });
});

describe("wallsUnavailableCopy", () => {
  test("reads only the clock from an IST as-of stamp", () => {
    expect(wallsSnapshotTime("2026-11-23T10:00:00+05:30")).toBe("10:00");
    expect(wallsSnapshotTime("2026-11-23T09:15:00+05:30")).toBe("09:15");
    expect(wallsSnapshotTime(null)).toBeNull();
    expect(wallsSnapshotTime("10:00")).toBeNull();
  });

  test("distinguishes a closed snapshot from a waiting recorder", () => {
    expect(wallsUnavailableCopy({ closed: true, asOf: "2026-11-23T10:00:00+05:30" })).toEqual({
      kind: "market-closed",
      text: "No walls snapshot for 10:00",
    });
    expect(wallsUnavailableCopy({ closed: true })).toEqual({
      kind: "market-closed",
      text: "No walls snapshot for this session",
    });
    expect(wallsUnavailableCopy({})).toEqual({
      kind: "no-data",
      text: "Waiting for the walls recorder",
    });
  });
});
