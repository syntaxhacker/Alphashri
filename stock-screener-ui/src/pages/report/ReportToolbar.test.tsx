// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import {
  deriveToolbarFeedState,
  expiryControlTitle,
  expiryOptionLabel,
  ReportToolbar,
  REPORT_VIEW_DATA,
  REPORT_VIEW_BUTTON_CLASS,
  REPORT_VIEW_IDLE_CLASS,
  REPORT_VIEW_PRESSED_CLASS,
  REPORT_VIEW_TOGGLE_CLASS,
  snapshotClockLabel,
  STRIP_FADE_STYLE,
  TOOLBAR_ACTIONS_CLASS,
  TOOLBAR_CHROME_HEIGHT,
  TOOLBAR_CLASS,
  TOOLBAR_FADE_CLASS,
  TOOLBAR_PRIMARY_CLASS,
  TOOLBAR_PRIMARY_HEIGHT,
  TOOLBAR_SECONDARY_CLASS,
  TOOLBAR_SECONDARY_HEIGHT,
  TOOLBAR_STRIP_CLASS,
  toolbarStatusLabel,
} from "./ReportToolbar";

const harness = vi.hoisted(() => ({ store: {} as Record<string, unknown> }));

vi.mock("./ReportContext", () => ({ useNiftyReport: () => harness.store }));
// The simulator is a standalone feature; emulate its chip so the toolbar's
// absence assertion fails if the affordance is ever mounted here again.
vi.mock("./sim/SimDesk", () => ({
  SimDesk: () => <button type="button" data-testid="sim-open">SIM · 1</button>,
}));
vi.mock("./NiftyPositionsDrawer", () => ({ NiftyPositionsDrawer: () => null }));
vi.mock("./NiftyDeskGuide", () => ({ NiftyDeskGuide: () => null }));
vi.mock("./NiftyReplayBar", () => ({
  NiftyReplayBar: () => <div data-testid="nifty-replay-bar" />,
}));
vi.mock("./niftyStreamSolid", () => ({ useNiftySpotTick: () => () => null }));

function secondsAgo(seconds: number): string {
  return new Date(Date.now() - seconds * 1_000).toISOString();
}

/** 10:00:00 IST, the clock the captures show on the snapshot. */
const TEN_IST = Date.parse("2026-11-16T04:30:00.000Z");

