// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import type { WatchPayload, WatchSetup } from "@/types/chartPatterns";
import { WatchView, WATCH_POLL_MS, WATCH_DEFAULT_WITHIN_PCT } from "./WatchView";

const mockFetchWatchSetups = vi.fn();
const mockFetchWatch = vi.fn();
const mockFetchMarketStatus = vi.fn();
vi.mock("@/api/chartPatterns", () => ({
  fetchWatchSetups: (...args: unknown[]) => mockFetchWatchSetups(...args),
  fetchWatch: (...args: unknown[]) => mockFetchWatch(...args),
  fetchMarketStatus: (...args: unknown[]) => mockFetchMarketStatus(...args),
}));

const SETUPS: WatchSetup[] = [
  {
    id: "breakout",
    label: "Breakout",
    description: "Base breakout candidates",
    default_min_rel_volume: 1.5,
  },
];

function makePayload(): WatchPayload {
  return {
    setup: "breakout",
    min_rel_volume: 1.5,
    updated_at: "2026-09-30T15:30:00+05:30",
    items: [
      {
        symbol: "RELIANCE",
        setup_id: "breakout",
        trigger_level: 3000,
        invalidate_level: 2800,
        base_days: 90,
        range_pct: 8.5,
        confidence: 78,
        status: "forming",
        end_date: "2026-09-30",
        ltp: 2950,
        rel_volume: 2.1,
        pct_to_trigger: 1.69,
        state: "armed",
      },
      {
        symbol: "TCS",
        setup_id: "breakout",
        trigger_level: 4000,
        invalidate_level: 3800,
        base_days: 120,
        range_pct: 6.2,
        confidence: 85,
        status: "confirmed",
        end_date: "2026-09-30",
        ltp: 4050,
        rel_volume: 3.2,
        pct_to_trigger: -1.25,
        state: "triggered",
      },
      {
        symbol: "INFY",
        setup_id: "breakout",
        trigger_level: 1800,
        invalidate_level: 1700,
        base_days: 60,
        range_pct: 9.1,
        confidence: 64,
        status: "failed",
        end_date: "2026-09-30",
        ltp: 1650,
        rel_volume: 1.6,
        pct_to_trigger: 9.09,
        state: "invalidated",
      },
    ],
  };
}

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> });
}

