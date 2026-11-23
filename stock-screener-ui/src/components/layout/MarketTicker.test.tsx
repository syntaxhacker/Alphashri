// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup, waitFor } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { MarketTicker, MarketStatus } from "./MarketTicker";
import { UIProvider } from "@/ui";
import * as palette from "@/ui/palette";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";
import { fetchHolidays } from "../../api/holidays_api";
import { loadHolidays, resetHolidays } from "../../state/holidays";

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Pin both clocks to the test instant, but keep the real IST boundary maths,
// holiday lookup and E2E override. `isMarketClosedToday` is deliberately kept
// holiday-only: the fixed-time regressions must fail while the ticker calls it.
const clock = vi.hoisted(() => ({
  now: new Date("2026-11-16T05:30:00Z"), // Monday 11:00 IST
}));

vi.mock("../../api/holidays_api", () => ({
  fetchHolidays: vi.fn(async () => []),
  fetchHolidayCheck: vi.fn(),
}));

vi.mock("../../state/holidays", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../state/holidays")>();
  const istDate = (now: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
  return {
    ...actual,
    isMarketClosedToday: () => actual.isTradingHoliday(istDate(clock.now)),
    isMarketOpenNow: (now?: Date) => actual.isMarketOpenNow(now ?? clock.now),
  };
});

function setClock(utcIso: string) {
  clock.now = new Date(utcIso);
}

/** Pin `new Date()` without faking timers, so waitFor/setInterval still run. */
function freezeDate() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(clock.now);
}

async function setHoliday(date: string, description: string) {
  vi.mocked(fetchHolidays).mockResolvedValueOnce([
    { date, description, type: "trading" },
  ]);
  resetHolidays();
  await loadHolidays();
  freezeDate(); // findTodayHoliday() derives the date from `new Date()`
}

