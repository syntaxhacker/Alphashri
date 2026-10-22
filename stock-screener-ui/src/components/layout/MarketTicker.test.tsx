// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MarketTicker } from "./MarketTicker";
import { UIProvider } from "@/ui";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";
import { isMarketClosedToday, getHolidayState } from "../../state/holidays";

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock useMarketTickerEnabled with controllable value
let mockMarketTickerEnabled = true;
const mockSetMarketTickerEnabled = vi.fn();

vi.mock("../../hooks/useMarketTickerEnabled", () => ({
  useMarketTickerEnabled: () => [mockMarketTickerEnabled, mockSetMarketTickerEnabled],
}));

vi.mock("../../state/holidays", () => ({
  subscribeToHolidays: vi.fn(),
  isMarketClosedToday: vi.fn().mockReturnValue(false),
  getHolidayState: vi.fn(() => ({ holidays: [] })),
}));

describe("MarketTicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isMarketClosedToday).mockReturnValue(false);
    // Reset mock to enabled by default
    mockMarketTickerEnabled = true;
    setupBrowserMocks();
  });

  afterEach(() => {
    cleanup();
  });

  const mockTickerData = {
    tickers: {
      "^NSEI": {
        symbol: "^NSEI",
        name: "NIFTY 50",
        price: 22000,
        change: 150,
        change_percent: 0.68,
        is_positive: true,
      },
      "^NSEBANK": {
        symbol: "^NSEBANK",
        name: "BANKNIFTY",
        price: 45000,
        change: -200,
        change_percent: -0.44,
        is_positive: false,
      },
    },
    last_updated: "2025-06-15T10:30:00Z",
    loading: false,
    error: null,
  };

  it("renders ticker container", () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockTickerData,
    });

    render(
      <UIProvider>
        <MarketTicker />
      </UIProvider>,
    );

    expect(screen.getByTestId("market-ticker")).toBeInTheDocument();
  });

  it("fetches ticker data on mount", () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockTickerData,
    });

    render(
      <UIProvider>
        <MarketTicker />
      </UIProvider>,
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining("market-ticker"), {
      priority: "low",
    });
  });

  it("displays ticker items after loading", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockTickerData,
    });

    render(
      <UIProvider>
        <MarketTicker />
      </UIProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("ticker-nsei")).toBeInTheDocument();
      expect(screen.getByTestId("ticker-nsebank")).toBeInTheDocument();
    });
  });

  it("shows a positive change as plain coloured text", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockTickerData,
    });

    render(
      <UIProvider>
        <MarketTicker />
      </UIProvider>,
    );

    await waitFor(() => {
      // change=150 formatted as "+150.00 (0.68%)"
      const change = screen.getByTestId("ticker-change-nsei");
      expect(change).toHaveTextContent("+150.00 (0.68%)");
      expect(change).toHaveStyle({ color: "#3FB950" });
      expect(change).toHaveTextContent("▲");
    });
  });

  it("shows a negative change as plain coloured text", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockTickerData,
    });

    render(
      <UIProvider>
        <MarketTicker />
      </UIProvider>,
    );

    await waitFor(() => {
      // change=-200 formatted as "-200.00 (-0.44%)"
      expect(screen.getByTestId("ticker-change-nsebank")).toHaveTextContent(
        "-200.00 (-0.44%)",
      );
    });
  });

  it("keeps price and change in one grid row with no pill badge", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockTickerData,
    });

    render(
      <UIProvider>
        <MarketTicker />
      </UIProvider>,
    );

    const item = await screen.findByTestId("ticker-nsei");
    const price = screen.getByTestId("ticker-price-nsei");
    const change = screen.getByTestId("ticker-change-nsei");
    // One shared grid row: price and change are the only cells after the label.
    expect(item.contains(price)).toBe(true);
    expect(item.contains(change)).toBe(true);
    expect(item.children).toHaveLength(3);
    expect(item.style.display).toBe("grid");
    // The old MUI Badge pill is gone — the change is plain text.
    expect(item.querySelector(".MuiBadge-root")).toBeNull();
  });

  it("displays loading state with skeletons", () => {
    mockFetch.mockImplementationOnce(() => new Promise((resolve) => setTimeout(resolve, 1000)));

    render(
      <UIProvider>
        <MarketTicker />
      </UIProvider>,
    );

    const container = screen.getByTestId("market-ticker");
    expect(container).toHaveClass("market-ticker-loading");
  });

  it("handles fetch error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    render(
      <UIProvider>
        <MarketTicker />
      </UIProvider>,
    );

    await waitFor(() => {
      const container = screen.getByTestId("market-ticker");
      expect(container).toHaveClass("market-ticker-error");
    });

    expect(screen.getByText("Market data unavailable")).toBeInTheDocument();
  });

  it("displays custom labels for known symbols", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockTickerData,
    });

    render(
      <UIProvider>
        <MarketTicker />
      </UIProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("Nifty 50")).toBeInTheDocument();
      expect(screen.getByText("Bank Nifty")).toBeInTheDocument();
    });
  });

  it("falls back to symbol for unknown tickers", async () => {
    const dataWithUnknown = {
      tickers: {
        UNKNOWN: {
          symbol: "UNKNOWN",
          name: "Unknown Ticker",
          price: 100,
          change: 1,
          change_percent: 1.0,
          is_positive: true,
        },
      },
      last_updated: "2025-06-15T10:30:00Z",
      loading: false,
      error: null,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => dataWithUnknown,
    });

    render(
      <UIProvider>
        <MarketTicker />
      </UIProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("UNKNOWN")).toBeInTheDocument();
    });
  });

  it("shows last updated time on the ticker tooltip", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockTickerData,
    });

    render(
      <UIProvider>
        <MarketTicker />
      </UIProvider>,
    );

    await waitFor(() => {
      const ticker = screen.getByTestId("market-ticker");
      // The visible "Updated: --" label is gone; the timestamp moved to the
      // ticker's title so the tape stays one 22px row.
      expect(ticker).toHaveAttribute("title", expect.stringContaining("Updated:"));
      expect(within(ticker).queryByText(/Updated:/)).not.toBeInTheDocument();
    });
  });

  it("orders tickers by priority", async () => {
    const priorityData = {
      tickers: {
        "SI=F": {
          symbol: "SI=F",
          name: "Silver",
          price: 25,
          change: 0.5,
          change_percent: 2.0,
          is_positive: true,
        },
        "^NSEI": {
          symbol: "^NSEI",
          name: "NIFTY 50",
          price: 22000,
          change: 150,
          change_percent: 0.68,
          is_positive: true,
        },
        "^NSEBANK": {
          symbol: "^NSEBANK",
          name: "BANKNIFTY",
          price: 45000,
          change: -200,
          change_percent: -0.44,
          is_positive: false,
        },
        "GC=F": {
          symbol: "GC=F",
          name: "Gold",
          price: 1800,
          change: 10,
          change_percent: 0.56,
          is_positive: true,
        },
      },
      last_updated: null,
      loading: false,
      error: null,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => priorityData,
    });

    render(
      <UIProvider>
        <MarketTicker />
      </UIProvider>,
    );

    await waitFor(() => {
      // Check that ordered items are present
      expect(screen.getByTestId("ticker-nsei")).toBeInTheDocument();
      expect(screen.getByTestId("ticker-nsebank")).toBeInTheDocument();
      expect(screen.getByTestId("ticker-gcf")).toBeInTheDocument();
      expect(screen.getByTestId("ticker-sif")).toBeInTheDocument();
    });
  });

  it("polls every 5 minutes", async () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockTickerData,
    });

    render(
      <UIProvider>
        <MarketTicker />
      </UIProvider>,
    );

    // Wait for initial fetch
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    // Verify setInterval was called with 300000 ms (5 minutes)
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 300000);

    setIntervalSpy.mockRestore();
  });

  it("renders every ticker at one uniform size so the columns align", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tickers: {
          "^NSEI": {
            symbol: "^NSEI",
            name: "NIFTY 50",
            price: 22000,
            change: 150,
            change_percent: 0.68,
            is_positive: true,
          },
          "GC=F": {
            symbol: "GC=F",
            name: "Gold",
            price: 1800,
            change: 10,
            change_percent: 0.56,
            is_positive: true,
          },
        },
        last_updated: "2025-06-15T10:30:00Z",
        loading: false,
        error: null,
      }),
    });

    render(
      <UIProvider>
        <MarketTicker />
      </UIProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("ticker-nsei")).toBeInTheDocument();
      expect(screen.getByTestId("ticker-gcf")).toBeInTheDocument();
    });

    // One type scale for every item: 9.5px label, 11px tabular price.
    for (const testId of ["ticker-nsei", "ticker-gcf"]) {
      const item = screen.getByTestId(testId);
      expect(item.children).toHaveLength(3);
      expect(item.style.gridTemplateColumns).toBe(
        "minmax(56px, auto) minmax(64px, 1fr) 82px",
      );
      expect(within(item).getByText(/Nifty 50|Gold/)).toHaveStyle({
        fontSize: "9.5px",
      });
    }
    expect(screen.getByTestId("ticker-price-nsei")).toHaveStyle({
      fontSize: "11px",
    });
    expect(screen.getByTestId("ticker-price-gcf")).toHaveStyle({
      fontSize: "11px",
    });
  });

  it("shows market-closed status instead of a tape on holidays", () => {
    vi.mocked(isMarketClosedToday).mockReturnValue(true);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    vi.mocked(getHolidayState).mockReturnValue({
      holidays: [{ date: today, description: "Dussehra", type: "trading" }],
      tradingDates: new Set<string>([today]),
      clearingDates: new Set<string>(),
      loaded: true,
      loading: false,
    });

    render(
      <UIProvider>
        <MarketTicker />
      </UIProvider>,
    );

    expect(screen.getByTestId("market-ticker-status")).toBeInTheDocument();
    expect(screen.getByText("Market closed")).toBeInTheDocument();
    expect(screen.getByText(/Dussehra/)).toBeInTheDocument();
    expect(screen.queryByTestId("market-ticker-loading")).not.toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns null when disabled", () => {
    // Set mock to disabled
    mockMarketTickerEnabled = false;

    render(
      <UIProvider>
        <MarketTicker />
      </UIProvider>,
    );

    // Market ticker container should not be in the document
    expect(screen.queryByTestId("market-ticker")).not.toBeInTheDocument();
    // Fetch should not be called when disabled
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
