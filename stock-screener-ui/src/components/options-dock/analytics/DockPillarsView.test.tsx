// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";

// Pillars pull a lazily imported ECharts bundle on a cold module graph; every
// wait for one gets an explicit budget instead of vitest's 1s default.
const PILLAR_WAIT = { timeout: 5000 } as const;

const fetchDashboard = vi.fn();

vi.mock("../../../api/optionsDashboard", async () => {
  const actual = await vi.importActual<typeof import("../../../api/optionsDashboard")>(
    "../../../api/optionsDashboard",
  );
  return { ...actual, fetchDashboard: (...args: unknown[]) => fetchDashboard(...args) };
});

// happy-dom has no 2D canvas: the real ECharts init throws from zrender.
const chartStub = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(), on: vi.fn(), off: vi.fn() };
vi.mock("../../../utils/loadEcharts", () => ({
  loadEcharts: vi.fn(async () => ({ init: vi.fn(() => chartStub) })),
}));

import { createSignal } from "solid-js";
import { OptionDockError } from "../../../api/optionsDock";
import { emptyFixture, fullFixture } from "../../options-dashboard/fixtures";
import { __resetDashboard, optionsDashboardState } from "@/state/optionsDashboard";
import { DockPillarsView } from "./DockPillarsView";

function view(symbol = "AAPL", onBack = vi.fn<() => void>()) {
  return render(() => (
    <UIProvider>
      <DockPillarsView symbol={symbol} onBack={onBack} />
    </UIProvider>
  ));
}

/** Controlled mount: the dock owns the expiry, as it does inside the panel. */
function controlledView(initial: string | null, onExpiry = vi.fn<(date: string) => void>()) {
  const [expiry, setExpiry] = createSignal<string | null>(initial);
  const rendered = render(() => (
    <UIProvider>
      <DockPillarsView
        symbol="AAPL"
        onBack={vi.fn()}
        selectedExpiry={expiry()}
        onExpiry={(date) => {
          onExpiry(date);
          setExpiry(date);
        }}
      />
    </UIProvider>
  ));
  return { ...rendered, onExpiry, expiry };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetDashboard();
  fetchDashboard.mockImplementation(async () => fullFixture());
});

afterEach(() => {
  cleanup();
  __resetDashboard();
  chartStub.setOption.mockClear();
});