describe("MarketTicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetHolidays();
    setClock("2026-11-16T05:30:00Z"); // Monday 11:00 IST — open
    delete (window as any).__E2E_MOCK_MARKET_OPEN__;
    vi.mocked(fetchHolidays).mockResolvedValue([]);
    // Component reads the enabled flag straight from localStorage (v2 key)
    localStorage.clear();
    setupBrowserMocks();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
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

    render(() => (<UIProvider>
        <MarketTicker />
      </UIProvider>),
    );

    expect(screen.getByTestId("market-ticker")).toBeInTheDocument();
  });

  it("fetches ticker data on mount", () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockTickerData,
    });

    render(() => (<UIProvider>
        <MarketTicker />
      </UIProvider>),
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

    render(() => (<UIProvider>
        <MarketTicker />
      </UIProvider>),
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

    render(() => (<UIProvider>
        <MarketTicker />
      </UIProvider>),
    );

    await waitFor(() => {
      // change=150 formatted as "+150.00 (0.68%)"
      const change = screen.getByTestId("ticker-change-nsei");
      expect(change).toHaveTextContent("+150.00 (0.68%)");
      expect(change).toHaveStyle({ color: palette.POSITIVE_COLOR });
      expect(change).toHaveTextContent("▲");
    });
  });

  it("shows a negative change as plain coloured text", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockTickerData,
    });

    render(() => (<UIProvider>
        <MarketTicker />
      </UIProvider>),
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

    render(() => (<UIProvider>
        <MarketTicker />
      </UIProvider>),
    );

    const item = await screen.findByTestId("ticker-nsei");
    const price = screen.getByTestId("ticker-price-nsei");
    const change = screen.getByTestId("ticker-change-nsei");
    // One shared grid row: price and change are the only cells after the label.
    expect(item.contains(price)).toBe(true);
    expect(item.contains(change)).toBe(true);
    expect(item.children).toHaveLength(3);
    expect(item.style.display).toBe("grid");
    // The old pill treatment is gone — the change is plain text in the grid row.
    expect(change).toHaveTextContent(/[-+]\d+\.\d+ \(/);
  });

  it("displays loading state with skeletons", () => {
    mockFetch.mockImplementationOnce(() => new Promise((resolve) => setTimeout(resolve, 1000)));

    render(() => (<UIProvider>
        <MarketTicker />
      </UIProvider>),
    );

    const container = screen.getByTestId("market-ticker");
    expect(container).toHaveClass("market-ticker-loading");
  });

  it("handles fetch error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    render(() => (<UIProvider>
        <MarketTicker />
      </UIProvider>),
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

    render(() => (<UIProvider>
        <MarketTicker />
      </UIProvider>),
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

    render(() => (<UIProvider>
        <MarketTicker />
      </UIProvider>),
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

    render(() => (<UIProvider>
        <MarketTicker />
      </UIProvider>),
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

    render(() => (<UIProvider>
        <MarketTicker />
      </UIProvider>),
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

    render(() => (<UIProvider>
        <MarketTicker />
      </UIProvider>),
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

    render(() => (<UIProvider>
        <MarketTicker />
      </UIProvider>),
    );

    await waitFor(() => {
      expect(screen.getByTestId("ticker-nsei")).toBeInTheDocument();
      expect(screen.getByTestId("ticker-gcf")).toBeInTheDocument();
    });

    // One type scale for every item: 11px label and 11px tabular price.
    for (const testId of ["ticker-nsei", "ticker-gcf"]) {
      const item = screen.getByTestId(testId);
      expect(item.children).toHaveLength(3);
      expect(item.style.getPropertyValue("grid-template-columns")).toBe(
        "minmax(56px, auto) minmax(64px, 1fr) 128px",
      );
      expect(within(item).getByText(/Nifty 50|Gold/)).toHaveStyle({
        fontSize: "12px",
      });
    }
    expect(screen.getByTestId("ticker-price-nsei")).toHaveStyle({
      fontSize: "12px",
    });
    expect(screen.getByTestId("ticker-price-gcf")).toHaveStyle({
      fontSize: "12px",
    });
  });

  it("shows market-closed status instead of a tape on holidays", async () => {
    setClock("2026-01-26T05:30:00Z"); // Republic Day, Monday 11:00 IST
    await setHoliday("2026-01-26", "Republic Day");

    render(() => (<UIProvider>
        <MarketTicker />
      </UIProvider>),
    );

    expect(screen.getByTestId("market-ticker-status")).toBeInTheDocument();
    expect(screen.getByText("Market closed")).toBeInTheDocument();
    expect(screen.getByText(/Republic Day/)).toBeInTheDocument();
    expect(screen.queryByTestId("market-ticker-loading")).not.toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();

    const detail = screen.getByTestId("market-ticker-status").querySelector("p:last-child") as HTMLElement;
    expect(detail).toHaveAttribute("title", "· Republic Day");
    expect(detail).toHaveClass("break-words", "line-clamp-2");
  });

  it("returns null when disabled", () => {
    localStorage.setItem("alphashri_show_market_ticker_v2", "false");

    render(() => (<UIProvider>
        <MarketTicker />
      </UIProvider>),
    );

    // Market ticker container should not be in the document
    expect(screen.queryByTestId("market-ticker")).not.toBeInTheDocument();
    // Fetch should not be called when disabled
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("tape variant renders nothing when the market is closed", () => {
    // The sidebar owns the closed status; the main column must not reserve a
    // 22px strip for a tape that has nothing to show.
    setClock("2026-11-16T11:41:00Z"); // Monday 17:11 IST — after the close
    render(() => (<UIProvider>
        <MarketTicker variant="tape" />
      </UIProvider>),
    );
    expect(screen.queryByTestId("market-ticker")).not.toBeInTheDocument();
    expect(screen.queryByTestId("market-ticker-status")).not.toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("tape variant renders the tape when the market is open", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        tickers: {
          "^NSEI": { symbol: "^NSEI", name: "Nifty 50", price: 25000, change: 12, change_percent: 0.05, is_positive: true },
        },
        last_updated: new Date().toISOString(),
        loading: false,
        error: null,
      }),
    });

    render(() => (<UIProvider>
        <MarketTicker variant="tape" />
      </UIProvider>),
    );

    // Wait for the fetched tape items, not just the loading shell: the loading
    // node is replaced on the state update, so a plain element handle goes stale.
    expect(await screen.findByTestId("ticker-nsei")).toBeInTheDocument();
  });
});