function secondaryStatusText(): string {
  return screen.getByTestId("toolbar-group-status").textContent ?? "";
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
        reportView: () => "monitor",
        isWindowDesk: () => false,
        deskMode: () => "desk",
        handleViewChange: () => {},
        handleReportViewChange: () => {},
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
          isStale: () => false,
          staleMins: () => 1,
          updatedAtMs: () => TEN_IST,
        },
        paperPositions: () => [],
        effectiveBursts: () => [],
        refresh: () => {},
        snapshot: () => Promise.resolve(),
      },
      replay: { replay: () => null, index: () => 0 },
    };
  });

  test("pure helpers map the three feed states to exact labels", () => {
    expect(deriveToolbarFeedState({ marketClosed: false, isStale: false, tapeStale: false })).toBe("live");
    expect(deriveToolbarFeedState({ marketClosed: false, isStale: true, tapeStale: false })).toBe("stale");
    expect(deriveToolbarFeedState({ marketClosed: false, isStale: false, tapeStale: true })).toBe("stale");
    // Closed wins: a past session is a snapshot, never a broken live feed.
    expect(deriveToolbarFeedState({ marketClosed: true, isStale: true, tapeStale: true })).toBe("closed");

    expect(snapshotClockLabel(TEN_IST)).toBe("10:00");
    expect(snapshotClockLabel(null)).toBe("—");
    expect(
      toolbarStatusLabel({ state: "live", updatedAtMs: TEN_IST, staleMins: 1, liveClockMs: TEN_IST }),
    ).toBe("Updated 10:00:00 · live (WS)");
    expect(
      toolbarStatusLabel({ state: "stale", updatedAtMs: TEN_IST, staleMins: 46, liveClockMs: TEN_IST }),
    ).toBe("STALE 46m");
    expect(
      toolbarStatusLabel({ state: "closed", updatedAtMs: TEN_IST, staleMins: 46, liveClockMs: TEN_IST }),
    ).toBe("SNAPSHOT 10:00");
  });

  test("market open and fresh keeps the real live readout and no stale token", () => {
    render(() => (
      <UIProvider>
        <ReportToolbar />
      </UIProvider>
    ));

    expect(screen.getByTestId("nifty-updated-at")).toHaveTextContent("Updated 10:00:00 · live (WS)");
    const dataBadge = screen.getByTestId("nifty-data-freshness");
    expect(dataBadge).toHaveAttribute("data-state", "fresh");
    expect(dataBadge.textContent).toMatch(/^DATA \d+s$/);
    expect(screen.queryByTestId("nifty-stale-badge")).toBeNull();
    expect(secondaryStatusText()).not.toContain("STALE");
    expect(secondaryStatusText()).not.toContain("SNAPSHOT");
  });

  test("a stale WebSocket feed says STALE 46m and never live (WS)", () => {
    const freshness = (harness.store.data as any).freshness;
    freshness.isStale = () => true;
    freshness.staleMins = () => 46;
    render(() => (
      <UIProvider>
        <ReportToolbar />
      </UIProvider>
    ));

    expect(screen.getByTestId("nifty-updated-at")).toHaveTextContent("STALE 46m");
    expect(secondaryStatusText()).not.toContain("live (WS)");
    const dataBadge = screen.getByTestId("nifty-data-freshness");
    expect(dataBadge).toHaveAttribute("data-state", "stale");
    expect(dataBadge.textContent).toBe("STALE");
    expect(screen.getByTestId("nifty-stale-badge")).toHaveTextContent("WS DOWN 46m");
    expect(secondaryStatusText()).not.toContain("SNAPSHOT");
  });

  test("a days-old stale feed promotes the unit and keeps exact seconds in the title", () => {
    const freshness = (harness.store.data as any).freshness;
    freshness.isStale = () => true;
    freshness.staleMins = () => 64142;
    render(() => (
      <UIProvider>
        <ReportToolbar />
      </UIProvider>
    ));

    const status = screen.getByTestId("nifty-updated-at");
    // 64142m = 1069h = 44d — never a five-digit minute count on a 20px band.
    expect(status).toHaveTextContent("STALE 44d");
    expect(status.textContent).not.toContain("64142m");
    // The promoted unit hides the precise age; the tooltip keeps it exactly.
    expect(status.getAttribute("title")).toContain("3848520");
    expect(
      toolbarStatusLabel({ state: "stale", updatedAtMs: TEN_IST, staleMins: 64142, liveClockMs: TEN_IST }),
    ).toBe("STALE 44d");
    expect(secondaryStatusText()).not.toContain("live (WS)");
  });

  test("a stale tape with a connected WebSocket is also STALE, never live (WS)", () => {
    (harness.store.data as any).tape = () => ({
      date: "2026-11-16",
      rows: [{ t: secondsAgo(46 * 60 + 30) }],
    });
    render(() => (
      <UIProvider>
        <ReportToolbar />
      </UIProvider>
    ));

    expect(screen.getByTestId("nifty-updated-at")).toHaveTextContent("STALE 46m");
    expect(secondaryStatusText()).not.toContain("live (WS)");
    expect(screen.getByTestId("nifty-data-freshness")).toHaveAttribute("data-state", "stale");
    // The WS is connected here, so no WS-down badge may contradict the tape read.
    expect(screen.queryByTestId("nifty-stale-badge")).toBeNull();
  });

  test("a closed market says SNAPSHOT 10:00 with no live or stale token", () => {
    const freshness = (harness.store.data as any).freshness;
    freshness.marketClosed = () => true;
    freshness.staleMins = () => 46;
    render(() => (
      <UIProvider>
        <ReportToolbar />
      </UIProvider>
    ));

    expect(screen.getByTestId("nifty-updated-at")).toHaveTextContent("SNAPSHOT 10:00");
    const dataBadge = screen.getByTestId("nifty-data-freshness");
    expect(dataBadge).toHaveAttribute("data-state", "closed");
    expect(dataBadge.textContent).toBe("CLOSED");
    expect(secondaryStatusText()).not.toContain("live (WS)");
    expect(secondaryStatusText()).not.toContain("STALE");
    expect(screen.queryByTestId("nifty-stale-badge")).toBeNull();
  });

  test("closed wins when the store also reports a stale feed", () => {
    const freshness = (harness.store.data as any).freshness;
    freshness.marketClosed = () => true;
    freshness.isStale = () => true;
    freshness.staleMins = () => 46;
    render(() => (
      <UIProvider>
        <ReportToolbar />
      </UIProvider>
    ));

    expect(screen.getByTestId("nifty-updated-at")).toHaveTextContent("SNAPSHOT 10:00");
    expect(secondaryStatusText()).not.toContain("live (WS)");
    expect(secondaryStatusText()).not.toContain("STALE");
    expect(screen.queryByTestId("nifty-stale-badge")).toBeNull();
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

  test("the header is two deliberate bands at 390 and one dense row at 1600", () => {
    render(() => (
      <UIProvider>
        <ReportToolbar />
      </UIProvider>
    ));

    const toolbar = screen.getByTestId("nifty-toolbar");
    const primary = screen.getByTestId("toolbar-primary-row");
    const secondary = screen.getByTestId("toolbar-secondary-row");

    // Both bands are direct children — no fourth ad-hoc row can appear between
    // them, and the replay bar (when present) stays outside the header.
    expect([...toolbar.children]).toEqual([primary, secondary]);
    expect(toolbar.className).toContain("flex-wrap");
    expect(toolbar.className).toContain("min-[1200px]:flex-nowrap");

    // At 390 each band owns its full width; from 1200 both go inline (w-auto).
    expect(TOOLBAR_PRIMARY_CLASS).toContain("w-full");
    expect(TOOLBAR_PRIMARY_CLASS).toContain("min-[1200px]:w-auto");
    expect(TOOLBAR_PRIMARY_CLASS).toContain("min-[1200px]:flex-1");
    expect(TOOLBAR_SECONDARY_CLASS).toContain("w-full");
    expect(TOOLBAR_SECONDARY_CLASS).toContain("min-[1200px]:w-auto");
    expect(TOOLBAR_SECONDARY_CLASS).toContain("min-[1200px]:ml-auto");

    // Subject / session / state / actions are all in the primary band; the
    // freshness readouts are in the labelled secondary band only.
    for (const id of [
      "toolbar-group-subject",
      "toolbar-group-session",
      "toolbar-group-state",
      "toolbar-group-actions",
    ]) {
      expect(primary.contains(screen.getByTestId(id)), id).toBe(true);
    }
    for (const id of ["toolbar-data-label", "toolbar-group-status"]) {
      expect(secondary.contains(screen.getByTestId(id)), id).toBe(true);
      expect(primary.contains(screen.getByTestId(id)), id).toBe(false);
    }
    expect(screen.getByTestId("toolbar-data-label").textContent).toBe("DATA FRESHNESS");
  });

  test("primary strip shows labelled Underlying / Mode / Session clusters with dividers and pressed state", () => {
    (harness.store.selection as { hasRecordedHistory: () => boolean }).hasRecordedHistory = () => true;
    render(() => (
      <UIProvider>
        <ReportToolbar />
      </UIProvider>
    ));

    const strip = screen.getByTestId("toolbar-strip");
    const clusters: [string, string, string][] = [
      ["toolbar-cluster-underlying", "UNDERLYING", "nifty-index-toggle"],
      ["toolbar-cluster-mode", "MODE", "nifty-mode-toggle"],
      ["toolbar-cluster-session", "SESSION", "nifty-expiry-select"],
    ];
    for (const [clusterId, label, controlId] of clusters) {
      const cluster = screen.getByTestId(clusterId);
      expect(strip.contains(cluster), clusterId).toBe(true);
      expect(cluster.getAttribute("role"), clusterId).toBe("group");
      expect(cluster.getAttribute("aria-label"), clusterId).toBeTruthy();
      expect(screen.getByTestId(`${clusterId}-label`), `${clusterId} caption`).toHaveTextContent(label);
      expect(cluster.className, clusterId).toContain("flex-col");
      expect(cluster.contains(screen.getByTestId(controlId)), controlId).toBe(true);
    }

    // The dividers are reused where possible; the mode→session boundary is new.
    const dividers = [
      "toolbar-divider-subject-session",
      "toolbar-divider-mode-session",
      "toolbar-divider-session-state",
    ].map((id) => screen.getByTestId(id));
    const children = [...strip.children];
    for (const divider of dividers) {
      expect(strip.contains(divider)).toBe(true);
      expect(divider.className).toContain("w-px");
    }
    expect(children.indexOf(dividers[0])).toBeLessThan(children.indexOf(dividers[1]));
    expect(children.indexOf(dividers[1])).toBeLessThan(children.indexOf(dividers[2]));

    // Pressed state is keyed on the primitive's own aria-pressed attribute, so
    // the active mode reads without adding a second selected-looking control.
    for (const id of [
      "nifty-index-toggle",
      "nifty-mode-toggle",
      "nifty-view-toggle",
      "nifty-desk-toggle",
    ]) {
      const toggle = screen.getByTestId(id);
      expect(toggle.className, id).toContain("[aria-pressed='true']");
      expect(toggle.querySelectorAll('button[aria-pressed="true"]'), id).toHaveLength(1);
      expect(toggle.querySelectorAll('button[aria-pressed="false"]').length, id).toBeGreaterThan(0);
      const buttons = [...toggle.querySelectorAll("button")];
      for (const button of buttons) {
        expect(button.tagName).toBe("BUTTON");
        expect(button).toHaveAttribute("type", "button");
      }
      buttons[0].focus();
      expect(document.activeElement, id).toBe(buttons[0]);
    }
  });

  test("the report toolbar never mounts the SIM simulator affordance", () => {
    // The simulator stays available as its own feature, but this page must not
    // mount its chip: STATE here describes the real paper book only.
    const assertNoSim = () => {
      expect(screen.queryByTestId("sim-open")).toBeNull();
      expect(screen.queryByText(/^SIM/)).toBeNull();
      const state = screen.getByTestId("toolbar-group-state");
      expect(state).toHaveAttribute("role", "group");
      expect(state.getAttribute("aria-label")).toBe("Paper positions");
      expect(state.textContent).not.toMatch(/SIM/);
      expect(state.parentElement).toBe(screen.getByTestId("toolbar-strip"));
      expect(screen.getByTestId("toolbar-divider-session-state")).toBeInTheDocument();
      expect(screen.getByTestId("toolbar-cluster-session")).toBeInTheDocument();
      expect(screen.getByTestId("toolbar-data-label")).toHaveTextContent("DATA FRESHNESS");
    };

    // Full live state.
    render(() => (
      <UIProvider>
        <ReportToolbar />
      </UIProvider>
    ));
    assertNoSim();
    expect(screen.getByTestId("toolbar-cluster-underlying")).toBeInTheDocument();
    expect(screen.getByTestId("toolbar-cluster-mode")).toBeInTheDocument();
    cleanup();

    // Replay is history playback, not SIM: it must survive EOD with no live claim.
    (harness.store.selection as Record<string, unknown>).mode = () => "eod";
    (harness.store.selection as Record<string, unknown>).date = () => "2026-11-16";
    (harness.store.replay as Record<string, unknown>).replay = () => ({ snapshots: [{ t: 1 }] });
    render(() => (
      <UIProvider>
        <ReportToolbar />
      </UIProvider>
    ));
    assertNoSim();
    expect(screen.getByTestId("nifty-replay-bar")).toBeInTheDocument();
    expect(screen.queryByTestId("nifty-updated-at")).toBeNull();
    cleanup();

    // Empty data must not revive the affordance either.
    (harness.store.data as Record<string, unknown>).report = () => null;
    (harness.store.data as Record<string, unknown>).tape = () => null;
    render(() => (
      <UIProvider>
        <ReportToolbar />
      </UIProvider>
    ));
    assertNoSim();
  });

  test("moving the mode toggle into the MODE cluster keeps EOD date gating intact", () => {
    const selection = harness.store.selection as Record<string, (value?: string) => unknown>;
    selection.hasRecordedHistory = () => true;
    selection.mode = () => "eod";
    selection.date = () => "";
    render(() => (
      <UIProvider>
        <ReportToolbar />
      </UIProvider>
    ));

    const eod = [...screen.getByTestId("nifty-mode-toggle").querySelectorAll("button")].find(
      (button) => button.textContent === "EOD",
    ) as HTMLButtonElement;
    expect(eod).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("nifty-date-input")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-refresh-button")).toBeDisabled();
    expect(screen.getByTestId("nifty-snapshot-button")).toBeDisabled();
    expect(screen.getByTestId("nifty-snapshot-button")).toHaveAttribute(
      "title",
      "Only available in Live mode — an EOD date is history, not a snapshot",
    );

    cleanup();
    selection.date = () => "2026-11-16";
    render(() => (
      <UIProvider>
        <ReportToolbar />
      </UIProvider>
    ));
    expect(screen.getByTestId("nifty-date-input")).toHaveValue("2026-11-16");
    expect(screen.getByTestId("nifty-refresh-button")).toBeEnabled();
  });

  test("the Depth tab strip scrolls with a visible cue instead of clipping a word", () => {
    render(() => (
      <UIProvider>
        <ReportToolbar />
      </UIProvider>
    ));

    const strip = screen.getByTestId("toolbar-strip");
    expect(strip.className).toContain(TOOLBAR_STRIP_CLASS);
    expect(TOOLBAR_STRIP_CLASS).toMatch(/(^|\s)flex-nowrap(\s|$)/);
    expect(TOOLBAR_STRIP_CLASS).toContain("overflow-x-auto");
    expect(TOOLBAR_STRIP_CLASS).toContain("min-[1200px]:overflow-visible");
    expect(strip.parentElement?.contains(screen.getByTestId("toolbar-strip-fade"))).toBe(true);

    // The cue is reachable by keyboard, has an accessible name, and disappears
    // on the desktop single-row layout.
    const cue = screen.getByTestId("toolbar-scroll-cue");
    expect(cue.tagName).toBe("BUTTON");
    expect(cue).toHaveAttribute("aria-label", "Scroll report controls");
    expect(cue.className).toContain("min-[1200px]:hidden");
    expect(screen.getByTestId("toolbar-strip-fade").className).toContain("min-[1200px]:hidden");

    // No control is allowed to shrink below its own text: the SegmentedControl
    // track clips with overflow-hidden, so a squeezed "Depth" was the bug.
    for (const id of ["nifty-index-toggle", "nifty-view-toggle", "nifty-desk-toggle"]) {
      const toggle = screen.getByTestId(id);
      expect(toggle.className, id).toContain("shrink-0");
      expect(toggle.className, id).not.toMatch(/(^|\s)(truncate|text-ellipsis)(\s|$)/);
      for (const button of toggle.querySelectorAll("button")) {
        expect(button.className, `${id}: ${button.textContent}`).toContain("whitespace-nowrap");
      }
    }
    const depth = [...screen.getByTestId("nifty-view-toggle").querySelectorAll("button")].find(
      (b) => b.textContent === "Depth",
    );
    expect(depth?.textContent).toBe("Depth");
  });

  test("the symbol tabs keep whole labels and the fade masks any partial tab", () => {
    render(() => (
      <UIProvider>
        <ReportToolbar />
      </UIProvider>
    ));

    // Whole words in the DOM: no mid-word slice ("RELIA") and no ellipsis on
    // the control or its buttons — the clip was a layout problem, not data.
    const index = screen.getByTestId("nifty-index-toggle");
    expect([...index.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
      "NIFTY",
      "SENSEX",
      "RELIANCE",
    ]);
    for (const toggle of [index, screen.getByTestId("nifty-view-toggle"), screen.getByTestId("nifty-desk-toggle")]) {
      expect(toggle.className).toContain("snap-start");
      expect(toggle.className).not.toMatch(/(^|\s)(truncate|text-ellipsis)(\s|$)/);
      for (const button of toggle.querySelectorAll("button")) {
        expect(button.className).toContain("whitespace-nowrap");
      }
    }

    // Mandatory x-snap means a scroll lands on a whole toggle; the cue hides
    // at 1600 where the strip stops being a scroll owner.
    expect(TOOLBAR_STRIP_CLASS).toContain("snap-x");
    expect(TOOLBAR_STRIP_CLASS).toContain("snap-mandatory");
    expect(TOOLBAR_STRIP_CLASS).toContain("min-[1200px]:snap-none");

    // The fade is at least 32px wide and opaque at the edge, so the last
    // partially-visible glyph is masked instead of reading "RELIA▸".
    expect(TOOLBAR_FADE_CLASS).toBe("w-10");
    expect(screen.getByTestId("toolbar-strip-fade").className).toContain(TOOLBAR_FADE_CLASS);
    const gradient = String(STRIP_FADE_STYLE.background);
    expect(gradient).toContain("linear-gradient");
    expect(gradient).toContain("62%");
    expect(gradient).toMatch(/100%\)$/);
  });

  test("the scroll cue actually moves the strip to its far edge and back", () => {
    render(() => (
      <UIProvider>
        <ReportToolbar />
      </UIProvider>
    ));

    const strip = screen.getByTestId("toolbar-strip") as HTMLDivElement;
    const scrollTo = vi.fn();
    strip.scrollTo = scrollTo;
    Object.defineProperty(strip, "scrollWidth", { value: 800, configurable: true });
    Object.defineProperty(strip, "clientWidth", { value: 340, configurable: true });

    const cue = screen.getByTestId("toolbar-scroll-cue");
    fireEvent.click(cue);
    expect(scrollTo).toHaveBeenCalledWith({ left: 460, behavior: "smooth" });

    Object.defineProperty(strip, "scrollLeft", { value: 460, configurable: true });
    fireEvent.click(cue);
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 0, behavior: "smooth" });
  });

  test("actions keep their full labels and never duplicate a control", () => {
    render(() => (
      <UIProvider>
        <ReportToolbar />
      </UIProvider>
    ));

    const actions = screen.getByTestId("toolbar-group-actions");
    expect(actions.parentElement).toBe(screen.getByTestId("toolbar-primary-row"));
    expect(actions.className).toBe(TOOLBAR_ACTIONS_CLASS);

    const refresh = screen.getByTestId("nifty-refresh-button");
    const snapshot = screen.getByTestId("nifty-snapshot-button");
    for (const [button, label] of [[refresh, "Refresh"], [snapshot, "Snapshot"]] as const) {
      expect(actions.contains(button)).toBe(true);
      expect(button.textContent).toBe(label);
      expect(button.className).toMatch(/(^|\s)whitespace-nowrap(\s|$)/);
      expect(button.className).not.toMatch(/(^|\s)(truncate|text-ellipsis)(\s|$)/);
    }

    // One control per concept: the old symbol Select is gone and the DATA
    // badge appears exactly once, in the secondary band.
    expect(screen.queryByTestId("nifty-symbol-select")).toBeNull();
    expect(screen.getAllByTestId("nifty-data-freshness")).toHaveLength(1);
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

  test("390 chrome is exactly two fixed bands: 48px controls + 20px status", () => {
    render(() => (
      <UIProvider>
        <ReportToolbar />
      </UIProvider>
    ));

    const toolbar = screen.getByTestId("nifty-toolbar");
    const primary = screen.getByTestId("toolbar-primary-row");
    const secondary = screen.getByTestId("toolbar-secondary-row");

    // No ad-hoc third/fourth band can appear between the two owned rows.
    expect([...toolbar.children]).toEqual([primary, secondary]);
    expect(primary.className).toContain("h-[48px]");
    expect(secondary.className).toContain("h-[20px]");
    expect(TOOLBAR_PRIMARY_HEIGHT).toBe(48);
    expect(TOOLBAR_SECONDARY_HEIGHT).toBe(20);
    expect(TOOLBAR_CHROME_HEIGHT).toBe(68);
    expect(TOOLBAR_CHROME_HEIGHT).toBeGreaterThanOrEqual(64);
    expect(TOOLBAR_CHROME_HEIGHT).toBeLessThanOrEqual(72);

    // The outer box adds no vertical padding or row gap on top of those bands.
    expect(toolbar.className).toBe(TOOLBAR_CLASS);
    expect(TOOLBAR_CLASS).toContain("py-0");
    expect(TOOLBAR_CLASS).toContain("gap-y-0");
    expect(TOOLBAR_CLASS).toContain("px-2");

    // Both action clusters stay nowrap, so Refresh/Snapshot and the freshness
    // badges cannot start another row at 390.
    expect(TOOLBAR_ACTIONS_CLASS).toContain("flex-nowrap");
    expect(TOOLBAR_ACTIONS_CLASS).not.toContain("flex-wrap");
    expect(screen.getByTestId("toolbar-group-actions").parentElement).toBe(primary);
    expect(screen.getByTestId("toolbar-group-status").parentElement).toBe(secondary);
  });

  test("1600 collapses both bands into one compact auto-height row", () => {
    render(() => (
      <UIProvider>
        <ReportToolbar />
      </UIProvider>
    ));

    expect(TOOLBAR_CLASS).toContain("min-[1200px]:flex-nowrap");
    expect(TOOLBAR_PRIMARY_CLASS).toContain("min-[1200px]:h-auto");
    expect(TOOLBAR_SECONDARY_CLASS).toContain("min-[1200px]:h-auto");
    expect(TOOLBAR_PRIMARY_CLASS).toContain("min-[1200px]:w-auto");
    expect(TOOLBAR_PRIMARY_CLASS).toContain("min-[1200px]:flex-1");
    expect(TOOLBAR_SECONDARY_CLASS).toContain("min-[1200px]:w-auto");
    expect(TOOLBAR_SECONDARY_CLASS).toContain("min-[1200px]:ml-auto");
    expect(TOOLBAR_STRIP_CLASS).toContain("min-[1200px]:overflow-visible");
    expect(screen.getByTestId("toolbar-scroll-cue").className).toContain("min-[1200px]:hidden");
  });

  test("an optional leading control shares the 48px primary row", () => {
    render(() => (
      <UIProvider>
        <ReportToolbar
          leading={<button type="button" aria-label="Toggle navigation">nav</button>}
        />
      </UIProvider>
    ));

    const leading = screen.getByTestId("toolbar-leading");
    expect(leading.parentElement).toBe(screen.getByTestId("toolbar-primary-row"));
    expect(screen.getByRole("button", { name: "Toggle navigation" })).toBeInTheDocument();
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
    expect(TOOLBAR_CLASS).toBe(toolbar.className);
  });

  test("the compact MONITOR | DESK workspace toggle is labelled, keyboard reachable and neutral-pressed", () => {
    const handleReportViewChange = vi.fn();
    (harness.store.ui as Record<string, unknown>).handleReportViewChange = handleReportViewChange;
    render(() => (
      <UIProvider>
        <ReportToolbar />
      </UIProvider>
    ));

    const toggle = screen.getByTestId("nifty-report-view-toggle");
    expect(toggle).toHaveAttribute("role", "group");
    expect(toggle).toHaveAttribute("aria-label", "Report view");
    expect(toggle.className).toContain(REPORT_VIEW_TOGGLE_CLASS);
    expect(REPORT_VIEW_DATA.map((option) => option.label)).toEqual(["MONITOR", "DESK"]);

    const monitor = screen.getByTestId("nifty-report-view-monitor");
    const desk = screen.getByTestId("nifty-report-view-desk");
    expect([monitor.textContent, desk.textContent]).toEqual(["MONITOR", "DESK"]);
    for (const button of [monitor, desk]) {
      expect(button.tagName).toBe("BUTTON");
      expect(button).toHaveAttribute("type", "button");
      expect(button.className).toContain(REPORT_VIEW_BUTTON_CLASS);
      // Neutral focus token, not the accent fill of the mode toggles.
      expect(button.className).toContain("focus-visible:ring-fin-text");
      expect(button.className).not.toContain("bg-fin-primary");
    }
    expect(monitor).toHaveAttribute("aria-pressed", "true");
    expect(monitor.className).toContain(REPORT_VIEW_PRESSED_CLASS);
    expect(desk).toHaveAttribute("aria-pressed", "false");
    expect(desk.className).toContain(REPORT_VIEW_IDLE_CLASS);

    desk.focus();
    expect(document.activeElement).toBe(desk);
    fireEvent.click(desk);
    expect(handleReportViewChange).toHaveBeenCalledWith("desk");
    monitor.focus();
    fireEvent.click(monitor);
    expect(handleReportViewChange).toHaveBeenLastCalledWith("monitor");

    // The toggle lives in the primary band; the two-band DOM is untouched.
    expect(screen.getByTestId("toolbar-primary-row").contains(toggle)).toBe(true);
    expect([...screen.getByTestId("nifty-toolbar").children]).toEqual([
      screen.getByTestId("toolbar-primary-row"),
      screen.getByTestId("toolbar-secondary-row"),
    ]);
  });

  test("the layout preset picker appears only in desk view and reports the chosen preset", () => {
    const onPresetChange = vi.fn();
    render(() => (
      <UIProvider>
        <ReportToolbar presetId="desk" onPresetChange={onPresetChange} />
      </UIProvider>
    ));
    // Monitor keeps exactly one combobox (the expiry Select).
    expect(screen.queryByTestId("nifty-report-preset-select")).toBeNull();
    expect(screen.getAllByRole("combobox")).toHaveLength(1);

    cleanup();
    (harness.store.ui as Record<string, unknown>).reportView = () => "desk";
    (harness.store.ui as Record<string, unknown>).isWindowDesk = () => true;
    render(() => (
      <UIProvider>
        <ReportToolbar presetId="desk" onPresetChange={onPresetChange} />
      </UIProvider>
    ));

    const picker = screen.getByTestId("nifty-report-preset-select");
    const native = picker.querySelector("select") as HTMLSelectElement;
    expect(native).toHaveAttribute("aria-label", "Report layout preset");
    expect(screen.getByRole("combobox", { name: "Report layout preset" })).toBe(native);
    expect(native).toHaveValue("desk");
    const options = [...picker.querySelectorAll("option")].map((option) => option.value);
    expect(options).toEqual(["focus", "desk", "flow", "full"]);
    // DOM order keeps the workspace toggle before the picker.
    const toggle = screen.getByTestId("nifty-report-view-toggle");
    expect(
      Boolean(toggle.compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
    fireEvent.input(native, { target: { value: "full" } });
    expect(onPresetChange).toHaveBeenCalledWith("full");
  });
});

afterEach(cleanup);
