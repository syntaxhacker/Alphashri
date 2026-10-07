// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { UIProvider } from "@/ui";
import type { WatchPayload, WatchRow } from "@/types/chartPatterns";
import { WatchView } from "./WatchView";

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
});
