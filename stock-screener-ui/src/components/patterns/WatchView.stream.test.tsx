// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, cleanup, waitFor } from "@testing-library/react";
import { UIProvider } from "@/ui";
import type { WatchPayload, WatchRow } from "@/types/chartPatterns";
import { WatchView, WATCH_SLOW_HINT_MS, universeLabel } from "./WatchView";

const mockFetchWatchSetups = vi.fn();
const mockFetchWatch = vi.fn();
const mockFetchMarketStatus = vi.fn();
const mockStreamWatch = vi.fn();
vi.mock("@/api/chartPatterns", () => ({
  fetchWatchSetups: (...args: unknown[]) => mockFetchWatchSetups(...args),
  fetchWatch: (...args: unknown[]) => mockFetchWatch(...args),
  fetchMarketStatus: (...args: unknown[]) => mockFetchMarketStatus(...args),
  streamWatch: (...args: unknown[]) => mockStreamWatch(...args),
}));

function makeRow(symbol: string, pct: number, state: WatchRow["state"]): WatchRow {
  return {
    symbol,
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
    pct_to_trigger: pct,
    state,
  };
}

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> });
}

describe("WatchView streaming", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchWatchSetups.mockResolvedValue([
      {
        id: "breakout",
        label: "Breakout",
        description: "Base breakout candidates",
        default_min_rel_volume: 0.7,
      },
    ]);
    mockFetchMarketStatus.mockResolvedValue({
      open: true,
      holiday: false,
      now_ist: "2026-09-30T10:00:00+05:30",
      reason: "open",
    });
    mockFetchWatch.mockResolvedValue({
      setup: "breakout",
      min_rel_volume: 0.7,
      updated_at: "2026-09-30T15:30:00+05:30",
      items: [],
    } satisfies WatchPayload);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  test("renders the meta + first row before done and clears the streaming mark", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockStreamWatch.mockImplementation(async (_query: unknown, handlers: any) => {
      handlers.onMeta?.({ setup: "breakout", min_rel_volume: 0.7 });
      handlers.onItem?.(makeRow("RELIANCE", 1.69, "armed"));
      await gate;
      handlers.onItem?.(makeRow("TCS", -1.25, "triggered"));
      handlers.onDone?.();
    });

    r(<WatchView universe="nifty500" timeframe="1D" />);

    // First row renders before done.
    await waitFor(() => expect(screen.getByTestId("watch-row-RELIANCE")).toBeInTheDocument());
    // Meta shows early: setup label + gate.
    expect(screen.getByTestId("watch-stream-meta")).toHaveTextContent("Breakout");
    expect(screen.getByTestId("watch-stream-meta")).toHaveTextContent("0.7");
    // Still streaming: progress mark visible, second row not yet here.
    expect(screen.getByTestId("watch-streaming")).toHaveTextContent("loading more…");
    expect(screen.queryByTestId("watch-row-TCS")).not.toBeInTheDocument();
    // Stream won: no fallback fetch.
    expect(mockFetchWatch).not.toHaveBeenCalled();

    release();

    await waitFor(() => expect(screen.getByTestId("watch-row-TCS")).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByTestId("watch-streaming")).not.toBeInTheDocument());
    expect(screen.getByTestId("watch-count")).toHaveTextContent("2 / 2");
  });

  test("an errored stream falls back to the non-streaming fetch", async () => {
    mockStreamWatch.mockImplementation(async (_query: unknown, handlers: any) => {
      handlers.onError?.(new Error("stream exploded"));
    });
    mockFetchWatch.mockResolvedValue({
      setup: "breakout",
      min_rel_volume: 0.7,
      updated_at: "2026-09-30T15:30:00+05:30",
      items: [makeRow("RELIANCE", 1.69, "armed"), makeRow("TCS", -1.25, "triggered")],
    } satisfies WatchPayload);

    r(<WatchView universe="nifty500" timeframe="1D" />);

    await waitFor(() => expect(screen.getByTestId("watch-row-RELIANCE")).toBeInTheDocument());
    expect(screen.getByTestId("watch-row-TCS")).toBeInTheDocument();
    expect(mockFetchWatch).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("watch-error")).not.toBeInTheDocument();
  });

  test("stream meta updated_at drives the snapshot age label", async () => {
    const { formatSnapshotAge } = await import("./WatchView");
    // Pure helper check against the SSE meta shape (deterministic, no timers).
    const updatedAt = "2026-09-30T15:30:00+05:30";
    const nowMs = new Date("2026-09-30T15:31:10+05:30").getTime();
    expect(formatSnapshotAge(updatedAt, nowMs)).toBe("snapshot 15:30 · 1m ago");

    mockStreamWatch.mockImplementation(async (_query: unknown, handlers: any) => {
      handlers.onMeta?.({
        setup: "breakout",
        min_rel_volume: 0.7,
        updated_at: updatedAt,
      });
      handlers.onItem?.(makeRow("RELIANCE", 1.69, "armed"));
      handlers.onDone?.();
    });

    r(<WatchView universe="nifty500" timeframe="1D" />);

    await waitFor(() => expect(screen.getByTestId("watch-row-RELIANCE")).toBeInTheDocument());
    // The SSE meta path sets updatedAt, so the snapshot age renders.
    await waitFor(() =>
      expect(screen.getByTestId("watch-snapshot-age")).toHaveTextContent("snapshot 15:30"),
    );
    expect(screen.getByTestId("watch-live-indicator")).toBeInTheDocument();
  });

  test("shows items/total when the stream meta carries total, keeping the streaming text", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockStreamWatch.mockImplementation(async (_query: unknown, handlers: any) => {
      handlers.onMeta?.({ setup: "breakout", min_rel_volume: 0.7, total: 10 });
      handlers.onItem?.(makeRow("RELIANCE", 1.69, "armed"));
      await gate;
      handlers.onItem?.(makeRow("TCS", -1.25, "triggered"));
      handlers.onDone?.();
    });

    r(<WatchView universe="nifty500" timeframe="1D" />);

    await waitFor(() => expect(screen.getByTestId("watch-row-RELIANCE")).toBeInTheDocument());
    expect(screen.getByTestId("watch-count")).toHaveTextContent("1 / 10");
    expect(screen.getByTestId("watch-streaming")).toHaveTextContent("loading more… 1 rows");

    release();

    await waitFor(() => expect(screen.getByTestId("watch-row-TCS")).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByTestId("watch-streaming")).not.toBeInTheDocument());
    expect(screen.getByTestId("watch-count")).toHaveTextContent("2 / 10");
  });

  test("falls back to filtered/items when the stream meta carries no total", async () => {
    mockStreamWatch.mockImplementation(async (_query: unknown, handlers: any) => {
      handlers.onMeta?.({ setup: "breakout", min_rel_volume: 0.7 });
      handlers.onItem?.(makeRow("RELIANCE", 1.69, "armed"));
      handlers.onItem?.(makeRow("TCS", -1.25, "triggered"));
      handlers.onDone?.();
    });

    r(<WatchView universe="nifty500" timeframe="1D" />);

    await waitFor(() => expect(screen.getByTestId("watch-row-TCS")).toBeInTheDocument());
    expect(screen.getByTestId("watch-count")).toHaveTextContent("2 / 2");

    fireEvent.change(screen.getByTestId("watch-search"), { target: { value: "rel" } });

    await waitFor(() => expect(screen.queryByTestId("watch-row-TCS")).not.toBeInTheDocument());
    expect(screen.getByTestId("watch-count")).toHaveTextContent("1 / 2");
  });

  test("universeLabel maps known ids and falls back to the raw id", () => {
    expect(universeLabel("all_equity")).toBe("All NSE Equity");
    expect(universeLabel("nifty500")).toBe("NIFTY 500");
    expect(universeLabel("some_custom_universe")).toBe("some_custom_universe");
    expect(WATCH_SLOW_HINT_MS).toBe(8000);
  });

  test("shows the slow computing hint after WATCH_SLOW_HINT_MS while streaming with no rows, without aborting the stream", async () => {
    vi.useFakeTimers();
    try {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      mockStreamWatch.mockImplementation(async (_query: unknown, handlers: any) => {
        handlers.onMeta?.({ setup: "breakout", min_rel_volume: 0.7 });
        // No item yet — the stream stays pending (slow arm/live).
        await gate;
        handlers.onItem?.(makeRow("RELIANCE", 1.69, "armed"));
        handlers.onDone?.();
      });

      r(<WatchView universe="all_equity" timeframe="1D" />);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByTestId("watch-loading")).toBeInTheDocument();
      expect(screen.queryByTestId("watch-loading-hint")).not.toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(WATCH_SLOW_HINT_MS - 1);
      });
      expect(screen.queryByTestId("watch-loading-hint")).not.toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(screen.getByTestId("watch-loading-hint")).toHaveTextContent(
        "Computing the All NSE Equity screen — this can take a few seconds for All NSE Equity.",
      );
      // Still loading and still streaming — the hint did not abort anything.
      expect(screen.getByTestId("watch-loading")).toBeInTheDocument();
      expect(mockFetchWatch).not.toHaveBeenCalled();

      // First item lands: loading + hint clear, the table takes over.
      await act(async () => {
        release();
        await Promise.resolve();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.queryByTestId("watch-loading-hint")).not.toBeInTheDocument();
      expect(screen.getByTestId("watch-row-RELIANCE")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  test("does not show the slow hint when rows arrive before the delay", async () => {
    vi.useFakeTimers();
    try {
      mockStreamWatch.mockImplementation(async (_query: unknown, handlers: any) => {
        handlers.onMeta?.({ setup: "breakout", min_rel_volume: 0.7, total: 2 });
        handlers.onItem?.(makeRow("RELIANCE", 1.69, "armed"));
        handlers.onDone?.();
      });

      r(<WatchView universe="nifty500" timeframe="1D" />);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(WATCH_SLOW_HINT_MS + 1000);
      });
      expect(screen.queryByTestId("watch-loading-hint")).not.toBeInTheDocument();
      expect(screen.getByTestId("watch-row-RELIANCE")).toBeInTheDocument();
      expect(screen.getByTestId("watch-count")).toHaveTextContent("1 / 2");
    } finally {
      vi.useRealTimers();
    }
  });
});