describe("WatchView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchWatchSetups.mockResolvedValue(SETUPS);
    mockFetchWatch.mockResolvedValue(makePayload());
    mockFetchMarketStatus.mockResolvedValue({
      open: true,
      holiday: false,
      now_ist: "2026-09-30T10:00:00+05:30",
      reason: "open",
    });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  test("loads setups and renders rows with state badges", async () => {
    const user = userEvent.setup();
    r(<WatchView universe="nifty500" timeframe="1D" minBaseDays={60} />);

    expect(screen.getByTestId("watch-loading")).toBeInTheDocument();

    await waitFor(() => expect(mockFetchWatchSetups).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockFetchWatch).toHaveBeenCalledTimes(1));

    expect(mockFetchWatch).toHaveBeenCalledWith({
      setup: "breakout",
      universe: "nifty500",
      timeframe: "1D",
      minBaseDays: 60,
      minRelVolume: 1.5,
    });

    // Defaults focus on actionable rows (within 5%, invalidated hidden):
    // clear them to see the full list.
    fireEvent.change(within(screen.getByTestId("watch-within-pct")).getByRole("spinbutton"), {
      target: { value: "" },
    });
    await user.click(screen.getByTestId("watch-hide-invalidated"));

    await waitFor(() => expect(screen.getByTestId("watch-row-RELIANCE")).toBeInTheDocument());
    expect(screen.getByTestId("watch-row-TCS")).toBeInTheDocument();
    expect(screen.getByTestId("watch-row-INFY")).toBeInTheDocument();

    expect(screen.getByTestId("watch-state-armed")).toHaveTextContent("armed");
    expect(screen.getByTestId("watch-state-triggered")).toHaveTextContent("triggered");
    expect(screen.getByTestId("watch-state-invalidated")).toHaveTextContent("invalidated");

    expect(screen.getByTestId("watch-setup-description")).toHaveTextContent(
      "Base breakout candidates",
    );
    expect(screen.getByTestId("watch-updated-at")).toHaveTextContent("2026-09-30");
  });

  test("shows the rel-vol input default from the setup and a refresh button", async () => {
    r(<WatchView universe="nifty500" timeframe="1D" />);
    await waitFor(() => expect(screen.queryByTestId("watch-loading")).not.toBeInTheDocument());

    expect(screen.getByTestId("watch-relvol-input")).toBeInTheDocument();
    expect(screen.getByTestId("watch-refresh")).toBeInTheDocument();
    expect(screen.getByTestId("watch-live-indicator")).toBeInTheDocument();
  });

  test("Refresh button re-fetches the watch list", async () => {
    r(<WatchView universe="nifty500" timeframe="1D" />);
    await waitFor(() => expect(mockFetchWatch).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByTestId("watch-refresh"));
    await waitFor(() => expect(mockFetchWatch).toHaveBeenCalledTimes(2));
  });

  test("row click calls onOpenSymbol with the symbol", async () => {
    const onOpenSymbol = vi.fn();
    r(<WatchView universe="nifty500" timeframe="1D" onOpenSymbol={onOpenSymbol} />);
    await waitFor(() => expect(screen.getByTestId("watch-row-TCS")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId("watch-row-TCS"));
    expect(onOpenSymbol).toHaveBeenCalledWith("TCS");
  });

  test("sets a poll interval and clears it on unmount", async () => {
    const setSpy = vi.spyOn(globalThis, "setInterval");
    const clearSpy = vi.spyOn(globalThis, "clearInterval");

    const { unmount } = r(<WatchView universe="nifty500" timeframe="1D" />);
    await waitFor(() => expect(mockFetchWatch).toHaveBeenCalled());

    expect(setSpy).toHaveBeenCalledWith(expect.any(Function), WATCH_POLL_MS);
    const timer = setSpy.mock.results[0].value;
    unmount();
    expect(clearSpy).toHaveBeenCalledWith(timer);
  });

  test("shows the error state when the watch fetch fails", async () => {
    mockFetchWatch.mockRejectedValueOnce(new Error("watch exploded"));
    r(<WatchView universe="nifty500" timeframe="1D" />);

    await waitFor(() => expect(screen.getByTestId("watch-error")).toBeInTheDocument());
    expect(screen.getByTestId("watch-error")).toHaveTextContent("watch exploded");
  });

  test("shows the empty state when there are no candidates", async () => {
    mockFetchWatch.mockResolvedValueOnce({ ...makePayload(), items: [] });
    r(<WatchView universe="nifty500" timeframe="1D" />);

    await waitFor(() => expect(screen.getByTestId("watch-empty")).toBeInTheDocument());
    expect(screen.getByTestId("watch-empty")).toHaveTextContent("nifty500");
  });

  test("default-sorts by % to trigger (most advanced first)", async () => {
    const user = userEvent.setup();
    r(<WatchView universe="nifty500" timeframe="1D" />);
    await waitFor(() => expect(screen.getByTestId("watch-row-RELIANCE")).toBeInTheDocument());

    // Clear the default focus filters to see the full sorted list.
    fireEvent.change(within(screen.getByTestId("watch-within-pct")).getByRole("spinbutton"), {
      target: { value: "" },
    });
    await user.click(screen.getByTestId("watch-hide-invalidated"));

    await waitFor(() => expect(screen.getByTestId("watch-row-INFY")).toBeInTheDocument());
    const ids = Array.from(document.querySelectorAll('[data-testid^="watch-row-"]')).map(
      (el) => el.getAttribute("data-testid"),
    );
    // desc by pct_to_trigger: INFY (9.09), RELIANCE (1.69), TCS (-1.25).
    expect(ids).toEqual(["watch-row-INFY", "watch-row-RELIANCE", "watch-row-TCS"]);
  });

  test("symbol search filters the rows client-side", async () => {
    r(<WatchView universe="nifty500" timeframe="1D" />);
    await waitFor(() => expect(screen.getByTestId("watch-row-TCS")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("watch-search"), { target: { value: "rel" } });

    await waitFor(() => expect(screen.queryByTestId("watch-row-TCS")).not.toBeInTheDocument());
    expect(screen.getByTestId("watch-row-RELIANCE")).toBeInTheDocument();
    expect(screen.getByTestId("watch-count")).toHaveTextContent("1 / 3");
  });

  test("state filter narrows to a single state", async () => {
    const user = userEvent.setup();
    r(<WatchView universe="nifty500" timeframe="1D" />);
    await waitFor(() => expect(screen.getByTestId("watch-row-TCS")).toBeInTheDocument());

    await user.click(within(screen.getByTestId("watch-state-filter")).getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Triggered" }));

    await waitFor(() => expect(screen.queryByTestId("watch-row-RELIANCE")).not.toBeInTheDocument());
    expect(screen.getByTestId("watch-row-TCS")).toBeInTheDocument();
    expect(screen.getByTestId("watch-count")).toHaveTextContent("1 / 3");
  });

  test("within % of trigger filters by distance to the level", async () => {
    const user = userEvent.setup();
    r(<WatchView universe="nifty500" timeframe="1D" />);
    await waitFor(() => expect(screen.getByTestId("watch-row-RELIANCE")).toBeInTheDocument());

    // Clear the default focus filters to see INFY first.
    fireEvent.change(within(screen.getByTestId("watch-within-pct")).getByRole("spinbutton"), {
      target: { value: "" },
    });
    await user.click(screen.getByTestId("watch-hide-invalidated"));
    await waitFor(() => expect(screen.getByTestId("watch-row-INFY")).toBeInTheDocument());

    fireEvent.change(within(screen.getByTestId("watch-within-pct")).getByRole("spinbutton"), {
      target: { value: "2" },
    });

    // |pct| <= 2 keeps RELIANCE (1.69) and TCS (-1.25); INFY (9.09) drops.
    await waitFor(() => expect(screen.queryByTestId("watch-row-INFY")).not.toBeInTheDocument());
    expect(screen.getByTestId("watch-row-RELIANCE")).toBeInTheDocument();
    expect(screen.getByTestId("watch-row-TCS")).toBeInTheDocument();
  });

  test("defaults Within % of trigger to 5 so the table opens focused", async () => {
    expect(WATCH_DEFAULT_WITHIN_PCT).toBe(5);
    r(<WatchView universe="nifty500" timeframe="1D" />);
    await waitFor(() => expect(screen.getByTestId("watch-row-RELIANCE")).toBeInTheDocument());

    expect(
      within(screen.getByTestId("watch-within-pct")).getByRole("spinbutton"),
    ).toHaveValue(5);
    // INFY sits 9.09% away → filtered by the default; the actionable pair stays.
    expect(screen.queryByTestId("watch-row-INFY")).not.toBeInTheDocument();
    expect(screen.getByTestId("watch-row-TCS")).toBeInTheDocument();
    expect(screen.getByTestId("watch-count")).toHaveTextContent("2 / 3");
  });

  test("hide-invalidated is on by default and the toggle reveals those rows", async () => {
    const user = userEvent.setup();
    r(<WatchView universe="nifty500" timeframe="1D" />);
    await waitFor(() => expect(screen.getByTestId("watch-row-RELIANCE")).toBeInTheDocument());

    const toggle = screen.getByTestId("watch-hide-invalidated");
    expect(toggle).toBeChecked();
    // INFY is both invalidated and outside the default within-% window.
    expect(screen.queryByTestId("watch-row-INFY")).not.toBeInTheDocument();

    fireEvent.change(within(screen.getByTestId("watch-within-pct")).getByRole("spinbutton"), {
      target: { value: "" },
    });
    await user.click(toggle);
    expect(toggle).not.toBeChecked();
    await waitFor(() => expect(screen.getByTestId("watch-row-INFY")).toBeInTheDocument());

    await user.click(toggle);
    expect(toggle).toBeChecked();
    await waitFor(() => expect(screen.queryByTestId("watch-row-INFY")).not.toBeInTheDocument());
  });

  test("renders a fresh marker for fresh rows", async () => {
    mockFetchWatch.mockResolvedValueOnce({
      ...makePayload(),
      items: makePayload().items.map((row) =>
        row.symbol === "TCS" ? { ...row, fresh: true } : row,
      ),
    });
    r(<WatchView universe="nifty500" timeframe="1D" />);
    await waitFor(() => expect(screen.getByTestId("watch-row-TCS")).toBeInTheDocument());

    expect(screen.getByTestId("watch-fresh-TCS")).toHaveTextContent("fresh");
    expect(screen.queryByTestId("watch-fresh-RELIANCE")).not.toBeInTheDocument();
  });

  test("skips the 20s poll when market-status reports closed", async () => {
    mockFetchMarketStatus.mockResolvedValue({
      open: false,
      holiday: true,
      now_ist: "2026-10-04T10:00:00+05:30",
      reason: "holiday",
    });
    const fns: Array<() => unknown> = [];
    const setSpy = vi
      .spyOn(globalThis, "setInterval")
      .mockImplementation(((fn: () => unknown) => {
        fns.push(fn);
        return (fns.length * 1000) as unknown as NodeJS.Timeout;
      }) as never);
    const clearSpy = vi.spyOn(globalThis, "clearInterval").mockImplementation((() => undefined) as never);

    try {
      r(<WatchView universe="nifty500" timeframe="1D" />);
      await waitFor(() => expect(mockFetchWatch).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(mockFetchMarketStatus).toHaveBeenCalled());
      await waitFor(() =>
        expect(screen.getByTestId("watch-live-indicator")).toHaveTextContent("paused"),
      );

      // Fire every captured timer (status refresh + watch tick).
      for (const fn of fns) await fn();
      await waitFor(() => expect(mockFetchMarketStatus).toHaveBeenCalledTimes(2));
      // The watch tick must not refetch while the market is closed.
      expect(mockFetchWatch).toHaveBeenCalledTimes(1);
    } finally {
      setSpy.mockRestore();
      clearSpy.mockRestore();
    }
  });

  test("polls the watch list while market-status reports open", async () => {
    mockFetchMarketStatus.mockResolvedValue({
      open: true,
      holiday: false,
      now_ist: "2026-09-30T10:00:00+05:30",
      reason: "open",
    });
    const fns: Array<() => unknown> = [];
    const setSpy = vi
      .spyOn(globalThis, "setInterval")
      .mockImplementation(((fn: () => unknown) => {
        fns.push(fn);
        return (fns.length * 1000) as unknown as NodeJS.Timeout;
      }) as never);
    const clearSpy = vi.spyOn(globalThis, "clearInterval").mockImplementation((() => undefined) as never);

    try {
      r(<WatchView universe="nifty500" timeframe="1D" />);
      await waitFor(() => expect(mockFetchWatch).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(screen.getByTestId("watch-live-indicator")).toHaveTextContent("live"),
      );

      for (const fn of fns) await fn();
      await waitFor(() => expect(mockFetchWatch).toHaveBeenCalledTimes(2));
    } finally {
      setSpy.mockRestore();
      clearSpy.mockRestore();
    }
  });

  test("falls back to the client clock when market-status fails", async () => {
    mockFetchMarketStatus.mockRejectedValueOnce(new Error("status exploded"));
    r(<WatchView universe="nifty500" timeframe="1D" />);
    await waitFor(() => expect(mockFetchWatch).toHaveBeenCalledTimes(1));
    // No crash, badge still renders (open/closed per the local IST clock).
    expect(screen.getByTestId("watch-live-indicator")).toBeInTheDocument();
  });
});
