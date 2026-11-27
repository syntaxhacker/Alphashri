// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createSignal } from "solid-js";

// Contract for the LIVE TAPE disclosure. The three low-frequency read-only
// bands stay in the tree while collapsed; only their rendered height goes away.
const [desk, setDesk] = createSignal(true);

vi.mock("./Nifty10sStrip", () => ({ Nifty10sStrip: () => <div data-testid="nifty-10s-strip" /> }));
vi.mock("./NiftySqueezeRadar", () => ({ NiftySqueezeRadar: () => <div data-testid="squeeze-stub" /> }));
vi.mock("./NiftyWallErosionBoard", () => ({ NiftyWallErosionBoard: () => <div data-testid="wall-erosion-board" /> }));
vi.mock("./NiftyWallsCard", () => ({ NiftyWallsCard: () => <div data-testid="nifty-walls-card" /> }));
vi.mock("./NiftyWallsExpanded", () => ({ NiftyWallsExpanded: () => null }));
vi.mock("./NiftyPressureDesk", () => ({ NiftyPressureDesk: () => null }));
vi.mock("./NiftyDeskPlan", () => ({ NiftyDeskPlan: () => null }));
vi.mock("./LevelsInPlay", () => ({ LevelsInPlayContent: () => null }));
vi.mock("@/components/notifications/MarketAlertCard", () => ({
  MarketAlertStack: () => null,
  MarketAlertLog: () => null,
}));

vi.mock("./ReportContext", () => ({
  useNiftyReport: () => ({
    data: {
      report: () => null,
      tapeRows: () => [],
      breadth: () => ({
        available: true,
        count: 1,
        up: 1,
        rows: [{ label: "NIFTY", last: 25_000, close: 24_900, change_pct: 0.4 }],
      }),
      scorePoints: () => [],
      preMove: () => null,
      setup: () => null,
      preMoveHistory: () => [],
      metrics: () => null,
      sensex: () => null,
    },
    selection: { mode: () => "live", symbol: () => "NIFTY" },
    walls: {
      data: () => null,
      history: () => [],
      open: () => false,
      openDrawer: () => {},
      closeDrawer: () => {},
    },
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
    ui: { isDesk: desk, deskOpen: () => false, setDeskOpen: () => {} },
  }),
}));

const { ReportStrips } = await import("./ReportStrips");

afterEach(() => {
  cleanup();
  setDesk(true);
});

const contents = () => screen.getByTestId("nifty-live-tape-content");

describe("LIVE TAPE disclosure", () => {
  test("starts collapsed in desk mode and expands on click", () => {
    setDesk(true);
    render(() => <ReportStrips />);

    const toggle = screen.getByTestId("nifty-live-tape-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("LIVE TAPE");
    expect(contents().style.display).toBe("none");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(contents().style.display).toBe("flex");
  });

  test("every band stays in the DOM while collapsed", () => {
    setDesk(true);
    render(() => <ReportStrips />);

    const content = contents();
    expect(content.style.display).toBe("none");
    for (const id of ["nifty-breadth-strip", "nifty-10s-strip", "wall-erosion-board"]) {
      const el = screen.getByTestId(id);
      expect(el).toBeInTheDocument();
      expect(content.contains(el)).toBe(true);
    }
    expect(screen.getByTestId("nifty-walls-card")).toBeInTheDocument();
  });

  test("starts expanded outside desk mode", () => {
    setDesk(false);
    render(() => <ReportStrips />);

    expect(screen.getByTestId("nifty-live-tape-toggle")).toHaveAttribute("aria-expanded", "true");
    expect(contents().style.display).toBe("flex");
  });

  test("the disclosure toggle is a single ~28px control, not a stack of strips", () => {
    render(() => <ReportStrips />);

    const toggle = screen.getByTestId("nifty-live-tape-toggle");
    expect(toggle.className).toContain("h-7");
    expect(toggle.className).toContain("min-h-7");
  });
});