describe("DockPillarsView", () => {
  test("renders the four pillar tabs and the volatility pillar by default", async () => {
    view();
    await waitFor(() => expect(screen.getByTestId("pillar-volatility")).toBeInTheDocument(), PILLAR_WAIT);

    for (const [key, label] of [
      ["volatility", "VOLATILITY"],
      ["positioning", "POSITIONING"],
      ["dealer", "DEALER"],
      ["liquidity", "LIQUIDITY"],
    ]) {
      expect(screen.getByTestId(`dock-pillar-tab-${key}`)).toHaveTextContent(label);
    }
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    expect(screen.getByTestId("dock-pillar-tab-volatility")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("dock-pillars-symbol")).toHaveTextContent("AAPL");
  });

  test("reads the dashboard once per symbol and serves a reopen from cache", async () => {
    const first = view();
    await waitFor(() => expect(screen.getByTestId("pillar-volatility")).toBeInTheDocument(), PILLAR_WAIT);
    expect(fetchDashboard).toHaveBeenCalledTimes(1);
    expect(fetchDashboard).toHaveBeenCalledWith("AAPL", expect.anything());

    first.unmount();
    view();
    await waitFor(() => expect(screen.getByTestId("pillar-volatility")).toBeInTheDocument(), PILLAR_WAIT);
    // The LRU already holds AAPL: reopening costs zero requests.
    expect(fetchDashboard).toHaveBeenCalledTimes(1);
  });

  test("defaults the expiry to the payload's front contract and follows a chip click", async () => {
    view();
    await waitFor(() => expect(screen.getByTestId("pillar-volatility")).toBeInTheDocument(), PILLAR_WAIT);

    const front = screen.getByTestId("dock-pillars-expiry-2026-11-26");
    expect(front).toHaveAttribute("aria-pressed", "true");
    expect(front).toHaveTextContent("26 NOV 9d");

    await fireEvent.click(screen.getByTestId("dock-pillars-expiry-2026-12-31"));
    expect(screen.getByTestId("dock-pillars-expiry-2026-11-26")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByTestId("dock-pillars-expiry-2026-12-31")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // The pillar receives the new selection: its caption follows the contract.
    expect(screen.getByTestId("volatility-caption")).toHaveTextContent("31 DEC · 34d");
  });

  test("a controlled expiry selection calls onExpiry and leaves the value to the dock", async () => {
    const { onExpiry } = controlledView("2026-11-26");
    await waitFor(() => expect(screen.getByTestId("pillar-volatility")).toBeInTheDocument(), PILLAR_WAIT);

    expect(screen.getByTestId("dock-pillars-expiry-2026-11-26")).toHaveAttribute("aria-pressed", "true");

    await fireEvent.click(screen.getByTestId("dock-pillars-expiry-2026-12-31"));
    expect(onExpiry).toHaveBeenCalledWith("2026-12-31");
    // The dock's value is the source of truth: the controlled mount re-renders
    // from it, and the pillar caption follows the same contract.
    expect(screen.getByTestId("dock-pillars-expiry-2026-12-31")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("volatility-caption")).toHaveTextContent("31 DEC · 34d");
  });

  test("a controlled expiry the payload does not list falls back to the front contract", async () => {
    const { onExpiry } = controlledView("2030-01-01");
    await waitFor(() => expect(screen.getByTestId("pillar-volatility")).toBeInTheDocument(), PILLAR_WAIT);

    // The chain and the dashboard can disagree on the far end; the pillar must
    // still paint a real contract instead of an empty selection.
    expect(screen.getByTestId("dock-pillars-expiry-2026-11-26")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("volatility-caption")).toHaveTextContent("26 NOV · 9d");
    expect(onExpiry).not.toHaveBeenCalled();
  });

  test("switches the active pillar, including by keyboard", async () => {
    view();
    await waitFor(() => expect(screen.getByTestId("pillar-volatility")).toBeInTheDocument(), PILLAR_WAIT);

    await fireEvent.click(screen.getByTestId("dock-pillar-tab-dealer"));
    expect(screen.getByTestId("pillar-dealer")).toBeInTheDocument();
    expect(screen.queryByTestId("pillar-volatility")).not.toBeInTheDocument();
    expect(screen.getByTestId("dock-pillar-tab-dealer")).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(screen.getByTestId("dock-pillar-tab-dealer"), { key: "ArrowRight" });
    expect(screen.getByTestId("pillar-liquidity")).toBeInTheDocument();
    expect(screen.getByTestId("dock-pillar-tab-liquidity")).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(screen.getByTestId("dock-pillar-tab-liquidity"));
  });

  test("an auth failure shows Reconnect Upstox + Retry, and Retry re-reads once", async () => {
    fetchDashboard.mockRejectedValueOnce(new OptionDockError("auth", "Upstox token expired"));
    view();

    await waitFor(() => expect(screen.getByTestId("dock-pillars-error")).toBeInTheDocument(), PILLAR_WAIT);
    expect(screen.getByTestId("dock-pillars-error")).toHaveTextContent(
      "Reconnect Upstox in Settings",
    );
    const reconnect = screen.getByTestId("dock-pillars-reconnect");
    expect(reconnect).toHaveTextContent("Reconnect Upstox");
    expect(reconnect).toHaveAttribute("href", "/settings");

    await fireEvent.click(screen.getByTestId("dock-pillars-retry"));
    await waitFor(() => expect(screen.getByTestId("pillar-volatility")).toBeInTheDocument(), PILLAR_WAIT);
    expect(fetchDashboard).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("dock-pillars-error")).not.toBeInTheDocument();
  });

  test("Back calls onBack and aborts the in-flight read", async () => {
    const pending: { resolve?: (value: unknown) => void } = {};
    fetchDashboard.mockImplementation(
      () => new Promise((done) => { pending.resolve = done; }),
    );
    const onBack = vi.fn<() => void>();
    view("AAPL", onBack);

    await waitFor(() => expect(optionsDashboardState.status).toBe("loading"), PILLAR_WAIT);
    fireEvent.click(screen.getByTestId("dock-pillars-back"));
    expect(onBack).toHaveBeenCalledTimes(1);
    // abortDashboard() cancels the flight: no late paint after leaving.
    expect(optionsDashboardState.status).not.toBe("loading");

    pending.resolve?.(fullFixture());
    await Promise.resolve();
    expect(screen.queryByTestId("pillar-volatility")).not.toBeInTheDocument();
  });

  test("an empty payload explains why there is nothing to draw", async () => {
    fetchDashboard.mockImplementation(async () => emptyFixture());
    view();

    await waitFor(() => expect(screen.getByTestId("dock-pillars-empty")).toBeInTheDocument(), PILLAR_WAIT);
    expect(screen.getByTestId("dock-pillars-empty")).toHaveTextContent(
      "No expiries available for AAPL",
    );
  });

  test("a symbol switch aborts the old read and loads the new one", async () => {
    const pending: { resolve?: (value: unknown) => void } = {};
    fetchDashboard.mockImplementationOnce(() => new Promise((done) => { pending.resolve = done; }));

    const [symbol, setSymbol] = createSignal("AAPL");
    render(() => (
      <UIProvider>
        <DockPillarsView symbol={symbol()} onBack={vi.fn()} />
      </UIProvider>
    ));
    await waitFor(() => expect(optionsDashboardState.status).toBe("loading"), PILLAR_WAIT);

    fetchDashboard.mockImplementation(async (next: string) => ({
      ...fullFixture(),
      symbol: next,
    }));
    setSymbol("MSFT");

    await waitFor(() => expect(fetchDashboard).toHaveBeenCalledTimes(2), PILLAR_WAIT);
    expect(fetchDashboard).toHaveBeenLastCalledWith("MSFT", expect.anything());
    await waitFor(() => expect(screen.getByTestId("pillar-volatility")).toBeInTheDocument(), PILLAR_WAIT);
    expect(screen.getByTestId("dock-pillars-symbol")).toHaveTextContent("MSFT");

    // The AAPL response lands after the switch and must not paint.
    pending.resolve?.({ ...fullFixture(), symbol: "AAPL" });
    await Promise.resolve();
    expect(screen.getByTestId("dock-pillars-symbol")).toHaveTextContent("MSFT");
  });

  test("a payload for another symbol never paints under this header", async () => {
    // The store can hold AAPL's frame while the dock asks for MSFT (a cached
    // open elsewhere, or a failed read that restores the previous frame).
    fetchDashboard.mockImplementation(async () => fullFixture());
    view("MSFT");

    await waitFor(() => expect(optionsDashboardState.status).toBe("ready"), PILLAR_WAIT);
    expect(optionsDashboardState.data?.symbol).toBe("AAPL");

    await waitFor(() => expect(screen.getByTestId("dock-pillars-waiting")).toBeInTheDocument(), PILLAR_WAIT);
    expect(screen.queryByTestId("dock-pillars-body")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pillar-volatility")).not.toBeInTheDocument();
    expect(screen.queryByTestId("dock-pillars-expiry-row")).not.toBeInTheDocument();
    // The header still names the symbol the dock asked for, not the payload's.
    expect(screen.getByTestId("dock-pillars-symbol")).toHaveTextContent("MSFT");
  });

  test("the header says LIVE with the payload's as-of time", async () => {
    view();
    await waitFor(() => expect(screen.getByTestId("pillar-volatility")).toBeInTheDocument(), PILLAR_WAIT);

    expect(screen.getByTestId("dock-pillars-live")).toHaveTextContent("LIVE");
    // 11:20+05:30 is 11:20 in Asia/Kolkata.
    expect(screen.getByTestId("dock-pillars-asof")).toHaveTextContent("11:20 IST");
    expect(screen.queryByTestId("dock-pillars-warnings")).not.toBeInTheDocument();
  });

  test("the header says STALE and omits as-of when the payload has neither", async () => {
    fetchDashboard.mockImplementation(async () => ({
      ...fullFixture(),
      quotesLive: false,
      asOf: null,
    }));
    view();

    await waitFor(() => expect(screen.getByTestId("pillar-volatility")).toBeInTheDocument(), PILLAR_WAIT);
    expect(screen.getByTestId("dock-pillars-live")).toHaveTextContent("STALE");
    expect(screen.queryByTestId("dock-pillars-asof")).not.toBeInTheDocument();
  });

  test("refresh re-reads once and is disabled while the read is in flight", async () => {
    view();
    await waitFor(() => expect(screen.getByTestId("pillar-volatility")).toBeInTheDocument(), PILLAR_WAIT);
    expect(fetchDashboard).toHaveBeenCalledTimes(1);

    const pending: { resolve?: (value: unknown) => void } = {};
    fetchDashboard.mockImplementationOnce(() => new Promise((done) => { pending.resolve = done; }));

    const refresh = screen.getByTestId("dock-pillars-refresh");
    expect(refresh).not.toBeDisabled();
    await fireEvent.click(refresh);

    expect(fetchDashboard).toHaveBeenCalledTimes(2);
    expect(fetchDashboard).toHaveBeenLastCalledWith("AAPL", expect.anything());
    expect(screen.getByTestId("dock-pillars-refresh")).toBeDisabled();

    pending.resolve?.(fullFixture());
    await waitFor(
      () => expect(screen.getByTestId("dock-pillars-refresh")).not.toBeDisabled(),
      PILLAR_WAIT,
    );
    expect(fetchDashboard).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("pillar-volatility")).toBeInTheDocument();
  });

  test("warnings render as one truncated line", async () => {
    fetchDashboard.mockImplementation(async () => ({
      ...fullFixture(),
      warnings: [
        { code: "delay", message: "Quotes are delayed by 15 min" },
        { code: "oi", message: "OI is from the previous session" },
      ],
    }));
    view();

    await waitFor(() => expect(screen.getByTestId("dock-pillars-warnings")).toBeInTheDocument(), PILLAR_WAIT);
    const warnings = screen.getByTestId("dock-pillars-warnings");
    expect(warnings).toHaveTextContent("Quotes are delayed by 15 min");
    expect(warnings).toHaveTextContent("OI is from the previous session");
    expect(warnings.className).toContain("truncate");
  });

  describe("390px dock header", () => {
    test("Back clears the fixed hamburger and the symbol cannot overlap a tab", async () => {
      view();
      await waitFor(() => expect(screen.getByTestId("pillar-volatility")).toBeInTheDocument(), PILLAR_WAIT);

      // The dock's mobile nav toggle is fixed at x8-44; the header starts after
      // that 48px gutter so Back is never underneath it (Back keeps its compact
      // pill instead of gaining the gutter inside its own border).
      const header = screen.getByTestId("dock-pillars-header");
      expect(header.className).toContain("pl-12");
      expect(header.className).toContain("sm:px-1");
      expect(header).toContainElement(screen.getByTestId("dock-pillars-back"));
      // The dock header already names the symbol, so the squeezed strip does
      // not repeat it where it can cover LIQUIDITY.
      expect(screen.getByTestId("dock-pillars-symbol").className).toContain("max-sm:hidden");
    });

    test("the tab strip stays scrollable and reveals the selected tab", async () => {
      const scrollIntoView = vi.fn();
      const original = HTMLElement.prototype.scrollIntoView;
      HTMLElement.prototype.scrollIntoView = scrollIntoView;
      try {
        view();
        await waitFor(() => expect(screen.getByTestId("pillar-volatility")).toBeInTheDocument(), PILLAR_WAIT);

        const strip = screen.getByTestId("dock-pillars-tabs");
        expect(strip.className).toContain("overflow-x-auto");

        // Mount already revealed the default tab; a selection must reveal the
        // newly active one (LIQUIDITY is the tab that ran off-screen at 390).
        expect(scrollIntoView).toHaveBeenCalled();
        scrollIntoView.mockClear();

        await fireEvent.click(screen.getByTestId("dock-pillar-tab-liquidity"));
        expect(scrollIntoView).toHaveBeenCalledWith({ inline: "nearest", block: "nearest" });
        expect(scrollIntoView.mock.contexts.at(-1)).toBe(
          screen.getByTestId("dock-pillar-tab-liquidity"),
        );
      } finally {
        if (original) HTMLElement.prototype.scrollIntoView = original;
        else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
      }
    });
  });
});
