// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import { BrowserRouter } from "react-router-dom";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock useThemeColors
vi.mock("../../hooks/useThemeColors", () => ({
  useThemeColors: () => ({
    background: "#ffffff",
  }),
}));

// Mock useNewsWebSocket
vi.mock("../../state/newsWebSocket", () => ({
  useNewsWebSocket: vi.fn(),
  NewsWebSocketProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock news API
vi.mock("../../api/news", () => ({
  fetchNews: vi.fn(),
  fetchArticle: vi.fn(),
  fetchNewsSources: vi.fn(),
}));

// Mock localStorage helpers
vi.mock("./NewsLocalStorage", () => ({
  getReadIds: vi.fn(() => new Set()),
  saveReadIds: vi.fn(),
  getStoredAutoRefresh: vi.fn(() => "30000"),
  saveAutoRefresh: vi.fn(),
  getStoredLastSeenId: vi.fn(() => null),
  saveLastSeenId: vi.fn(),
  AUTO_REFRESH_INTERVALS: [
    { label: "Off", value: "0" },
    { label: "1m", value: "60000" },
    { label: "5m", value: "300000" },
    { label: "10m", value: "600000" },
  ],
}));

// Mock useNewsSourceGroups
vi.mock("./useNewsSourceGroups", () => ({
  useNewsSourceGroups: vi.fn(() => ({
    groupedNewsItems: {},
    sourceNames: [],
    expandedSources: new Set(),
    toggleSourceExpanded: vi.fn(),
  })),
  getSourceOptions: vi.fn(() => []),
}));

// Import component and mocked modules after vi.mock
import NewsPanel2 from "./NewsPanel2";
import { useNewsWebSocket } from "../../state/newsWebSocket";
import { fetchNews, fetchArticle, fetchNewsSources } from "../../api/news";
import { useNewsSourceGroups } from "./useNewsSourceGroups";
import { saveAutoRefresh } from "./NewsLocalStorage";

const mockNewsItems = [
  {
    id: "1",
    headline: "Test News 1",
    description: "Test description 1",
    source: "Reuters",
    sourceUrl: "https://example.com/1",
    publishedAt: "2025-01-01T10:00:00Z",
    fetchedAt: "2025-01-01T10:00:00Z",
    symbols: [],
  },
  {
    id: "2",
    headline: "Test News 2",
    description: "Test description 2",
    source: "Bloomberg",
    sourceUrl: "https://example.com/2",
    publishedAt: "2025-01-01T11:00:00Z",
    fetchedAt: "2025-01-01T11:00:00Z",
    symbols: [],
  },
];

// Helper to set up grouped news items
function setupNewsGroups(items: typeof mockNewsItems) {
  const grouped = items.reduce(
    (acc, item) => {
      (acc[item.source] = acc[item.source] || []).push(item);
      return acc;
    },
    {} as Record<string, typeof mockNewsItems>,
  );
  (useNewsSourceGroups as any).mockReturnValue({
    groupedNewsItems: grouped,
    sourceNames: Object.keys(grouped),
    expandedSources: new Set(Object.keys(grouped)),
    toggleSourceExpanded: vi.fn(),
  });
}

describe("NewsPanel2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupBrowserMocks();

    (useNewsWebSocket as any).mockReturnValue({
      connected: true,
      newsItems: [],
      hasNewArticles: false,
      clearNewArticlesFlag: vi.fn(),
      addNewsItems: vi.fn(),
    });

    (fetchNewsSources as any).mockResolvedValue([
      { id: "reuters", name: "Reuters" },
      { id: "bloomberg", name: "Bloomberg" },
    ]);
    (fetchNews as any).mockResolvedValue(mockNewsItems);
    (fetchArticle as any).mockResolvedValue({ content: "<p>Article content</p>" });

    // Set up default grouping
    setupNewsGroups(mockNewsItems);
  });

  afterEach(() => {
    cleanup();
  });

  const renderComponent = () =>
    render(
      <UIProvider>
        <BrowserRouter>
          <NewsPanel2 />
        </BrowserRouter>
      </UIProvider>,
    );

  it("renders the NEWS toggle button", () => {
    renderComponent();
    expect(screen.getByTestId("news-toggle-btn")).toBeInTheDocument();
    // Button should contain NEWS text
    expect(screen.getByTestId("news-toggle-btn")).toHaveTextContent("NEWS");
  });

  it("opens the panel when toggle button is clicked", async () => {
    const user = userEvent.setup();
    renderComponent();
    const toggleBtn = screen.getByTestId("news-toggle-btn");
    await user.click(toggleBtn);

    await waitFor(() => {
      expect(screen.getByTestId("news-panel")).toHaveClass("open");
    });
  });

  it("shows overlay when panel is open", async () => {
    const user = userEvent.setup();
    renderComponent();
    await user.click(screen.getByTestId("news-toggle-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("news-overlay")).toBeInTheDocument();
    });
  });

  it("closes panel when overlay is clicked", async () => {
    const user = userEvent.setup();
    renderComponent();
    await user.click(screen.getByTestId("news-toggle-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("news-panel")).toHaveClass("open");
    });

    const overlay = screen.getByTestId("news-overlay");
    await user.click(overlay);

    await waitFor(() => {
      expect(screen.getByTestId("news-panel")).not.toHaveClass("open");
    });
  });

  it("loads and displays news items", async () => {
    const user = userEvent.setup();
    renderComponent();
    await user.click(screen.getByTestId("news-toggle-btn"));

    await waitFor(() => {
      expect(fetchNews).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByText("Test News 1")).toBeInTheDocument();
      expect(screen.getByText("Test News 2")).toBeInTheDocument();
    });
  });

  it("opens article reader when news item is clicked", async () => {
    const user = userEvent.setup();
    renderComponent();
    await user.click(screen.getByTestId("news-toggle-btn"));

    await waitFor(() => {
      expect(screen.getByText("Test News 1")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Test News 1"));

    await waitFor(() => {
      expect(fetchArticle).toHaveBeenCalledWith("https://example.com/1");
    });
  });

  it("handles source filtering", async () => {
    const user = userEvent.setup();
    renderComponent();
    await user.click(screen.getByTestId("news-toggle-btn"));

    await waitFor(() => {
      expect(fetchNews).toHaveBeenCalledWith(undefined, 50);
    });
  });

  it("shows error state when fetch fails", async () => {
    const user = userEvent.setup();
    (fetchNews as any).mockRejectedValue(new Error("Network error"));
    renderComponent();
    await user.click(screen.getByTestId("news-toggle-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("news-error")).toBeInTheDocument();
    });
  });

  it("shows empty state when no news available", async () => {
    const user = userEvent.setup();
    (fetchNews as any).mockResolvedValue([]);
    renderComponent();
    await user.click(screen.getByTestId("news-toggle-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("news-empty")).toBeInTheDocument();
      expect(screen.getByTestId("news-empty")).toHaveTextContent("No news available");
    });
  });

  it("handles back navigation from article view", async () => {
    const user = userEvent.setup();
    renderComponent();
    await user.click(screen.getByTestId("news-toggle-btn"));

    await waitFor(() => {
      expect(screen.getByText("Test News 1")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Test News 1"));

    await waitFor(() => {
      expect(screen.getByTestId("news-article-view")).toBeInTheDocument();
    });

    const backButton = screen.getByTestId("news-article-back-btn");
    await user.click(backButton);

    await waitFor(() => {
      expect(screen.queryByTestId("news-article-view")).not.toBeInTheDocument();
    });
  });

  it("saves initial auto-refresh setting on mount", async () => {
    renderComponent();
    // The useAutoRefresh effect calls saveAutoRefresh with the stored value on mount
    await waitFor(() => {
      expect(saveAutoRefresh).toHaveBeenCalledWith("30000");
    });
  });
});
