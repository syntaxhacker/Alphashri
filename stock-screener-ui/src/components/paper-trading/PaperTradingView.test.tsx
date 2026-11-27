// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within, waitFor } from "@solidjs/testing-library";

const mockStateStore: any = {
  currentView: "live",
  positions: [],
  portfolio: null,
  trades: [],
  dailySummary: null,
  symbolPerformance: [],
  filterDate: null,
  filterFromDate: null,
  filterToDate: null,
  filterSymbol: null,
  filterStrategy: null,
  filterBot: null,
  selectedSymbol: null,
  selectedStrategyId: null,
  selectedStrategyTab: null,
  selectedTradeId: null,
  showAllTrades: false,
  showOrbLines: false,
  showPivotLines: false,
  show52wLines: false,
  showEmaLines: false,
  chartData: null,
  chartLoading: false,
  chartTimeframe: "5min",
  isLoading: false,
  error: null,
  autoRefreshEnabled: true,
  botRunning: false,
  botPid: null,
  botLogFile: null,
  botSnapshot: null,
  strategyConfig: null,
  configLoading: false,
  configError: null,
  configDirty: false,
  availableBots: [],
};

const initialMockState = { ...mockStateStore };
function resetMockStateStore() {
  Object.assign(mockStateStore, initialMockState);
}

vi.mock("../../state/paperTrading", () => ({
  getPaperTradingState: vi.fn(() => mockStateStore),
  subscribe: vi.fn(() => vi.fn()),
  setError: vi.fn(),
  setAvailableBots: vi.fn(),
  setSelectedSymbol: vi.fn(),
  setSelectedStrategyTab: vi.fn(),
  setSelectedTradeId: vi.fn(),
  setShowAllTrades: vi.fn(),
  setFilterBot: vi.fn(),
  setFilterStrategy: vi.fn(),
  setFilterFromDate: vi.fn(),
  setFilterToDate: vi.fn(),
  setPaperTradingView: vi.fn(),
}));

vi.mock("../../api/paperTrading", () => ({
  refreshLiveData: vi.fn().mockResolvedValue(undefined),
  initLiveAutoRefresh: vi.fn(),
  initBotAutoRefresh: vi.fn(),
  stopLiveAutoRefresh: vi.fn(),
  refreshBotLiveData: vi.fn().mockResolvedValue(undefined),
  listBots: vi.fn().mockResolvedValue([]),
  refreshHistoryData: vi.fn().mockResolvedValue(undefined),
  fetchStrategyConfig: vi.fn().mockResolvedValue({}),
  deleteTrade: vi.fn().mockResolvedValue(undefined),
  updateTradeNotes: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../api/botControlApi", () => ({
  fetchBotSummaries: vi.fn().mockResolvedValue([]),
}));

vi.mock("./LivePriceUpdater", () => ({
  LivePriceUpdater: () => <div data-testid="live-price-updater" />,
}));

vi.mock("./PaperPortfolioCard", () => ({
  PaperPortfolioCard: () => <div data-testid="paper-portfolio-card">Portfolio</div>,
}));

vi.mock("./PaperPositionsTable", () => ({
  PaperPositionsTable: () => <div data-testid="paper-positions-table">Positions</div>,
}));

vi.mock("./PaperChart", () => ({
  PaperChart: () => <div data-testid="paper-chart">Chart</div>,
}));

vi.mock("./PaperHistoryTable", () => ({
  PaperHistoryTable: () => <div data-testid="paper-history-table">History</div>,
}));

vi.mock("./PaperSettings", () => ({
  PaperSettings: () => <div data-testid="paper-settings">Settings</div>,
}));

vi.mock("@solidjs/router", () => ({
  useNavigate: vi.fn(() => vi.fn()),
  useLocation: vi.fn(() => ({ pathname: "/" })),
  useSearchParams: vi.fn(() => [new URLSearchParams(), vi.fn()]),
}));

vi.mock("../../hooks/useStoreSubscription", () => ({
  useStoreSubscription: vi.fn(),
}));

vi.mock("../common/BadgeComponents", () => ({
  StatusBadge: ({ running, pid }: any) => (
    <div data-testid="bot-status">{running ? `Running (PID ${pid})` : "Stopped"}</div>
  ),
}));

import { PaperTradingView } from "./PaperTradingView";

