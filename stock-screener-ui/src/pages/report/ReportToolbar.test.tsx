// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import { expiryControlTitle, expiryOptionLabel, ReportToolbar } from "./ReportToolbar";

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
          isStale: () => true,
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

  test("the narrow actions group wraps instead of clipping the far-right action", () => {
    render(() => (
      <UIProvider>
        <ReportToolbar />
      </UIProvider>
    ));

    const toolbar = screen.getByTestId("nifty-toolbar");
    expect(toolbar.className).toMatch(/(^|\s)flex-wrap(\s|$)/);
    expect(toolbar.className).not.toMatch(/(^|\s)overflow-hidden(\s|$)/);

    // This group held Refresh + clock + DATA + Snapshot + guide in one
    // flex-none row, so Snapshot was cut off at 390 with no affordance. It must
    // wrap internally, be clamped to the toolbar width, and return to one row
    // on desktop.
    const actions = screen.getByTestId("toolbar-group-status");
    expect(actions.parentElement).toBe(toolbar);
    expect(actions).toHaveAttribute("aria-label", "Actions and data freshness");
    expect(actions.className).toMatch(/(^|\s)flex-wrap(\s|$)/);
    expect(actions.className).toContain("max-w-full");
    expect(actions.className).toContain("min-w-0");
    expect(actions.className).toContain("min-[1200px]:flex-nowrap");

    // The clipped action must keep its full accessible label — no truncation.
    const refresh = screen.getByTestId("nifty-refresh-button");
    const snapshot = screen.getByTestId("nifty-snapshot-button");
    for (const [button, label] of [[refresh, "Refresh"], [snapshot, "Snapshot"]] as const) {
      expect(actions.contains(button)).toBe(true);
      expect(button.textContent).toBe(label);
      expect(button.className).toMatch(/(^|\s)whitespace-nowrap(\s|$)/);
      expect(button.className).not.toMatch(/(^|\s)(truncate|text-ellipsis)(\s|$)/);
    }
    expect(screen.getByTestId("nifty-data-freshness").textContent).toMatch(/^DATA /);
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

  test("the expiry options end at a word boundary and keep the full label in a title", () => {
    (harness.store.selection as { expiryData: () => { value: string; label: string }[] }).expiryData =
      () => [
        { value: "nearest", label: "Nearest expiry" },
        { value: "2026-11-26", label: "2026-11-26" },
      ];
    render(() => (
      <UIProvider>
        <ReportToolbar />
      </UIProvider>
    ));

    const root = screen.getByTestId("nifty-expiry-select");
    const select = root.querySelector("select")!;
    const options = [...select.querySelectorAll("option")].map((option) => option.textContent ?? "");
    expect(options).toEqual(["Nearest", "2026-11-26"]);

    // A visible label is either the whole label or a whole-word prefix of it —
    // never a prefix sliced through a word ("Nearest expi").
    const fullLabels = ["Nearest expiry", "2026-11-26"];
    for (const [visible, full] of options.map((label, i) => [label, fullLabels[i]] as const)) {
      if (visible !== full) {
        expect(full.startsWith(visible)).toBe(true);
        expect(full[visible.length], `${visible} must end at a word boundary`).toBe(" ");
      }
    }

    const wrapper = root.parentElement!;
    expect(wrapper.getAttribute("title")).toBe(expiryControlTitle("Nearest expiry"));
    expect(select.getAttribute("aria-label")).toBe(expiryControlTitle("Nearest expiry"));
    expect(expiryOptionLabel({ value: "nearest", label: "Nearest expiry" })).toBe("Nearest");
    expect(expiryOptionLabel({ value: "2026-11-26", label: "2026-11-26" })).toBe("2026-11-26");
  });

  test("the expiry field keeps its 104px budget without a mid-word readout", () => {
    render(() => (
      <UIProvider>
        <ReportToolbar />
      </UIProvider>
    ));
    const root = screen.getByTestId("nifty-expiry-select");
    expect(root.style.width).toBe("104px");
    expect(root.className).toContain("min-w-[104px]");
    expect(root.className).toContain("max-w-[104px]");
    expect(root.parentElement!.className).toContain("flex-none");
    // The toolbar keeps its wrap contract at 390 and its scroll fallback at 1600.
    const toolbar = screen.getByTestId("nifty-toolbar");
    expect(toolbar.className).toContain("flex-wrap");
    expect(toolbar.className).toContain("min-[1200px]:overflow-x-auto");
  });
});

afterEach(cleanup);
