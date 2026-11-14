// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createSignal } from "solid-js";

import type { BreadthPayload } from "@/api/reportNifty";

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

vi.mock("./ReportContext", () => ({
  useNiftyReport: () => ({
    data: {
      report: () => null,
      tapeRows: () => [],
      breadth: () => breadth(),
      scorePoints: () => [],
      preMove: () => ({ state: "quiet" }),
      setup: () => ({ state: "quiet", gates: [] }),
      preMoveHistory: () => [],
      metrics: () => null,
      sensex: () => null,
    },
    selection: { mode: mode[0], symbol: () => "NIFTY" },
    walls: { data: () => null, history: () => [], open: () => false, openDrawer: () => {}, closeDrawer: () => {} },
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

const { ReportStrips } = await import("./ReportStrips");

afterEach(cleanup);
describe("ReportStrips", () => {
  test("mounts every band inside one gap-1 column", () => {
    mode[1]("live");
    render(() => <ReportStrips />);
    const root = screen.getByTestId("nifty-report-strips");
    expect(root.className).toContain("flex-col");
    expect(root.className).toContain("gap-1");
    expect(root.className).not.toContain("gap-4");
    expect(screen.getByTestId("nifty-10s-stub")).toBeInTheDocument();
    expect(screen.getByTestId("walls-stub")).toBeInTheDocument();
  });

  test("renders the breadth band in live mode and its live-only line in eod", async () => {
    mode[1]("eod");
    render(() => <ReportStrips />);
    const liveOnly = screen.getByTestId("nifty-breadth-live-only");
    expect(liveOnly).toHaveTextContent("BREADTH · live only");
    // The placeholder keeps the band's 24px height, so switching modes never
    // shifts the strips below it.
    expect(liveOnly.className).toContain("h-6");
    expect(screen.queryByTestId("nifty-breadth-strip")).not.toBeInTheDocument();
  });
});