beforeEach(() => {
  resetMockStateStore();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function r() {
  return render(() => <PaperTradingView />);
}

describe("PaperTradingView", () => {
  describe("viewport shell", () => {
    test("keeps the route fixed and lets the live content scroll on a phone", () => {
      r();
      const shell = screen.getByTestId("paper-trading-view");
      expect(shell).toHaveClass("h-full", "min-h-0", "flex", "flex-col", "overflow-hidden");

      const live = screen.getByTestId("live-view-grid");
      expect(live).toHaveClass("overflow-y-auto");
      expect(live).toHaveClass("md:overflow-hidden");
    });

    test("settings content is a flex child scrollport, not an auto-height div", () => {
      mockStateStore.currentView = "settings";
      r();
      const scroller = document.querySelector(".paper-settings-scroll") as HTMLElement;
      expect(scroller).toHaveClass("flex-1");
      expect(scroller).toHaveClass("min-h-0");
    });
  });

  describe("error state", () => {
    test("renders error alert when state.error is set", () => {
      mockStateStore.error = "Something went wrong";
      r();
      expect(screen.getByTestId("paper-error")).toBeInTheDocument();
    });
  });

  describe("view switching", () => {
    test("History view displays history table and chart", () => {
      mockStateStore.currentView = "history";
      r();
      expect(screen.getByTestId("paper-history-panel")).toBeInTheDocument();
      expect(screen.getByTestId("paper-history-table")).toBeInTheDocument();
      expect(screen.getByTestId("paper-chart")).toBeInTheDocument();
    });

    test("Settings view displays settings panel", () => {
      mockStateStore.currentView = "settings";
      r();
      expect(screen.getByTestId("paper-settings-panel")).toBeInTheDocument();
      expect(screen.getByTestId("paper-settings")).toBeInTheDocument();
    });
  });

  describe("bot loading and selection", () => {
    test("loads bots and bot summaries on mount", async () => {
      const { listBots } = await import("../../api/paperTrading");
      const { fetchBotSummaries } = await import("../../api/botControlApi");

      r();

      await vi.waitFor(() => {
        expect(listBots).toHaveBeenCalled();
        expect(fetchBotSummaries).toHaveBeenCalled();
      });
    });

    test("refreshes bot live data when bots exist", async () => {
      const { listBots } = await import("../../api/paperTrading");
      (listBots as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "bot-1", name: "Bot 1" },
      ]);
      const { refreshBotLiveData } = await import("../../api/paperTrading");

      r();

      await vi.waitFor(() => {
        expect(refreshBotLiveData).toHaveBeenCalledWith("bot-1");
      });
    });

    test("starts bot auto-refresh when bots exist", async () => {
      const { listBots } = await import("../../api/paperTrading");
      (listBots as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "bot-1", name: "Bot 1" },
      ]);
      const { initBotAutoRefresh, initLiveAutoRefresh } = await import("../../api/paperTrading");

      r();

      await vi.waitFor(() => {
        expect(initBotAutoRefresh).toHaveBeenCalledWith("bot-1");
      });
      expect(initLiveAutoRefresh).not.toHaveBeenCalled();
    });

    test("falls back to refreshLiveData when no bots", async () => {
      const { listBots } = await import("../../api/paperTrading");
      (listBots as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const { refreshLiveData } = await import("../../api/paperTrading");

      r();

      await vi.waitFor(() => {
        expect(refreshLiveData).toHaveBeenCalled();
      });
    });

    test("starts live auto-refresh on a fresh load with no bots", async () => {
      const { listBots } = await import("../../api/paperTrading");
      (listBots as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const { initLiveAutoRefresh, refreshLiveData } = await import("../../api/paperTrading");

      r();

      await vi.waitFor(() => {
        expect(initLiveAutoRefresh).toHaveBeenCalled();
        expect(refreshLiveData).toHaveBeenCalled();
      });
    });
  });

  describe("error alert", () => {
    test("error alert close button clears error", async () => {
      mockStateStore.error = "Something went wrong";
      r();
      const alert = screen.getByTestId("paper-error");
      expect(alert).toBeInTheDocument();
      const closeBtn = within(alert).getByRole("button");
      await fireEvent.click(closeBtn);
      const { setError } = await import("../../state/paperTrading");
      expect(setError).toHaveBeenCalledWith(null);
    });
  });

  describe("cleanup on unmount", () => {
    test("cleanup stops auto-refresh on unmount", async () => {
      const { stopLiveAutoRefresh } = await import("../../api/paperTrading");
      const { unmount } = render(() => <PaperTradingView />);
      unmount();
      expect(stopLiveAutoRefresh).toHaveBeenCalled();
    });
  });

  describe("390px header", () => {
    async function stubWidth(width: number) {
      vi.stubGlobal("matchMedia", ((query: string) => {
        const max = /max-width:\s*(\d+)px/.exec(query);
        const matches = max ? width <= Number(max[1]) : false;
        return {
          matches,
          media: query,
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: vi.fn(),
        } as unknown as MediaQueryList;
      }) as unknown as typeof window.matchMedia);
      const { fetchBotSummaries } = await import("../../api/botControlApi");
      vi.mocked(fetchBotSummaries).mockResolvedValue([{
        id: "bot-1",
        name: "Test Bot",
        running: false,
        pid: null,
        is_active: true,
        live_trading: false,
        status: "stopped",
        position_count: 0,
        strategies: [],
      }]);
    }

    test("puts tabs and bot controls on separate rows", async () => {
      await stubWidth(390);
      r();
      const header = screen.getByTestId("paper-header");
      expect(header).toHaveClass("flex-col");
      const tabsRow = document.querySelector(".paper-header-tabs-row")!;
      const controlsRow = document.querySelector(".paper-header-controls-row")!;
      expect(tabsRow).toBeInTheDocument();
      expect(controlsRow).toBeInTheDocument();
      expect(tabsRow.querySelector('[data-testid="paper-trading-tabs"]')).toBeInTheDocument();
      expect(controlsRow.querySelector('[data-testid="paper-filters"]')).toBeInTheDocument();
      expect(tabsRow.contains(controlsRow)).toBe(false);
      await waitFor(() => expect(screen.getByTestId("bot-selector")).toBeInTheDocument());
    });

    test("keeps the single clipped row on desktop", async () => {
      await stubWidth(1600);
      r();
      const header = screen.getByTestId("paper-header");
      expect(header).not.toHaveClass("flex-col");
      expect(document.querySelector(".paper-header-tabs-row")).toBeNull();
      expect(header.querySelector('[data-testid="paper-trading-tabs"]')).toBeInTheDocument();
      expect(header.querySelector('[data-testid="paper-filters"]')).toBeInTheDocument();
    });
  });
});