describe("MarketStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetHolidays();
    setClock("2026-11-16T05:30:00Z"); // Monday 11:00 IST — open
    delete (window as any).__E2E_MOCK_MARKET_OPEN__;
    vi.mocked(fetchHolidays).mockResolvedValue([]);
    setupBrowserMocks();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("states the market is closed (dot + label) without a tape", () => {
    setClock("2026-11-16T11:41:00Z"); // Monday 17:11 IST — after the close
    render(() => (<UIProvider>
        <MarketStatus />
      </UIProvider>),
    );
    expect(screen.getByTestId("app-market-status")).toBeInTheDocument();
    expect(screen.getByTestId("app-market-status-dot")).toBeInTheDocument();
    expect(screen.getByText("Market closed")).toBeInTheDocument();
  });

  it("clamps the closed-session detail at a word boundary with a full title", () => {
    setClock("2026-11-16T11:41:00Z"); // Monday 17:11 IST — after the close
    render(() => (<UIProvider>
        <MarketStatus />
      </UIProvider>),
    );

    const detail = screen.getByTestId("app-market-status").querySelector("p:last-child") as HTMLElement;
    const full = "· Closed at 15:30 IST · Opens 09:15 IST";
    expect(detail).toHaveTextContent(full);
    expect(detail).toHaveAttribute("title", full);
    // Two-line clamp breaks between words; the ellipsis never cuts a word.
    expect(detail).toHaveClass("break-words", "line-clamp-2");
  });

  it("hides the label but keeps the dot when compact (collapsed rail)", () => {
    setClock("2026-11-16T11:41:00Z"); // Monday 17:11 IST — after the close
    render(() => (<UIProvider>
        <MarketStatus compact />
      </UIProvider>),
    );
    expect(screen.getByTestId("app-market-status-dot")).toBeInTheDocument();
    expect(screen.queryByText("Market closed")).not.toBeInTheDocument();
    expect(screen.getByTestId("app-market-status").getAttribute("title")).toContain("Market closed");
  });

  it("reports a live market during trading hours", () => {
    render(() => (<UIProvider>
        <MarketStatus />
      </UIProvider>),
    );
    expect(screen.getByText("Market live")).toBeInTheDocument();
  });
});

// Fixed-instant regression cases: the old holiday-only check happily said
// "Market live" on every ordinary weekday, including three hours after close.
describe("MarketStatus — real IST session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetHolidays();
    setClock("2026-11-16T05:30:00Z"); // Monday 11:00 IST
    delete (window as any).__E2E_MOCK_MARKET_OPEN__;
    vi.mocked(fetchHolidays).mockResolvedValue([]);
    setupBrowserMocks();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const renderStatus = () => render(() => (<UIProvider><MarketStatus /></UIProvider>));

  it("17:11 IST on a trading weekday is closed, with the session boundary in the tooltip", () => {
    setClock("2026-11-16T11:41:00Z"); // Monday 17:11 IST
    renderStatus();
    expect(screen.getByText("Market closed")).toBeInTheDocument();
    expect(screen.getByTestId("app-market-status")).toHaveAttribute(
      "title",
      expect.stringContaining("Closed at 15:30 IST"),
    );
  });

  it("11:00 IST on a trading weekday is live", () => {
    setClock("2026-11-16T05:30:00Z");
    renderStatus();
    expect(screen.getByText("Market live")).toBeInTheDocument();
  });

  it("09:14 IST is closed and says when the session opens", () => {
    setClock("2026-11-16T03:44:00Z"); // Monday 09:14 IST
    renderStatus();
    expect(screen.getByText("Market closed")).toBeInTheDocument();
    expect(screen.getByTestId("app-market-status")).toHaveAttribute(
      "title",
      expect.stringContaining("Opens 09:15 IST"),
    );
  });

  it("09:15 IST is live", () => {
    setClock("2026-11-16T03:45:00Z"); // Monday 09:15 IST
    renderStatus();
    expect(screen.getByText("Market live")).toBeInTheDocument();
  });

  it("15:30 IST is closed (the close is exclusive)", () => {
    setClock("2026-11-16T10:00:00Z"); // Monday 15:30 IST
    renderStatus();
    expect(screen.getByText("Market closed")).toBeInTheDocument();
  });

  it("a holiday at 11:00 IST stays closed and keeps the holiday reason", async () => {
    setClock("2026-01-26T05:30:00Z"); // Republic Day, Monday 11:00 IST
    await setHoliday("2026-01-26", "Republic Day");
    renderStatus();
    expect(screen.getByText("Market closed")).toBeInTheDocument();
    expect(screen.getByTestId("app-market-status")).toHaveAttribute(
      "title",
      expect.stringContaining("Republic Day"),
    );
  });

  it("__E2E_MOCK_MARKET_OPEN__ forces live even at 17:11 IST", () => {
    setClock("2026-11-16T11:41:00Z");
    (window as any).__E2E_MOCK_MARKET_OPEN__ = true;
    renderStatus();
    expect(screen.getByText("Market live")).toBeInTheDocument();
    delete (window as any).__E2E_MOCK_MARKET_OPEN__;
  });

  it("does not fetch a tape at 17:11 IST", () => {
    setClock("2026-11-16T11:41:00Z");
    render(() => (<UIProvider><MarketTicker /></UIProvider>));
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
