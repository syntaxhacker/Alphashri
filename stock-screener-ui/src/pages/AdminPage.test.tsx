// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import React from "react";
import AdminPage from "./AdminPage";
import { renderWithMantine } from "../test-utils/renderWithMantine";
import { setupBrowserMocks } from "../test-utils/setupBrowser";

// Create mock functions
const mockFetchWithAuth = vi.fn();

// Mock useAuth to return an object with fetchWithAuth
vi.mock("../components/auth/AuthProvider2", () => ({
  useAuth: vi.fn(() => ({ fetchWithAuth: mockFetchWithAuth })),
}));

// Mock compact components using React.createElement to avoid JSX issues
vi.mock("../components/common/compact", () => ({
  CompactPage: vi.fn(({ title, description, actions, children, ...props }: any) =>
    React.createElement(
      "div",
      { "data-testid": "compact-page", ...props },
      title && React.createElement("div", null, typeof title === "string" ? title : title),
      description && React.createElement("div", null, description),
      actions,
      children,
    ),
  ),
  CompactPanel: vi.fn(({ title, children, ...props }: any) =>
    React.createElement(
      "div",
      { "data-testid": "compact-panel", ...props },
      title && React.createElement("div", null, typeof title === "string" ? title : title),
      children,
    ),
  ),
  CompactStat: vi.fn(({ label, value, ...props }: any) =>
    React.createElement(
      "div",
      { "data-testid": "compact-stat", ...props },
      React.createElement("div", null, label),
      React.createElement("div", null, value),
    ),
  ),
  CompactStatGrid: vi.fn(({ children, ...props }: any) =>
    React.createElement("div", { "data-testid": "compact-stat-grid", ...props }, children),
  ),
}));

vi.mock("./admin/RecentRunsTable", () => ({
  RecentRunsTable: vi.fn(({ runs }: any) =>
    React.createElement("div", { "data-testid": "runs-table" }, `Runs: ${runs?.length || 0}`),
  ),
  ModelBreakdown: vi.fn(({ models }: any) =>
    React.createElement(
      "div",
      { "data-testid": "model-breakdown" },
      React.createElement("div", null, "Model Breakdown"),
      `Models: ${models?.length || 0}`,
    ),
  ),
  formatCost: (cost: number) => `$${cost.toFixed(4)}`,
  formatResponseTime: (ms: number) => `${ms}ms`,
}));

vi.mock("../hooks/useThemeColors", () => ({
  useThemeColors: () => ({
    isDark: false,
    background: "#fff",
  }),
}));

describe("AdminPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupBrowserMocks();
    mockFetchWithAuth.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  const mockStats = {
    recent_runs: [
      {
        id: 1,
        model: "gpt-4",
        status: "success",
        tokens: 1500,
        cost_usd: 0.045,
        response_time_ms: 1200,
        created_at: "2025-06-15T10:00:00Z",
      },
    ],
    aggregate: {
      total_runs: 100,
      total_tokens: 150000,
      total_cost_usd: 4.5,
      avg_response_time_ms: 1100,
      models_used: ["gpt-4", "claude-3"],
    },
  };

  it("renders loading state initially", () => {
    mockFetchWithAuth.mockImplementation(() => new Promise(() => {}));

    renderWithMantine(<AdminPage />);

    expect(screen.getByText("Loading LLM stats")).toBeInTheDocument();
  });

  it("renders error state on fetch failure", async () => {
    mockFetchWithAuth.mockRejectedValue(new Error("Network error"));

    renderWithMantine(<AdminPage />);

    await waitFor(() => {
      expect(screen.getByText(/Unable to load stats/)).toBeInTheDocument();
    });
  });

  it("renders admin content after successful fetch", async () => {
    mockFetchWithAuth.mockResolvedValue({
      ok: true,
      json: async () => mockStats,
    });

    renderWithMantine(<AdminPage />);

    await waitFor(() => {
      expect(screen.getByText("LLM Admin Dashboard")).toBeInTheDocument();
    });

    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("150,000")).toBeInTheDocument();
    expect(screen.getByText("$4.5000")).toBeInTheDocument();
  });

  it("displays refresh button", async () => {
    mockFetchWithAuth.mockResolvedValue({
      ok: true,
      json: async () => mockStats,
    });

    renderWithMantine(<AdminPage />);

    await waitFor(() => {
      expect(screen.getByTestId("refresh-btn")).toBeInTheDocument();
    });
  });

  it("calls fetchStats when refresh button is clicked", async () => {
    mockFetchWithAuth.mockResolvedValue({
      ok: true,
      json: async () => mockStats,
    });

    renderWithMantine(<AdminPage />);

    await waitFor(() => {
      expect(screen.getByTestId("refresh-btn")).toBeInTheDocument();
    });

    const refreshBtn = screen.getByTestId("refresh-btn");
    refreshBtn.click();

    expect(mockFetchWithAuth).toHaveBeenCalledTimes(2); // initial + refresh
  });

  it("displays model breakdown", async () => {
    mockFetchWithAuth.mockResolvedValue({
      ok: true,
      json: async () => mockStats,
    });

    renderWithMantine(<AdminPage />);

    await waitFor(() => {
      expect(screen.getByText("Model Breakdown")).toBeInTheDocument();
    });

    expect(screen.getByText("Models: 2")).toBeInTheDocument();
  });

  it("renders recent runs table", async () => {
    mockFetchWithAuth.mockResolvedValue({
      ok: true,
      json: async () => mockStats,
    });

    renderWithMantine(<AdminPage />);

    await waitFor(() => {
      expect(screen.getByText("Recent Runs")).toBeInTheDocument();
    });

    expect(screen.getByTestId("runs-table")).toBeInTheDocument();
  });

  it("shows warning if there is a non-fatal error", async () => {
    const mockStatsWithError = {
      ...mockStats,
      error: "Some models failed to fetch",
    };
    mockFetchWithAuth.mockResolvedValue({
      ok: true,
      json: async () => mockStatsWithError,
    });

    renderWithMantine(<AdminPage />);

    await waitFor(() => {
      expect(screen.getByText(/Some models failed to fetch/)).toBeInTheDocument();
    });
  });

  it("renders with empty stats when no LLM runs exist", async () => {
    const emptyStats = {
      recent_runs: [],
      aggregate: {
        total_runs: 0,
        total_tokens: 0,
        total_cost_usd: 0,
        avg_response_time_ms: 0,
        models_used: [],
      },
    };
    mockFetchWithAuth.mockResolvedValue({
      ok: true,
      json: async () => emptyStats,
    });

    renderWithMantine(<AdminPage />);

    await waitFor(() => {
      expect(screen.getByTestId("refresh-btn")).toBeInTheDocument();
    });

    const statGrid = screen.getByTestId("compact-stat-grid");
    expect(within(statGrid).getAllByText("0").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("$0.0000")).toBeInTheDocument();
    expect(screen.getByText("0ms")).toBeInTheDocument();
    expect(screen.getByText("Models: 0")).toBeInTheDocument();
    expect(screen.getByText("Runs: 0")).toBeInTheDocument();
  });
});
