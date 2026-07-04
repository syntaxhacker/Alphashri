// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import React from "react";
import AdminPage from "./AdminPage";
import { renderWithMantine } from "../test-utils/renderWithMantine";
import { setupBrowserMocks } from "../test-utils/setupBrowser";

vi.mock("../components/auth/AuthProvider2", () => ({
  useAuth: vi.fn(() => ({ fetchWithAuth: vi.fn() })),
}));

// Mock all three panel components
vi.mock("./admin/LLMStatsPanel", () => ({
  LLMStatsPanel: () => React.createElement("div", { "data-testid": "llm-stats-panel" }, "LLM Stats Content"),
}));

vi.mock("./admin/Admin52wRangePanel", () => ({
  Admin52wRangePanel: () => React.createElement("div", { "data-testid": "admin-52w-range-panel-mock" }),
}));

vi.mock("./admin/NewsQueuePanel", () => ({
  NewsQueuePanel: () => React.createElement("div", { "data-testid": "news-queue-panel-mock" }),
}));

vi.mock("../hooks/useThemeColors", () => ({
  useThemeColors: () => ({ isDark: false, background: "#fff" }),
}));

describe("AdminPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupBrowserMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the admin page with tabs", () => {
    renderWithMantine(<AdminPage />);
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("LLM stats")).toBeInTheDocument();
    expect(screen.getByText("52W range batch")).toBeInTheDocument();
    expect(screen.getByText("News Queue")).toBeInTheDocument();
  });

  it("shows LLM stats tab by default", () => {
    renderWithMantine(<AdminPage />);
    expect(screen.getByTestId("llm-stats-panel")).toBeInTheDocument();
  });

  it("switches to 52W tab", () => {
    renderWithMantine(<AdminPage />);
    screen.getByTestId("admin-tab-52w").click();
    expect(screen.getByTestId("admin-52w-range-panel-mock")).toBeInTheDocument();
  });

  it("switches to News Queue tab", () => {
    renderWithMantine(<AdminPage />);
    screen.getByTestId("admin-tab-news-queue").click();
    expect(screen.getByTestId("news-queue-panel-mock")).toBeInTheDocument();
  });

  it("renders admin description", () => {
    renderWithMantine(<AdminPage />);
    expect(screen.getByText("LLM telemetry, 52W range batch, and news analysis queue.")).toBeInTheDocument();
  });
});
