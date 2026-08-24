// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, within } from "@testing-library/react";
import { renderWithMantine } from "../../test-utils/renderWithMantine";

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

vi.mock("./PaperPositionsTable2", () => ({
  PaperPositionsTable: () => <div data-testid="paper-positions-table">Positions</div>,
}));

vi.mock("./PaperChart2", () => ({
  PaperChart: () => <div data-testid="paper-chart">Chart</div>,
}));

vi.mock("./PaperHistoryTable2", () => ({
  PaperHistoryTable: () => <div data-testid="paper-history-table">History</div>,
}));

vi.mock("./PaperSettings", () => ({
  PaperSettings: () => <div data-testid="paper-settings">Settings</div>,
}));

vi.mock("react-router-dom", () => ({
  useNavigate: vi.fn(() => vi.fn()),
  useLocation: vi.fn(() => ({ pathname: "/" })),
}));

vi.mock("../../hooks/useStoreSubscription", () => ({
  useStoreSubscription: vi.fn(),
}));

vi.mock("../common/BadgeComponents", () => ({
  StatusBadge: ({ running, pid }: any) => (
    <div data-testid="bot-status">{running ? `Running (PID ${pid})` : "Stopped"}</div>
  ),
}));

import { PaperTradingView } from "./PaperTradingView2";

beforeEach(() => {
  resetMockStateStore();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

function r() {
  return renderWithMantine(<PaperTradingView />);
}

describe("PaperTradingView", () => {
  describe("mounting and basic rendering", () => {
    test("renders with data-testid paper-trading-view", () => {
      r();
      expect(screen.getByTestId("paper-trading-view")).toBeInTheDocument();
    });

    test("renders LivePriceUpdater", () => {
      r();
      expect(screen.getByTestId("live-price-updater")).toBeInTheDocument();
    });

    test("renders Live view by default", () => {
      r();
      expect(screen.getByTestId("paper-left-panel")).toBeInTheDocument();
      expect(screen.getByTestId("paper-right-panel")).toBeInTheDocument();
    });

    test("renders left panel with portfolio card", () => {
      r();
      expect(screen.getByTestId("paper-portfolio-card")).toBeInTheDocument();
    });

    test("renders right panel with chart", () => {
      r();
      expect(screen.getByTestId("paper-chart")).toBeInTheDocument();
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

    test("Live view displays left and right panels", () => {
      mockStateStore.currentView = "live";
      r();
      expect(screen.getByTestId("paper-left-panel")).toBeInTheDocument();
      expect(screen.getByTestId("paper-right-panel")).toBeInTheDocument();
    });
  });

  describe("header and filters", () => {
    test("renders header with filters", () => {
      r();
      expect(screen.getByTestId("paper-filters")).toBeInTheDocument();
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
  });

  describe("error alert", () => {
    test("error alert close button clears error", async () => {
      const user = userEvent.setup();
      mockStateStore.error = "Something went wrong";
      r();
      const alert = screen.getByTestId("paper-error");
      expect(alert).toBeInTheDocument();
      const closeBtn = within(alert).getByRole("button");
      await user.click(closeBtn);
      const { setError } = await import("../../state/paperTrading");
      expect(setError).toHaveBeenCalledWith(null);
    });
  });

  describe("cleanup on unmount", () => {
    test("cleanup stops auto-refresh on unmount", async () => {
      const { stopLiveAutoRefresh } = await import("../../api/paperTrading");
      const { unmount } = renderWithMantine(<PaperTradingView />);
      unmount();
      expect(stopLiveAutoRefresh).toHaveBeenCalled();
    });
  });
});
