// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import { ReportToolbar } from "./ReportToolbar";

const harness = vi.hoisted(() => ({ store: {} as Record<string, unknown> }));

vi.mock("./ReportContext", () => ({ useNiftyReport: () => harness.store }));
vi.mock("./sim/SimDesk", () => ({ SimDesk: () => null }));
vi.mock("./NiftyPositionsDrawer", () => ({ NiftyPositionsDrawer: () => null }));
vi.mock("./NiftyDeskGuide", () => ({ NiftyDeskGuide: () => null }));
vi.mock("./NiftyReplayBar", () => ({ NiftyReplayBar: () => null }));
vi.mock("./niftyStreamSolid", () => ({ useNiftySpotTick: () => () => null }));

function secondsAgo(seconds: number): string {
  return new Date(Date.now() - seconds * 1_000).toISOString();
}

describe("ReportToolbar freshness indicators", () => {
  beforeEach(() => {
    harness.store = {
      selection: {
        symbol: () => "NIFTY",
        index: () => "nifty",
        mode: () => "live",
        expiry: () => "nearest",
        date: () => "",
        view: () => "chart",
        deskMode: () => "desk",
        expiryData: () => [],
        hasRecordedHistory: () => false,
        handleSymbolChange: () => {},
        handleIndexChange: () => {},
        handleModeChange: () => {},
        handleExpiryChange: () => {},
        handleViewChange: () => {},
        handleDeskChange: () => {},
        setDate: () => {},
      },
      ui: {
        view: () => "chart",
        deskMode: () => "desk",
        handleViewChange: () => {},
        handleDeskChange: () => {},
      },
      data: {
        report: () => ({
          fetchedAt: secondsAgo(0),
          market: { is_open: true, session_date: "2026-11-03", as_of: null },
        }),
        tape: () => ({ date: "2026-11-03", rows: [{ t: secondsAgo(30) }] }),
        loading: () => false,
        snapshotting: () => false,
        freshness: {
          marketClosed: () => false,
          isStale: () => true, // WebSocket has been down 1m (90s threshold)
          staleMins: () => 1,
          updatedAtMs: () => Date.now(),
        },
        paperPositions: () => [],
        effectiveBursts: () => [],
        refresh: () => {},
        snapshot: () => Promise.resolve(),
      },
      replay: { replay: () => null, index: () => 0 },
    };
  });

  test("a fresh DATA badge and a WS outage are shown as distinct signals", () => {
    render(() => (
      <UIProvider>
        <ReportToolbar />
      </UIProvider>
    ));

    const dataBadge = screen.getByTestId("nifty-data-freshness");
    expect(dataBadge).toHaveAttribute("data-state", "fresh");
    expect(dataBadge.textContent).toMatch(/^DATA \d+s$/);

    const wsBadge = screen.getByTestId("nifty-stale-badge");
    expect(wsBadge.textContent).toBe("WS DOWN 1m");
    expect(wsBadge.textContent).not.toContain("STALE");
    expect(screen.getByTestId("nifty-updated-at")).toHaveTextContent("reconnecting");
  });
});
