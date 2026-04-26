// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { SectorPage } from "./SectorPage";
import { useSectorData } from "../../components/sector/useSectorData";
import { renderWithMantine } from "../../test-utils/renderWithMantine";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";

// Mock the hook
vi.mock("../../components/sector/useSectorData", () => ({
  useSectorData: vi.fn(() => ({
    market: "india",
    setMarket: vi.fn(),
    activeTab: "dashboard",
    setActiveTab: vi.fn(),
    data: null,
    loading: true,
    error: null,
    loadData: vi.fn(),
    alerts: [],
    intervalMovers: [],
  })),
}));

vi.mock("../../components/sector/SectorDashboardContent", () => ({
  DashboardContent: ({ data, alerts, intervalMovers }: any) => (
    <div data-testid="dashboard-content">
      Dashboard - {data?.sectors.length} sectors, {alerts.length} alerts, {intervalMovers.length}{" "}
      movers
    </div>
  ),
}));

describe("SectorPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupBrowserMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders sector analysis view", () => {
    renderWithMantine(<SectorPage />);

    expect(screen.getByTestId("sector-analysis-view")).toBeInTheDocument();
  });

  it("renders header with title", () => {
    renderWithMantine(<SectorPage />);

    expect(screen.getByText("Sector Dashboard")).toBeInTheDocument();
  });

  it("renders market selector", () => {
    renderWithMantine(<SectorPage />);

    expect(screen.getByTestId("sector-market-selector")).toBeInTheDocument();
  });

  it("renders refresh button", () => {
    renderWithMantine(<SectorPage />);

    expect(screen.getByTestId("sector-refresh-btn")).toBeInTheDocument();
  });

  it("renders tabs", () => {
    renderWithMantine(<SectorPage />);

    expect(screen.getByTestId("sector-tab-dashboard")).toBeInTheDocument();
    expect(screen.getByTestId("sector-tab-historical")).toBeInTheDocument();
  });

  it("shows loading panel when loading", () => {
    vi.mocked(useSectorData).mockReturnValue({
      market: "india",
      setMarket: vi.fn(),
      activeTab: "dashboard",
      setActiveTab: vi.fn(),
      data: null,
      loading: true,
      error: null,
      loadData: vi.fn(),
      alerts: [],
      intervalMovers: [],
    });

    renderWithMantine(<SectorPage />);

    expect(screen.getByText("Fetching sector performance")).toBeInTheDocument();
  });

  it("shows error panel when error occurs", () => {
    vi.mocked(useSectorData).mockReturnValue({
      market: "india",
      setMarket: vi.fn(),
      activeTab: "dashboard",
      setActiveTab: vi.fn(),
      data: null,
      loading: false,
      error: "Failed to fetch sector data",
      loadData: vi.fn(),
      alerts: [],
      intervalMovers: [],
    });

    renderWithMantine(<SectorPage />);

    expect(screen.getByText("Error")).toBeInTheDocument();
    expect(screen.getByText("Failed to fetch sector data")).toBeInTheDocument();
  });

  it("calls loadData on retry button click", async () => {
    const mockLoadData = vi.fn().mockResolvedValue({});
    vi.mocked(useSectorData).mockReturnValue({
      market: "india",
      setMarket: vi.fn(),
      activeTab: "dashboard",
      setActiveTab: vi.fn(),
      data: null,
      loading: false,
      error: "Failed",
      loadData: mockLoadData,
      alerts: [],
      intervalMovers: [],
    });

    renderWithMantine(<SectorPage />);

    const retryBtn = screen.getByTestId("sector-retry-btn");
    await userEvent.click(retryBtn);

    expect(mockLoadData).toHaveBeenCalledWith("india");
  });

  it("shows empty panel when no data", () => {
    vi.mocked(useSectorData).mockReturnValue({
      market: "india",
      setMarket: vi.fn(),
      activeTab: "dashboard",
      setActiveTab: vi.fn(),
      data: { sectors: [] },
      loading: false,
      error: null,
      loadData: vi.fn(),
      alerts: [],
      intervalMovers: [],
    });

    renderWithMantine(<SectorPage />);

    expect(screen.getByText("No sector data")).toBeInTheDocument();
  });

  it("renders dashboard content with data", async () => {
    const mockData = {
      sectors: [
        {
          sector: "IT",
          avg_change: 2.5,
          stock_count: 50,
          advances: 30,
          declines: 20,
          avg_rsi: 55,
          avg_adx: 22,
          top_movers: "TCS",
        },
      ],
    };
    vi.mocked(useSectorData).mockReturnValue({
      market: "india",
      setMarket: vi.fn(),
      activeTab: "dashboard",
      setActiveTab: vi.fn(),
      data: mockData,
      loading: false,
      error: null,
      loadData: vi.fn(),
      alerts: [
        { sector: "IT", direction: "SURGING", delta: 0.5, timestamp: new Date().toISOString() },
      ],
      intervalMovers: [{ symbol: "TCS", change: 3.0 }],
    });

    renderWithMantine(<SectorPage />);

    await waitFor(() => {
      expect(screen.getByTestId("dashboard-content")).toBeInTheDocument();
    });
  });

  it("switches to historical iframe tab", () => {
    const mockSetActiveTab = vi.fn();
    vi.mocked(useSectorData).mockReturnValue({
      market: "india",
      setMarket: vi.fn(),
      activeTab: "historical",
      setActiveTab: mockSetActiveTab,
      data: null,
      loading: false,
      error: null,
      loadData: vi.fn(),
      alerts: [],
      intervalMovers: [],
    });

    renderWithMantine(<SectorPage />);

    expect(screen.getByTestId("sector-iframe")).toBeInTheDocument();
  });

  it("calls refresh button", async () => {
    const mockLoadData = vi.fn().mockResolvedValue({});
    vi.mocked(useSectorData).mockReturnValue({
      market: "india",
      setMarket: vi.fn(),
      activeTab: "dashboard",
      setActiveTab: vi.fn(),
      data: null,
      loading: false,
      error: null,
      loadData: mockLoadData,
      alerts: [],
      intervalMovers: [],
    });

    renderWithMantine(<SectorPage />);

    const refreshBtn = screen.getByTestId("sector-refresh-btn");
    await userEvent.click(refreshBtn);

    expect(mockLoadData).toHaveBeenCalledWith("india");
  });
});
