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
      // The compact tile shows the signed percent; the full "+150.00 (0.68%)"
      // stays in the tooltip so no information is lost.
      const change = screen.getByTestId("ticker-change-nsei");
      expect(change).toHaveTextContent("+0.68%");
      expect(change).toHaveAttribute("title", "+150.00 (0.68%)");
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
      expect(screen.getByTestId("ticker-change-nsebank")).toHaveTextContent("-0.44%");
      expect(screen.getByTestId("ticker-change-nsebank")).toHaveAttribute(
        "title",
        "-200.00 (-0.44%)",
      );
    });
  });

  it("keeps label, price and change in one compact grid with no pill badge", async () => {
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
    expect(item.contains(price)).toBe(true);
    expect(item.contains(change)).toBe(true);
    expect(item.children).toHaveLength(3);
    expect(item.style.display).toBe("grid");
    expect(item.style.getPropertyValue("grid-template-rows")).toBe("auto auto auto");
    // The old pill treatment is gone — the change is plain coloured text.
    expect(change).toHaveTextContent(/[-+]\d+\.\d+%$/);
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

  it("displays canonical index labels from the shared feed descriptor", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockTickerData,
    });

    render(() => (<UIProvider>
        <MarketTicker />
      </UIProvider>),
    );

    await waitFor(() => {
      expect(within(screen.getByTestId("ticker-nsei")).getByText("NIFTY")).toBeInTheDocument();
      expect(within(screen.getByTestId("ticker-nsebank")).getByText("BANKNIFTY")).toBeInTheDocument();
      expect(screen.queryByText("Nifty 50")).not.toBeInTheDocument();
      expect(screen.queryByText("Bank Nifty")).not.toBeInTheDocument();
    });
  });

  it("keeps the raw feed key as the item identity for API calls and test ids", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockTickerData,
    });

    render(() => (<UIProvider>
        <MarketTicker />
      </UIProvider>),
    );

    expect(await screen.findByTestId("ticker-nsei")).toBeInTheDocument();
    expect(screen.getByTestId("ticker-nsebank")).toBeInTheDocument();
    expect(Object.keys(mockTickerData.tickers)).toEqual(["^NSEI", "^NSEBANK"]);
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining("market-ticker"), {
      priority: "low",
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

  it("renders every ticker with one content-sized compact grid and no fixed change track", async () => {
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

    // One type scale and one content-sized grid for every item: a fixed
    // 128px change track made a single tile ~260px wide in a 148px rail.
    for (const testId of ["ticker-nsei", "ticker-gcf"]) {
      const item = screen.getByTestId(testId);
      expect(item.children).toHaveLength(3);
      expect(item.style.getPropertyValue("grid-template-columns")).toBe("max-content");
      expect(item.style.getPropertyValue("grid-template-rows")).toBe("auto auto auto");
      expect(item.style.getPropertyValue("grid-template-columns")).not.toContain("128px");
      expect(within(item).getByText(/NIFTY|Gold/)).toHaveStyle({
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

  it("shares the closed/live state vocabulary with the report toolbar", () => {
    setClock("2026-11-16T11:41:00Z"); // Monday 17:11 IST — after the close
    render(() => (<UIProvider>
        <MarketStatus />
      </UIProvider>),
    );
    const status = screen.getByTestId("app-market-status");
    expect(status).toHaveAttribute("data-state", "closed");
    expect(status).toHaveTextContent("Market closed");
    expect(status).not.toHaveTextContent("Market live");
  });

  it("marks an open session with the live state", () => {
    render(() => (<UIProvider>
        <MarketStatus />
      </UIProvider>),
    );
    const status = screen.getByTestId("app-market-status");
    expect(status).toHaveAttribute("data-state", "live");
    expect(status).toHaveTextContent("Market live");
  });

  it("gives the closed-session detail a full-width row that wraps at word boundaries with a full title", () => {
    setClock("2026-11-16T11:41:00Z"); // Monday 17:11 IST — after the close
    render(() => (<UIProvider>
        <MarketStatus />
      </UIProvider>),
    );

    const root = screen.getByTestId("app-market-status");
    const headline = screen.getByTestId("app-market-status-headline");
    const detail = screen.getByTestId("app-market-status-detail");
    const full = "· Closed at 15:30 IST · Opens 09:15 IST";
    expect(detail).toHaveTextContent(full);
    expect(detail).toHaveAttribute("title", full);
    // The detail owns a full-width row instead of being squeezed next to the
    // nowrap label, so it wraps at whitespace and no word is cut mid-token.
    expect(root).toHaveClass("flex", "flex-col", "min-w-0", "w-full");
    expect(detail).toHaveClass("w-full", "min-w-0", "break-words", "line-clamp-2");
    expect(root).toContainElement(detail);
    expect(headline).toContainElement(screen.getByTestId("app-market-status-dot"));
    expect(headline).toHaveTextContent("Market closed");
    expect(headline).not.toContainElement(detail);
  });

  it("hides the label but keeps the dot when compact (collapsed rail)", () => {
    setClock("2026-11-16T11:41:00Z"); // Monday 17:11 IST — after the close
    render(() => (<UIProvider>
        <MarketStatus compact />
      </UIProvider>),
    );
    expect(screen.getByTestId("app-market-status-dot")).toBeInTheDocument();
    expect(screen.queryByText("Market closed")).not.toBeInTheDocument();
    expect(screen.queryByTestId("app-market-status-detail")).not.toBeInTheDocument();
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

describe("MarketTicker — responsive rail fit (390px drawer / 1600px sidebar)", () => {
  const tapeData = {
    tickers: {
      "^NSEI": {
        symbol: "^NSEI", name: "NIFTY 50", price: 22000,
        change: 150, change_percent: 0.68, is_positive: true,
      },
      "^NSEBANK": {
        symbol: "^NSEBANK", name: "BANKNIFTY", price: 45000,
        change: -200, change_percent: -0.44, is_positive: false,
      },
    },
    last_updated: "2025-06-15T10:30:00Z",
    loading: false,
    error: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetHolidays();
    setClock("2026-11-16T05:30:00Z"); // Monday 11:00 IST — open
    delete (window as any).__E2E_MOCK_MARKET_OPEN__;
    vi.mocked(fetchHolidays).mockResolvedValue([]);
    localStorage.clear();
    setupBrowserMocks();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const renderTape = async (mobile = false) => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => tapeData });
    render(() => (<UIProvider><MarketTicker variant="tape" mobile={mobile} /></UIProvider>));
    await screen.findByTestId("ticker-nsei");
    await screen.findByTestId("ticker-nsebank");
    return screen.getByTestId("market-ticker");
  };

  const setRailGeometry = (container: HTMLElement, clientWidth: number, scrollWidth = clientWidth * 3) => {
    Object.defineProperty(container, "clientWidth", { configurable: true, value: clientWidth });
    Object.defineProperty(container, "scrollWidth", { configurable: true, value: scrollWidth });
  };

  const rect = (top: number, bottom: number, left: number, right: number): DOMRect => ({
    top, bottom, left, right,
    width: right - left, height: bottom - top, x: left, y: top,
    toJSON: () => ({}),
  }) as DOMRect;

  const intersects = (a: DOMRect, b: DOMRect) =>
    a.top < b.top + b.height && a.top + a.height > b.top &&
    a.left < b.left + b.width && a.left + a.width > b.left;

  it("390: the tape band matches evidence and clears the toolbar", async () => {
    await renderTape(true);
    const spacer = screen.getByTestId("market-ticker-top-spacer");
    expect(spacer).toHaveStyle({ height: "104px", "min-width": "0px" });
    const frame = screen.getByTestId("market-ticker-frame");
    expect(frame.contains(spacer)).toBe(false);
    expect(frame).toHaveStyle({ "background-color": palette.BG });

    // Measured on first drawer open: x8–168 y168.39–224.39. The pulse
    // (y88–174) and catalyst band (y182–542) cannot be out-spaced, so Home
    // removes them via the shared drawer-open signal (see HomePage.test).
    const frameTop = 64.39 + Number.parseFloat(spacer.style.height);
    const frameRect = rect(frameTop, frameTop + 56, 8, 168);
    const toolbarRect = rect(60, 80, 16, 374);

    expect(frameRect.top).toBeCloseTo(168.39);
    expect(frameRect.bottom).toBeCloseTo(224.39);
    expect(intersects(frameRect, toolbarRect)).toBe(false);
    expect(frameRect.bottom).toBeLessThanOrEqual(844);
  });

  it("390: the tape is the only scroll owner and no numeric value is clipped", async () => {
    const container = await renderTape(true);
    const frame = screen.getByTestId("market-ticker-frame");
    expect(frame).toHaveStyle({
      width: "100%",
      "min-width": "0px",
      "box-sizing": "border-box",
      "flex-shrink": "0",
      overflow: "hidden",
    });
    expect(container).toHaveStyle({
      "overflow-x": "auto",
      "overflow-y": "hidden",
      "flex-wrap": "nowrap",
      "min-width": "0px",
      "box-sizing": "border-box",
      width: "100%",
    });
    expect(Number.parseFloat(container.style.paddingLeft || "0")).toBeLessThanOrEqual(2);
    expect(Number.parseFloat(container.style.paddingRight || "0")).toBeLessThanOrEqual(2);
    const nestedScrollOwners = Array.from(container.querySelectorAll<HTMLElement>("*")).filter(
      (el) => /^(auto|scroll)$/.test(el.style.overflowX),
    );
    expect(nestedScrollOwners).toEqual([]);

    for (const id of ["ticker-nsei", "ticker-nsebank"]) {
      const item = screen.getByTestId(id);
      expect(item.style.getPropertyValue("grid-template-columns")).toBe("max-content");
      expect(item.style.getPropertyValue("grid-template-rows")).toBe("auto auto auto");
      expect(item.style.getPropertyValue("grid-template-columns")).not.toContain("128px");
    }
    expect(within(screen.getByTestId("ticker-nsei")).getByText("NIFTY")).toBeInTheDocument();
    expect(within(screen.getByTestId("ticker-nsebank")).getByText("BANKNIFTY")).toBeInTheDocument();
    expect(screen.getByTestId("ticker-price-nsebank")).toHaveTextContent("45,000.00");
    expect(screen.getByTestId("ticker-change-nsei").className).not.toContain("overflow-hidden");
  });

  it("390: an overflowing tape shows the cue on first open, before any resize", async () => {
    const observed: Element[] = [];
    class CapturingResizeObserver {
      observe(el: Element) { observed.push(el); }
      disconnect() {}
    }
    global.ResizeObserver = CapturingResizeObserver as any;

    const container = await renderTape(true);
    setRailGeometry(container, 124, 582);
    // Deliberately no resize event: the drawer was hidden at mount.
    expect(screen.getByTestId("market-ticker-scroll-cue")).toBeVisible();
    expect(observed).toContain(container);
  });

  it("1600: NIFTY and BANKNIFTY both fit fully in the rail — no cut 'BA'", async () => {
    const container = await renderTape(false);
    const nifty = screen.getByTestId("ticker-nsei");
    const bank = screen.getByTestId("ticker-nsebank");

    // The compact tile puts label / price / change on their own rows so its
    // width is the widest single field (~65px), not label+price (~136px).
    expect(nifty.style.getPropertyValue("grid-template-rows")).toBe("auto auto auto");
    expect(bank.style.getPropertyValue("grid-template-rows")).toBe("auto auto auto");
    const tileWidth = Number.parseFloat(bank.style.width);
    const gap = Number.parseFloat(container.style.gap || "0");
    const padding =
      Number.parseFloat(container.style.paddingLeft || "0") +
      Number.parseFloat(container.style.paddingRight || "0");
    expect(tileWidth).toBeGreaterThan(0);
    expect(tileWidth).toBeLessThanOrEqual(72);

    // 148px rail − 4px tape padding = 144px visible scroller. Two compact
    // tiles + one gap must fit inside it, so the full BANKNIFTY label and
    // price are on screen at first paint (not just reachable via the cue).
    const CLIENT_WIDTH = 144;
    expect(2 * tileWidth + gap + padding).toBeLessThanOrEqual(CLIENT_WIDTH);

    // Content-sized fields: no internal clipping (scrollWidth <= clientWidth).
    // At 12px a 9-character mono field is ~65px — inside the compact tile.
    const price = screen.getByTestId("ticker-price-nsebank");
    const change = screen.getByTestId("ticker-change-nsebank");
    const contentWidth = (text: string) => text.length * 7.2;
    for (const [el, text] of [[price, "45,000.00"], [change, "-0.44%"]] as const) {
      expect(
        el.style.whiteSpace === "nowrap" || el.classList.contains("whitespace-nowrap"),
      ).toBe(true);
      expect(el.style.overflow).not.toBe("hidden");
      Object.defineProperty(el, "scrollWidth", { configurable: true, value: contentWidth(text) });
      Object.defineProperty(el, "clientWidth", { configurable: true, value: tileWidth });
      expect(el.scrollWidth).toBeLessThanOrEqual(el.clientWidth);
    }

    // Visible text is the full canonical label and the full price value.
    expect(within(bank).getByText("BANKNIFTY")).toBeInTheDocument();
    expect(price).toHaveTextContent("45,000.00");
    expect(change).toHaveTextContent("-0.44%");
    expect(change).toHaveAttribute("title", "-200.00 (-0.44%)");

    // The tape is still the single scroll owner for the overflowing drawer.
    setRailGeometry(container, 124, 582);
    expect(screen.getByTestId("market-ticker-scroll-cue")).toBeVisible();
  });
});
