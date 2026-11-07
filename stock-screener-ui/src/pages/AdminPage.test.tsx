// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import React from "react";
import AdminPage from "./AdminPage";
import { renderWithProviders } from "../test-utils/renderWithProviders";
import { setupBrowserMocks } from "../test-utils/setupBrowser";

vi.mock("../components/auth/AuthProvider2", () => ({
  useAuth: vi.fn(() => ({ fetchWithAuth: vi.fn() })),
}));

// Mock the admin panel components
vi.mock("./admin/LLMStatsPanel", () => ({
  LLMStatsPanel: () => React.createElement("div", { "data-testid": "llm-stats-panel" }, "LLM Stats Content"),
}));

vi.mock("./admin/Admin52wRangePanel", () => ({
  Admin52wRangePanel: () => React.createElement("div", { "data-testid": "admin-52w-range-panel-mock" }),
}));

vi.mock("./admin/NewsQueuePanel", () => ({
  NewsQueuePanel: () => React.createElement("div", { "data-testid": "news-queue-panel-mock" }),
}));

vi.mock("./admin/AdminPatternTimeframesPanel", () => ({
  AdminPatternTimeframesPanel: () =>
    React.createElement("div", { "data-testid": "admin-pattern-timeframes-panel-mock" }),
}));

vi.mock("../components/patterns/PatternImageManager", () => ({
  PatternImageManager: () =>
    React.createElement("div", { "data-testid": "pattern-image-manager-mock" }),
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
    renderWithProviders(<AdminPage />);
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("LLM stats")).toBeInTheDocument();
    expect(screen.getByText("52W range batch")).toBeInTheDocument();
    expect(screen.getByText("Pattern timeframes")).toBeInTheDocument();
    expect(screen.getByText("News Queue")).toBeInTheDocument();
  });

  it("shows LLM stats tab by default", () => {
    renderWithProviders(<AdminPage />);
    expect(screen.getByTestId("llm-stats-panel")).toBeInTheDocument();
  });

  it("switches to 52W tab", async () => {
      const user = userEvent.setup();
    renderWithProviders(<AdminPage />);
    await user.click(screen.getByTestId("admin-tab-52w"));
    expect(screen.getByTestId("admin-52w-range-panel-mock")).toBeInTheDocument();
  });

  it("switches to News Queue tab", async () => {
      const user = userEvent.setup();
    renderWithProviders(<AdminPage />);
    await user.click(screen.getByTestId("admin-tab-news-queue"));
    expect(screen.getByTestId("news-queue-panel-mock")).toBeInTheDocument();
  });

  it("renders a compact header without a page description", () => {
    renderWithProviders(<AdminPage />);
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.queryByText(/LLM telemetry/)).not.toBeInTheDocument();
  });

  it("switches to the Pattern timeframes tab", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminPage />);
    await user.click(screen.getByTestId("admin-tab-pattern-timeframes"));
    expect(screen.getByTestId("admin-pattern-timeframes-panel-mock")).toBeInTheDocument();
  });

  it("switches to the Pattern images tab", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminPage />);
    await user.click(screen.getByTestId("admin-tab-pattern-images"));
    expect(screen.getByTestId("pattern-image-manager-mock")).toBeInTheDocument();
  });
});
