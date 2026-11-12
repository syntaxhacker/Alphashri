import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@solidjs/testing-library";
import { IndexMoversStrip } from "./IndexMoversStrip";
import { fetchIndexMovers, IndexMoversResponse } from "@/api/indexMovers";

// Mock the API
vi.mock("@/api/indexMovers", () => ({
  fetchIndexMovers: vi.fn(),
}));

const mockFetchIndexMovers = vi.mocked(fetchIndexMovers);

const createMockResponse = (overrides: Partial<IndexMoversResponse> = {}): IndexMoversResponse => ({
  index: "NIFTY",
  as_of: new Date().toISOString(),
  stale: false,
  source: "NIFTY50_WEIGHTS (Tickertape 2026-10-15)",
  gainers: [
    { symbol: "HDFCBANK", ltp: 1750.0, change_pct: 1.92, contribution_pct: 0.206, volume: 1234567 },
    { symbol: "TITAN", ltp: 3450.0, change_pct: 1.45, contribution_pct: 0.023, volume: 876543 },
    { symbol: "BAJFINANCE", ltp: 7200.0, change_pct: 1.12, contribution_pct: 0.027, volume: 543210 },
  ],
  losers: [
    { symbol: "TCS", ltp: 3450.0, change_pct: -2.52, contribution_pct: -0.058, volume: 987654 },
    { symbol: "INFY", ltp: 1450.0, change_pct: -1.73, contribution_pct: -0.063, volume: 765432 },
    { symbol: "HCLTECH", ltp: 1250.0, change_pct: -1.28, contribution_pct: -0.017, volume: 432109 },
  ],
  live_only: false,
  ...overrides,
});

describe("IndexMoversStrip", () => {
  const onExpand = vi.fn();

  beforeEach(() => {
    mockFetchIndexMovers.mockReset();
    onExpand.mockClear();
  });

  it("renders loading state initially", async () => {
    let _resolve: (v: IndexMoversResponse) => void;
    const promise = new Promise<IndexMoversResponse>((r) => { _resolve = r; });
    mockFetchIndexMovers.mockReturnValue(promise);

    render(() =>
      <IndexMoversStrip index="NIFTY" onExpand={onExpand} />);

    expect(screen.getByTestId("movers-strip")).toBeInTheDocument();
    expect(screen.getByText("MOVERS")).toBeInTheDocument();
    expect(screen.getByText("loading…")).toBeInTheDocument();
  });

  it("renders gainers and losers when data loads", async () => {
    mockFetchIndexMovers.mockResolvedValue(createMockResponse());

    render(() =>
      <IndexMoversStrip index="NIFTY" onExpand={onExpand} />);

    await waitFor(() => expect(screen.getByText("HDFCBANK")).toBeInTheDocument(), { timeout: 10000 });
    await waitFor(() => expect(screen.getByText("TCS")).toBeInTheDocument(), { timeout: 10000 });

    expect(mockFetchIndexMovers).toHaveBeenCalledWith("NIFTY", 5, expect.anything());
    expect(screen.getByText("+1.92%")).toBeInTheDocument();
    expect(screen.getByText("-2.52%")).toBeInTheDocument();
  });

  it("shows EXPAND button", async () => {
    mockFetchIndexMovers.mockResolvedValue(createMockResponse());

    render(() =>
      <IndexMoversStrip index="NIFTY" onExpand={onExpand} />);

    await waitFor(() => expect(screen.getByTestId("movers-expand")).toBeInTheDocument(), { timeout: 10000 });
    expect(screen.getByTestId("movers-expand")).toHaveTextContent("EXPAND");
  });

  it("calls onExpand when EXPAND clicked", async () => {
    mockFetchIndexMovers.mockResolvedValue(createMockResponse());

    render(() =>
      <IndexMoversStrip index="NIFTY" onExpand={onExpand} />);

    await waitFor(() => expect(screen.getByTestId("movers-expand")).toBeInTheDocument(), { timeout: 10000 });
    fireEvent.click(screen.getByTestId("movers-expand"));

    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it("shows stale badge when data.stale is true", async () => {
    mockFetchIndexMovers.mockResolvedValue(createMockResponse({ stale: true }));

    render(() =>
      <IndexMoversStrip index="NIFTY" onExpand={onExpand} />);

    await waitFor(() => expect(screen.getByText("STALE")).toBeInTheDocument(), { timeout: 10000 });
  });

  it("renders live-only message for EOD/replay", () => {
    render(() =>
      <IndexMoversStrip index="NIFTY" onExpand={onExpand} liveOnly />);

    expect(screen.getByText("MOVERS")).toBeInTheDocument();
    expect(screen.getByText("· live only")).toBeInTheDocument();
    expect(mockFetchIndexMovers).not.toHaveBeenCalled();
  });

  it("shows error state when fetch fails", async () => {
    mockFetchIndexMovers.mockRejectedValue(new Error("Network error"));

    render(() =>
      <IndexMoversStrip index="NIFTY" onExpand={onExpand} />);

    await waitFor(() => expect(screen.getByText("unavailable")).toBeInTheDocument(), { timeout: 10000 });
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("shows MOVERS_UNAVAILABLE error correctly", async () => {
    mockFetchIndexMovers.mockRejectedValue(new Error("MOVERS_UNAVAILABLE"));

    render(() =>
      <IndexMoversStrip index="NIFTY" onExpand={onExpand} />);

    await waitFor(() => expect(screen.getByText("unavailable")).toBeInTheDocument(), { timeout: 10000 });
  });

  it("renders SENSEX 30 label correctly", async () => {
    mockFetchIndexMovers.mockResolvedValue(createMockResponse({ index: "SENSEX" }));

    render(() =>
      <IndexMoversStrip index="SENSEX" onExpand={onExpand} />);

    await waitFor(() => expect(screen.getByTestId("movers-strip")).toBeInTheDocument(), { timeout: 10000 });
    // Text is split across elements, use regex on the container
    expect(screen.getByTestId("movers-strip")).toHaveTextContent(/SENSEX 30/);
  });

  describe("polling behavior", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("polls every 30s in live mode", async () => {
      mockFetchIndexMovers.mockResolvedValue(createMockResponse());

      render(() =>
      <IndexMoversStrip index="NIFTY" onExpand={onExpand} />);

      // Flush the initial effect/promise without waitFor (which stalls under
      // fake timers).
      await vi.advanceTimersByTimeAsync(0);
      expect(mockFetchIndexMovers).toHaveBeenCalledTimes(1);
      expect(screen.getByText("HDFCBANK")).toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(30_000);
      expect(mockFetchIndexMovers).toHaveBeenCalledTimes(2);
    }, 10000);

    it("does not poll when liveOnly is true", async () => {
      mockFetchIndexMovers.mockResolvedValue(createMockResponse());

      render(() =>
      <IndexMoversStrip index="NIFTY" onExpand={onExpand} liveOnly />);

      expect(mockFetchIndexMovers).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(30_000);
      expect(mockFetchIndexMovers).not.toHaveBeenCalled();
    });

    it("cleans up on unmount", async () => {
      mockFetchIndexMovers.mockResolvedValue(createMockResponse());

      const { unmount } = render(() =>
      <IndexMoversStrip index="NIFTY" onExpand={onExpand} />);
      await vi.advanceTimersByTimeAsync(0);
      expect(mockFetchIndexMovers).toHaveBeenCalledTimes(1);

      unmount();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(mockFetchIndexMovers).toHaveBeenCalledTimes(1);
    });
  });
});