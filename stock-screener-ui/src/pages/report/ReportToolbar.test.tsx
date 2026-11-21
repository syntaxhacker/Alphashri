// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
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

  test("every view toggle keeps its testid, options and an 11px floor", () => {
    (harness.store.selection as { hasRecordedHistory: () => boolean }).hasRecordedHistory = () => true;
    render(() => (
      <UIProvider>
        <ReportToolbar />
      </UIProvider>
    ));

    const toggles: Record<string, string[]> = {
      "nifty-index-toggle": ["NIFTY", "SENSEX", "RELIANCE"],
      "nifty-mode-toggle": ["Live", "EOD"],
      "nifty-view-toggle": ["Chart", "Depth"],
      "nifty-desk-toggle": ["DESK", "RESEARCH"],
    };
    for (const [testid, options] of Object.entries(toggles)) {
      const buttons = [...screen.getByTestId(testid).querySelectorAll("button")] as HTMLButtonElement[];
      expect(buttons.map((b) => b.textContent), testid).toEqual(options);
      for (const button of buttons) {
        expect(parseFloat(button.style.fontSize), `${testid}: ${button.textContent}`).toBeGreaterThanOrEqual(11);
      }
    }
  });

  test("exactly one control chooses the underlying, and it drives the symbol", () => {
    (harness.store.selection as { hasRecordedHistory: () => boolean }).hasRecordedHistory = () => true;
    const handleSymbolChange = vi.fn();
    (harness.store.selection as { handleSymbolChange: (v: string) => void }).handleSymbolChange =
      handleSymbolChange;
    render(() => (
      <UIProvider>
        <ReportToolbar />
      </UIProvider>
    ));

    // The redesign removed the second control (a symbol Select backed by the
    // unconsumed `index` signal). One selector must remain, and it must be the
    // segmented control that writes the `symbol` every panel reads.
    expect(screen.queryByTestId("nifty-symbol-select")).toBeNull();
    expect(screen.queryByTestId("nifty-index-select")).toBeNull();

    const indexControls = [...document.querySelectorAll<HTMLElement>("[data-value]")].filter(
      (el) => ["NIFTY", "SENSEX", "RELIANCE"].includes(el.dataset.value ?? ""),
    );
    expect(indexControls.length).toBe(3);
    expect(new Set(indexControls.map((el) => el.closest("[data-testid]")?.getAttribute("data-testid"))))
      .toEqual(new Set(["nifty-index-toggle"]));

    // The only remaining Select in the toolbar is the expiry picker (the
    // combobox is its inner field) — the removed duplicate was a symbol Select,
    // so no second combobox may exist.
    const comboboxes = screen.getAllByRole("combobox");
    expect(comboboxes).toHaveLength(1);
    expect(screen.getByTestId("nifty-expiry-select").contains(comboboxes[0])).toBe(true);

    const control = screen.getByTestId("nifty-index-toggle");
    const reliance = [...control.querySelectorAll("button")].find(
      (button) => button.textContent === "RELIANCE",
    ) as HTMLButtonElement;
    fireEvent.click(reliance);
    expect(handleSymbolChange).toHaveBeenCalledWith("RELIANCE");
  });
});

afterEach(cleanup);
