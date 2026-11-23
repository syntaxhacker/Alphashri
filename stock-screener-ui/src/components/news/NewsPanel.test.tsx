// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import { MemoryRouter, createMemoryHistory } from "@solidjs/router";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";
import type { JSX } from "solid-js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

vi.mock("../../state/newsWebSocket", () => ({
  useNewsWebSocket: vi.fn(),
  NewsWebSocketProvider: (props: { children: JSX.Element }) => <>{props.children}</>,
}));

vi.mock("../../api/news", () => ({
  fetchNews: vi.fn(),
  fetchArticle: vi.fn(),
  fetchNewsSources: vi.fn(),
}));

vi.mock("./NewsLocalStorage", () => ({
  getReadIds: vi.fn(() => new Set()),
  saveReadIds: vi.fn(),
  getStoredAutoRefresh: vi.fn(() => "30000"),
  saveAutoRefresh: vi.fn(),
  getStoredLastSeenId: vi.fn(() => null),
  saveLastSeenId: vi.fn(),
  AUTO_REFRESH_INTERVALS: [
    { label: "Off", value: "0" },
    { label: "5s", value: "5000" },
    { label: "1m", value: "60000" },
    { label: "5m", value: "300000" },
    { label: "10m", value: "600000" },
  ],
}));

vi.mock("./useNewsSourceGroups", () => ({
  useNewsSourceGroups: vi.fn(() => ({
    groupedNewsItems: () => ({}),
    sourceNames: () => [],
    expandedSources: () => new Set(),
    toggleSourceExpanded: vi.fn(),
  })),
  getSourceOptions: vi.fn(() => []),
}));

// Import component and mocked modules after vi.mock
import NewsPanel2 from "./NewsPanel";
import { useNewsWebSocket } from "../../state/newsWebSocket";
import { fetchNews, fetchArticle, fetchNewsSources } from "../../api/news";
import { useNewsSourceGroups } from "./useNewsSourceGroups";
import { getStoredAutoRefresh, saveAutoRefresh } from "./NewsLocalStorage";

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

function setupNewsGroups(items: typeof mockNewsItems) {
  const grouped = items.reduce(
    (acc, item) => {
      (acc[item.source] = acc[item.source] || []).push(item);
      return acc;
    },
    {} as Record<string, typeof mockNewsItems>,
  );
  (useNewsSourceGroups as any).mockReturnValue({
    groupedNewsItems: () => grouped,
    sourceNames: () => Object.keys(grouped),
    expandedSources: () => new Set(Object.keys(grouped)),
    toggleSourceExpanded: vi.fn(),
  });
}

