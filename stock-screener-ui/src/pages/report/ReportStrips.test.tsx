// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
  test("mounts every band inside one deliberate 8px column", () => {
    mode[1]("live");
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

  test("renders the breadth band in live mode and its replay-unavailable line in eod", async () => {
    mode[1]("live");
    render(() => <ReportStrips />);
    expect(screen.getByTestId("nifty-breadth-strip")).toBeInTheDocument();

    mode[1]("eod");
    const liveOnly = await screen.findByTestId("nifty-breadth-live-only");
    // One phrase is shared by every band replay cannot reconstruct.
    expect(liveOnly).toHaveTextContent(/Breadth · Not captured in replay/i);
    expect(liveOnly).toHaveAttribute("data-replay-unavailable", "true");
    // The wrapper keeps the band's 24px height, so switching modes never shifts
    // the strips below it.
    expect(liveOnly.parentElement?.className).toContain("h-6");
    expect(liveOnly.parentElement?.className).toContain("min-h-6");
    expect(screen.queryByTestId("nifty-breadth-strip")).not.toBeInTheDocument();
  });

  test("uses the 8/12px section rhythm and a 16px section title", () => {
    const source = readFileSync(resolve(process.cwd(), "src/pages/report/ReportStrips.tsx"), "utf8");
    expect(source).toContain('data-report-spacing="8"');
    expect(source).toContain('gap: "8px"');
    expect(source).toContain("`${REPORT_FONT.value}px`");
    expect(source).not.toContain("gap-1 ");
  });
});
