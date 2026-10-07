// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import type { WatchPayload, WatchRow, WatchSetup } from "@/types/chartPatterns";
import { WatchView, WATCH_POLL_MS, WATCH_DEFAULT_WITHIN_PCT, WATCH_DEFAULT_MIN_REL_VOLUME } from "./WatchView";

const mockFetchWatchSetups = vi.fn();
const mockFetchWatch = vi.fn();
const mockFetchMarketStatus = vi.fn();
vi.mock("@/api/chartPatterns", () => ({
  fetchWatchSetups: (...args: unknown[]) => mockFetchWatchSetups(...args),
  fetchWatch: (...args: unknown[]) => mockFetchWatch(...args),
  fetchMarketStatus: (...args: unknown[]) => mockFetchMarketStatus(...args),
  // No live stream in these tests: fail fast so every load exercises the
  // non-streaming `fetchWatch` fallback deterministically.
  streamWatch: async (_query: unknown, handlers: { onError?: (e: Error) => void }) => {
    handlers.onError?.(new Error("stream unavailable"));
  },
}));

const SETUPS: WatchSetup[] = [
  {
    id: "breakout",
    label: "Breakout",
    description: "Base breakout candidates",
    default_min_rel_volume: 0.7,
  },
];

function makePayload(): WatchPayload {
  return {
    setup: "breakout",
    min_rel_volume: 0.7,
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
        vol_adj: 2.35,
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
        vol_adj: 1.42,
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
        vol_adj: null,
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
      minRelVolume: 0.7,
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

  test("shows the vol-adj gate input default from the setup and a refresh button", async () => {
    expect(WATCH_DEFAULT_MIN_REL_VOLUME).toBe(0.7);
    r(<WatchView universe="nifty500" timeframe="1D" />);
    await waitFor(() => expect(screen.queryByTestId("watch-loading")).not.toBeInTheDocument());

    expect(screen.getByTestId("watch-relvol-input")).toBeInTheDocument();
    expect(screen.getByTestId("watch-vol-adj-input")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("watch-relvol-input")).getByRole("spinbutton"),
    ).toHaveValue(0.7);
    expect(screen.getByTestId("watch-refresh")).toBeInTheDocument();
    expect(screen.getByTestId("watch-live-indicator")).toBeInTheDocument();
  });

  test("changing the vol-adj gate refetches with minRelVolume", async () => {
    const user = userEvent.setup();
    r(<WatchView universe="nifty500" timeframe="1D" />);
    await waitFor(() => expect(mockFetchWatch).toHaveBeenCalledTimes(1));
    expect(mockFetchWatch).toHaveBeenLastCalledWith(
      expect.objectContaining({ minRelVolume: 0.7 }),
    );

    fireEvent.change(within(screen.getByTestId("watch-relvol-input")).getByRole("spinbutton"), {
      target: { value: "1.2" },
    });
    await waitFor(() =>
      expect(mockFetchWatch).toHaveBeenLastCalledWith(
        expect.objectContaining({ minRelVolume: 1.2 }),
      ),
    );
    expect(user).toBeDefined();
  });

  test("renders the Vol (adj) column with formatted values and — for null", async () => {
    const user = userEvent.setup();
    r(<WatchView universe="nifty500" timeframe="1D" />);
    await waitFor(() => expect(screen.getByTestId("watch-row-RELIANCE")).toBeInTheDocument());

    expect(screen.getByText("Vol (adj)")).toBeInTheDocument();
    expect(screen.getByTestId("watch-vol-adj-RELIANCE")).toHaveTextContent("2.35x");
    expect(screen.getByTestId("watch-vol-adj-TCS")).toHaveTextContent("1.42x");

    // Clear the default focus filters to reveal the invalidated INFY row (null vol_adj).
    fireEvent.change(within(screen.getByTestId("watch-within-pct")).getByRole("spinbutton"), {
      target: { value: "" },
    });
    await user.click(screen.getByTestId("watch-hide-invalidated"));
    await waitFor(() => expect(screen.getByTestId("watch-vol-adj-INFY")).toBeInTheDocument());
    expect(screen.getByTestId("watch-vol-adj-INFY")).toHaveTextContent("—");
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

  test("does not auto-poll the watch list (manual refresh only)", async () => {
    const setSpy = vi.spyOn(globalThis, "setInterval");
    try {
      r(<WatchView universe="nifty500" timeframe="1D" />);
      await waitFor(() => expect(mockFetchWatch).toHaveBeenCalled());

      // Auto-refresh is disabled: the watch-list poll interval is not installed.
      expect(setSpy).not.toHaveBeenCalledWith(expect.any(Function), WATCH_POLL_MS);
    } finally {
      setSpy.mockRestore();
    }
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

  test("skips the auto-poll when market-status reports closed", async () => {
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

  test("does not auto-poll while market-status reports open (auto-refresh disabled)", async () => {
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

      // Fire every captured timer (the market-status probe) and settle: the
      // watch list must NOT refetch — only the manual REFRESH button does.
      for (const fn of fns) await fn();
      for (let i = 0; i < 50; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(mockFetchWatch).toHaveBeenCalledTimes(1);
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

describe("WatchView near_52w", () => {
  const NEAR_SETUPS: WatchSetup[] = [
    {
      id: "breakout",
      label: "Breakout",
      description: "Base breakout candidates",
      default_min_rel_volume: 0.7,
    },
    {
      id: "near_52w",
      label: "Near 52W high + accumulation",
      description: "Near-high accumulation candidates",
      default_min_rel_volume: 0.7,
    },
  ];

  function nearRow(overrides: Partial<WatchRow> & { symbol: string }): WatchRow {
    return {
      setup_id: "near_52w",
      trigger_level: 1000,
      invalidate_level: 900,
      base_days: 0,
      range_pct: 0,
      confidence: 70,
      status: "",
      end_date: "2026-09-30",
      ltp: 990,
      rel_volume: 2.5,
      vol_adj: 1.1,
      pct_to_trigger: null,
      state: "armed",
      ...overrides,
    };
  }

  function makeNearPayload(): WatchPayload {
    return {
      setup: "near_52w",
      min_rel_volume: 0.7,
      updated_at: "2026-09-30T15:30:00+05:30",
      items: [
        nearRow({
          symbol: "AAA",
          state: "armed",
          ltp: 990,
          close: 985,
          last_high: 995,
          touched: true,
          high_gap: -0.5,
          close_gap: 1.5,
          obv_slope: 123.456,
          updown: 1.234,
          vol_ratio: 2.345,
          rising_lows: true,
          vol_adj: 1.1,
        }),
        nearRow({
          symbol: "BBB",
          state: "triggered",
          ltp: 1002,
          close: 994,
          last_high: 996,
          touched: false,
          high_gap: 0.8,
          close_gap: 0.5,
          obv_slope: -12.345,
          updown: 0.876,
          vol_ratio: 1.5,
          rising_lows: false,
          rel_volume: 3.1,
          vol_adj: 0.45,
        }),
        nearRow({
          symbol: "CCC",
          state: "armed",
          ltp: 972,
          close: 968,
          last_high: 990,
          touched: false,
          high_gap: 1.2,
          close_gap: 3.2,
          obv_slope: 0,
          updown: 1.0,
          vol_ratio: 1.62,
          rising_lows: true,
          rel_volume: 1.8,
          vol_adj: null,
        }),
      ],
    };
  }

  async function renderAndSwitchToNear() {
    mockFetchWatchSetups.mockResolvedValue(NEAR_SETUPS);
    const near = makeNearPayload();
    mockFetchWatch.mockImplementation((query: { setup: string }) =>
      Promise.resolve(query.setup === "near_52w" ? near : makePayload()),
    );
    const user = userEvent.setup();
    r(<WatchView universe="nifty500" timeframe="1D" />);
    await waitFor(() => expect(screen.getByTestId("watch-row-RELIANCE")).toBeInTheDocument());

    await user.click(within(screen.getByTestId("watch-setup-select")).getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Near 52W high + accumulation" }));
    await waitFor(() => expect(screen.getByTestId("watch-row-AAA")).toBeInTheDocument());
    return { user, near };
  }

  test("renders the accumulation columns with formatted values", async () => {
    await renderAndSwitchToNear();

    for (const header of ["52W high", "Hi gap %", "OBV", "Up/Dn", "VolR", "Lows", "Vol (adj)"]) {
      expect(screen.getByText(header)).toBeInTheDocument();
    }
    // The default-sorted column carries the ▲/▼ indicator, so match loosely.
    expect(screen.getByText(/Close gap %/)).toBeInTheDocument();
    // Breakout-only columns are gone in this mode.
    expect(screen.queryByText("Trigger")).not.toBeInTheDocument();
    expect(screen.queryByText("Base (d)")).not.toBeInTheDocument();

    const row = within(screen.getByTestId("watch-row-AAA"));
    expect(row.getByText("₹990.00")).toBeInTheDocument();
    expect(row.getByText("₹1000.00")).toBeInTheDocument();
    expect(row.getByText("-0.50%")).toBeInTheDocument();
    expect(row.getByText("+1.50%")).toBeInTheDocument();
    expect(row.getByText("123.46")).toBeInTheDocument();
    expect(row.getByText("1.23")).toBeInTheDocument();
    expect(row.getByText("2.35x")).toBeInTheDocument();
    expect(row.getByText("2.50x")).toBeInTheDocument();
    expect(screen.getByTestId("watch-vol-adj-AAA")).toHaveTextContent("1.10x");
    expect(screen.getByTestId("watch-vol-adj-BBB")).toHaveTextContent("0.45x");
    expect(screen.getByTestId("watch-vol-adj-CCC")).toHaveTextContent("—");
    expect(screen.getByTestId("watch-lows-AAA")).toHaveTextContent("↑↑");
    expect(screen.getByTestId("watch-lows-BBB")).toHaveTextContent("—");
  });

  test("touched marker shows only for touched:true rows", async () => {
    await renderAndSwitchToNear();

    expect(screen.getByTestId("watch-touched-AAA")).toHaveTextContent("touched");
    expect(screen.queryByTestId("watch-touched-BBB")).not.toBeInTheDocument();
    expect(screen.queryByTestId("watch-touched-CCC")).not.toBeInTheDocument();
  });

  test("default-sorts near_52w by close_gap ascending (nearest first)", async () => {
    await renderAndSwitchToNear();

    const ids = Array.from(document.querySelectorAll('[data-testid^="watch-row-"]')).map(
      (el) => el.getAttribute("data-testid"),
    );
    // close_gap: BBB (0.5), AAA (1.5), CCC (3.2).
    expect(ids).toEqual(["watch-row-BBB", "watch-row-AAA", "watch-row-CCC"]);
  });

  test("breakout columns are unchanged", async () => {
    r(<WatchView universe="nifty500" timeframe="1D" />);
    await waitFor(() => expect(screen.getByTestId("watch-row-RELIANCE")).toBeInTheDocument());

    for (const header of ["Trigger", "Rel vol", "Vol (adj)", "Base (d)", "Status"]) {
      expect(screen.getByText(header)).toBeInTheDocument();
    }
    // The default-sorted column carries the ▼ indicator, so match loosely.
    expect(screen.getByText(/% to trigger/)).toBeInTheDocument();
    expect(screen.queryByText("52W high")).not.toBeInTheDocument();
    expect(screen.queryByText(/Close gap %/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("watch-touched-RELIANCE")).not.toBeInTheDocument();
  });
});

describe("WatchView copy CSV", () => {
  const writeText = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    mockFetchWatchSetups.mockResolvedValue(SETUPS);
    mockFetchWatch.mockResolvedValue(makePayload());
    mockFetchMarketStatus.mockResolvedValue({
      open: false,
      holiday: false,
      now_ist: "2026-09-30T10:00:00+05:30",
      reason: "closed",
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  test("Copy CSV copies the filtered rows and shows a confirmation", async () => {
    r(<WatchView universe="nifty500" timeframe="1D" />);
    await waitFor(() => expect(screen.getByTestId("watch-row-RELIANCE")).toBeInTheDocument());

    // Narrow to RELIANCE via search; TCS must be excluded from the copy.
    fireEvent.change(screen.getByTestId("watch-search"), { target: { value: "rel" } });
    await waitFor(() => expect(screen.queryByTestId("watch-row-TCS")).not.toBeInTheDocument());

    await userEvent.click(screen.getByTestId("watch-copy-csv"));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const text = String(writeText.mock.calls[0][0]);
    const [header, ...lines] = text.split("\n");
    expect(header).toContain("Symbol");
    expect(text).toContain("RELIANCE");
    expect(text).not.toContain("TCS");
    expect(text).not.toContain("INFY");
    expect(lines).toHaveLength(1);

    const toast = await screen.findByTestId("watch-copy-toast");
    expect(toast).toHaveTextContent("Copied 1 row");
  });

  test("Copy CSV includes the Vol (adj) column", async () => {
    r(<WatchView universe="nifty500" timeframe="1D" />);
    await waitFor(() => expect(screen.getByTestId("watch-row-RELIANCE")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("watch-search"), { target: { value: "rel" } });
    await waitFor(() => expect(screen.queryByTestId("watch-row-TCS")).not.toBeInTheDocument());

    await userEvent.click(screen.getByTestId("watch-copy-csv"));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const text = String(writeText.mock.calls[0][0]);
    const [header] = text.split("\n");
    expect(header).toContain("Vol (adj)");
    expect(text).toContain("2.35");
  });

  test("Copy symbols copies the visible symbols as a comma list", async () => {
    r(<WatchView universe="nifty500" timeframe="1D" />);
    await waitFor(() => expect(screen.getByTestId("watch-row-RELIANCE")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId("watch-copy-symbols"));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const text = String(writeText.mock.calls[0][0]);
    // Default filters: RELIANCE + TCS visible, INFY hidden (invalidated + out of range).
    expect(text).toBe("NSE:RELIANCE,NSE:TCS");

    const toast = await screen.findByTestId("watch-copy-toast");
    expect(toast).toHaveTextContent("Copied 2 symbols");
  });

  test("shows an error when the copy fails", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    r(<WatchView universe="nifty500" timeframe="1D" />);
    await waitFor(() => expect(screen.getByTestId("watch-row-RELIANCE")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId("watch-copy-csv"));

    const toast = await screen.findByTestId("watch-copy-toast");
    expect(toast).toHaveTextContent("Copy failed");
  });
});
