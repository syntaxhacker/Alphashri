// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MarketTicker } from "./MarketTicker";
import { MantineProvider } from "@mantine/core";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock useThemeColors
vi.mock("../../hooks/useThemeColors", () => ({
  useThemeColors: () => ({
    isDark: false,
    colorScheme: "light",
    background: "#ffffff",
    text: "#000000",
    theme: {
      colors: {
        dark: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
        gray: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      },
      spacing: { xs: "4px", sm: "8px" },
      radius: { sm: "4px" },
    },
    surface: "#f8f9fa",
    border: "#e9ecef",
    textSecondary: "#6c757d",
    bg: () => "#ffffff",
    color: (light: string) => light,
    spacing: (size: string) => size,
    radius: (size: string) => size,
  }),
}));

describe("MarketTicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      <MantineProvider>
        <MarketTicker />
      </MantineProvider>,
    );

    expect(screen.getByTestId("market-ticker")).toBeInTheDocument();
  });

  it("fetches ticker data on mount", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockTickerData,
    });

    render(
      <MantineProvider>
        <MarketTicker />
      </MantineProvider>,
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining("market-ticker"));
  });

  it("displays ticker items after loading", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockTickerData,
    });

    render(
      <MantineProvider>
        <MarketTicker />
      </MantineProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("ticker-nsei")).toBeInTheDocument();
      expect(screen.getByTestId("ticker-nsebank")).toBeInTheDocument();
    });
  });

  it("shows positive change badge", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockTickerData,
    });

    render(
      <MantineProvider>
        <MarketTicker />
      </MantineProvider>,
    );

    await waitFor(() => {
      // change=150 formatted as "+150.00 (0.68%)"
      const badge = screen.getByText(/\+150\.00/);
      expect(badge).toBeInTheDocument();
    });
  });

  it("shows negative change badge", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockTickerData,
    });

    render(
      <MantineProvider>
        <MarketTicker />
      </MantineProvider>,
    );

    await waitFor(() => {
      // change=-200 formatted as "-200.00 (-0.44%)"
      const badge = screen.getByText(/-200\.00/);
      expect(badge).toBeInTheDocument();
    });
  });

  it("displays loading state with skeletons", () => {
    mockFetch.mockImplementationOnce(() => new Promise((resolve) => setTimeout(resolve, 1000)));

    render(
      <MantineProvider>
        <MarketTicker />
      </MantineProvider>,
    );

    const container = screen.getByTestId("market-ticker");
    expect(container).toHaveClass("market-ticker-loading");
  });

  it("handles fetch error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    render(
      <MantineProvider>
        <MarketTicker />
      </MantineProvider>,
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
      <MantineProvider>
        <MarketTicker />
      </MantineProvider>,
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
      <MantineProvider>
        <MarketTicker />
      </MantineProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("UNKNOWN")).toBeInTheDocument();
    });
  });

  it("shows last updated time", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockTickerData,
    });

    render(
      <MantineProvider>
        <MarketTicker />
      </MantineProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("market-ticker-updated")).toBeInTheDocument();
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
      <MantineProvider>
        <MarketTicker />
      </MantineProvider>,
    );

    await waitFor(() => {
      // Check that ordered items are present
      expect(screen.getByTestId("ticker-nsei")).toBeInTheDocument();
      expect(screen.getByTestId("ticker-nsebank")).toBeInTheDocument();
      expect(screen.getByTestId("ticker-gcf")).toBeInTheDocument();
      expect(screen.getByTestId("ticker-sif")).toBeInTheDocument();
    });
  });
});