describe("NewsPanel2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupBrowserMocks();

    (useNewsWebSocket as any).mockReturnValue({
      connected: () => true,
      newsItems: () => [],
      hasNewArticles: () => false,
      clearNewArticlesFlag: vi.fn(),
      addNewsItems: vi.fn(),
    });

    (fetchNewsSources as any).mockResolvedValue([
      { id: "reuters", name: "Reuters" },
      { id: "bloomberg", name: "Bloomberg" },
    ]);
    (fetchNews as any).mockResolvedValue(mockNewsItems);
    (fetchArticle as any).mockResolvedValue({ content: "<p>Article content</p>" });

    setupNewsGroups(mockNewsItems);
  });

  afterEach(() => {
    cleanup();
  });

  const renderComponent = () => {
    const history = createMemoryHistory();
    history.set({ value: "/", replace: true, scroll: false });
    return render(() => (
      <MemoryRouter
        history={history}
        root={() => (
          <UIProvider>
            <NewsPanel2 />
          </UIProvider>
        )}
      />
    ));
  };

  it("renders the NEWS toggle as an icon-only button", () => {
    renderComponent();
    const btn = screen.getByTestId("news-toggle-btn");
    expect(btn).toBeInTheDocument();
    // Icon-only: the label lives on the accessible name/tooltip, not in the
    // header tape.
    expect(btn).toHaveAttribute("aria-label", "News");
    expect(btn).not.toHaveTextContent("NEWS");
    expect(btn.querySelector("svg")).not.toBeNull();
  });

  it("closed panel is inert, aria-hidden and not pointer-interactive", () => {
    renderComponent();
    const panel = screen.getByTestId("news-panel");
    expect(panel).not.toHaveClass("open");
    expect(panel).toHaveAttribute("inert");
    expect(panel).toHaveAttribute("aria-hidden", "true");
    expect(panel).toHaveStyle({ visibility: "hidden", "pointer-events": "none", right: "-400px" });
  });

  it("open panel is interactive with inert and aria-hidden removed", async () => {
    renderComponent();
    await fireEvent.click(screen.getByTestId("news-toggle-btn"));

    await waitFor(() => {
      const panel = screen.getByTestId("news-panel");
      expect(panel).toHaveClass("open");
      expect(panel).not.toHaveAttribute("inert");
      expect(panel).not.toHaveAttribute("aria-hidden");
      expect(panel).toHaveStyle({ visibility: "visible", "pointer-events": "auto" });
    });
  });

  it("opens the panel when toggle button is clicked", async () => {
        renderComponent();
    const toggleBtn = screen.getByTestId("news-toggle-btn");
    await fireEvent.click(toggleBtn);

    await waitFor(() => {
      expect(screen.getByTestId("news-panel")).toHaveClass("open");
    });
  });

  it("shows overlay when panel is open", async () => {
        renderComponent();
    await fireEvent.click(screen.getByTestId("news-toggle-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("news-overlay")).toBeInTheDocument();
    });
  });

  it("closes panel when overlay is clicked", async () => {
        renderComponent();
    await fireEvent.click(screen.getByTestId("news-toggle-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("news-panel")).toHaveClass("open");
    });

    const overlay = screen.getByTestId("news-overlay");
    await fireEvent.click(overlay);

    await waitFor(() => {
      expect(screen.getByTestId("news-panel")).not.toHaveClass("open");
    });
  });

  it("loads and displays news items", async () => {
        renderComponent();
    await fireEvent.click(screen.getByTestId("news-toggle-btn"));

    await waitFor(() => {
      expect(fetchNews).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByText("Test News 1")).toBeInTheDocument();
      expect(screen.getByText("Test News 2")).toBeInTheDocument();
    });
  });

  it("opens article reader when news item is clicked", async () => {
        renderComponent();
    await fireEvent.click(screen.getByTestId("news-toggle-btn"));

    await waitFor(() => {
      expect(screen.getByText("Test News 1")).toBeInTheDocument();
    });

    await fireEvent.click(screen.getByText("Test News 1"));

    await waitFor(() => {
      expect(fetchArticle).toHaveBeenCalledWith("https://example.com/1");
    });
  });

  it("retries a failed article load from the reader", async () => {
        (fetchArticle as any).mockRejectedValueOnce(new Error("Network error"));
    renderComponent();
    await fireEvent.click(screen.getByTestId("news-toggle-btn"));

    await fireEvent.click(await screen.findByText("Test News 1"));
    await fireEvent.click(await screen.findByTestId("news-article-retry-btn"));

    await waitFor(() => {
      expect(fetchArticle).toHaveBeenCalledTimes(2);
    });
  });

  it("handles source filtering", async () => {
        renderComponent();
    await fireEvent.click(screen.getByTestId("news-toggle-btn"));

    await waitFor(() => {
      expect(fetchNews).toHaveBeenCalledWith(undefined, 50);
    });
  });

  it("shows error state when fetch fails", async () => {
        (fetchNews as any).mockRejectedValue(new Error("Network error"));
    renderComponent();
    await fireEvent.click(screen.getByTestId("news-toggle-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("news-error")).toBeInTheDocument();
    });
  });

  it("shows empty state when no news available", async () => {
        (fetchNews as any).mockResolvedValue([]);
    renderComponent();
    await fireEvent.click(screen.getByTestId("news-toggle-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("news-empty")).toBeInTheDocument();
      expect(screen.getByTestId("news-empty")).toHaveTextContent("No news available");
    });
  });

  it("handles back navigation from article view", async () => {
        renderComponent();
    await fireEvent.click(screen.getByTestId("news-toggle-btn"));

    await waitFor(() => {
      expect(screen.getByText("Test News 1")).toBeInTheDocument();
    });

    await fireEvent.click(screen.getByText("Test News 1"));

    await waitFor(() => {
      expect(screen.getByTestId("news-article-view")).toBeInTheDocument();
    });

    const backButton = screen.getByTestId("news-article-back-btn");
    await fireEvent.click(backButton);

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

  it("re-arms polling when the interval changes from 60s to 5s", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(getStoredAutoRefresh).mockReturnValueOnce("60000");
      renderComponent();
      fireEvent.click(screen.getByTestId("news-toggle-btn"));

      await vi.advanceTimersByTimeAsync(0);
      expect(fetchNews).toHaveBeenCalledTimes(1);

      const select = screen.getByTestId("news-auto-refresh-select").querySelector("select")!;
      fireEvent.input(select, { target: { value: "5000" } });

      await vi.advanceTimersByTimeAsync(4999);
      expect(fetchNews).toHaveBeenCalledTimes(1); // old 60s clock was cleared

      await vi.advanceTimersByTimeAsync(1);
      expect(fetchNews).toHaveBeenCalledTimes(2); // new 5s clock fired
    } finally {
      vi.useRealTimers();
    }
  });
});
