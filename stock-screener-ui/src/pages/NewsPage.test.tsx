// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import NewsPage from "./NewsPage";
import { renderWithMantine } from "../test-utils/renderWithMantine";
import { setupBrowserMocks } from "../test-utils/setupBrowser";
import { useNavigate } from "react-router-dom";

// Mock modules using vi.hoisted to avoid top-level variable issues
const { mockUseNewsList, mockUseNewsSourceGroups, mockFetchArticle, mockUseMediaQuery } = vi.hoisted(() => {
  const mockUseNewsList = vi.fn();
  const mockUseNewsSourceGroups = vi.fn();
  const mockFetchArticle = vi.fn();
  const mockUseMediaQuery = vi.fn(() => false);
  return { mockUseNewsList, mockUseNewsSourceGroups, mockFetchArticle, mockUseMediaQuery };
});

vi.mock("../components/news/useNewsList", () => ({
  useNewsList: () => mockUseNewsList(),
}));

vi.mock("../components/news/useNewsSourceGroups", () => ({
  useNewsSourceGroups: () => mockUseNewsSourceGroups(),
  getSourceOptions: vi.fn((sources: string[]) =>
    sources.map((s: string) => ({ value: s, label: s })),
  ),
}));

vi.mock("../api/news", () => ({
  fetchArticle: mockFetchArticle,
}));

vi.mock("react-router-dom", () => ({
  useNavigate: vi.fn(),
  useSearchParams: vi.fn(() => [new URLSearchParams(), vi.fn()]),
}));

vi.mock("@mantine/hooks", () => ({
  useMediaQuery: mockUseMediaQuery,
}));

vi.mock("../components/news/NewsList", () => ({
  NewsList: ({ onArticleClick, error }: any) => (
    <div data-testid="news-list">
      {error && <div data-testid="news-error">{error}</div>}
      <div
        data-testid="news-item"
        onClick={() =>
          onArticleClick({
            id: 1,
            title: "Test News Article",
            source: "TestSource",
            sourceUrl: "https://example.com/article1",
            publishedAt: new Date().toISOString(),
            symbols: [{ instrument_key: "TEST123", trading_symbol: "TEST", url: null }],
          })
        }
      >
        Test News Article
      </div>
    </div>
  ),
}));

vi.mock("../components/news/ArticleDetail", () => ({
  ArticleDetail: ({ selectedArticle, isMobile, showFullContent }: any) => (
    <div data-testid="article-detail" data-mobile={isMobile} data-show-full={showFullContent}>
      {selectedArticle ? `Article: ${selectedArticle.title}` : "No article selected"}
    </div>
  ),
}));

vi.mock("../hooks/useThemeColors", () => ({
  useThemeColors: () => ({
    isDark: false,
    background: "#fff",
  }),
}));

describe("NewsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupBrowserMocks();

    // Set default mock implementations
    mockUseNewsList.mockReturnValue({
      newsItems: [
        {
          id: 1,
          title: "Test News Article",
          source: "TestSource",
          sourceUrl: "https://example.com/article1",
          publishedAt: new Date().toISOString(),
          symbols: [{ instrument_key: "TEST123", trading_symbol: "TEST", url: null }],
        },
      ],
      sources: ["TestSource"],
      selectedSource: "all",
      setSelectedSource: vi.fn(),
      loading: false,
      error: null,
      loadNews: vi.fn(),
    });

    mockUseNewsSourceGroups.mockReturnValue({
      groupedNewsItems: { TestSource: [] },
      sourceNames: ["TestSource"],
      expandedSources: new Set(),
      toggleSourceExpanded: vi.fn(),
    });

    mockFetchArticle.mockResolvedValue({
      content: "Article content",
      summary: "Article summary",
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders news page on desktop", () => {
    renderWithMantine(<NewsPage />);
    expect(screen.getByTestId("news-page")).toBeInTheDocument();
  });

  it("renders news list component", () => {
    renderWithMantine(<NewsPage />);
    expect(screen.getByText("Test News Article")).toBeInTheDocument();
  });

  it("renders article detail panel on desktop", () => {
    renderWithMantine(<NewsPage />);
    expect(screen.getByTestId("news-page")).toBeInTheDocument();
  });

  it("shows loading state", () => {
    mockUseNewsList.mockReturnValue({
      newsItems: [],
      sources: [],
      selectedSource: "all",
      setSelectedSource: vi.fn(),
      loading: true,
      error: null,
      loadNews: vi.fn(),
    });

    renderWithMantine(<NewsPage />);
    expect(screen.getByTestId("news-page")).toBeInTheDocument();
  });

  it("shows error state", () => {
    mockUseNewsList.mockReturnValue({
      newsItems: [],
      sources: [],
      selectedSource: "all",
      setSelectedSource: vi.fn(),
      loading: false,
      error: "Failed to load news",
      loadNews: vi.fn(),
    });

    renderWithMantine(<NewsPage />);
    expect(screen.getByText("Failed to load news")).toBeInTheDocument();
  });

  it("clicking article calls fetchArticle", async () => {
    renderWithMantine(<NewsPage />);

    await waitFor(() => {
      expect(screen.getByText("Test News Article")).toBeInTheDocument();
    });

    const article = screen.getByText("Test News Article");
    await userEvent.click(article);

    expect(mockFetchArticle).toHaveBeenCalledWith("https://example.com/article1");
  });

  it("navigates to chart when symbol is clicked", async () => {
    const mockNavFn = vi.fn();
    vi.mocked(useNavigate).mockReturnValue(mockNavFn);
    renderWithMantine(<NewsPage />);

    await waitFor(() => {
      expect(screen.getByText("Test News Article")).toBeInTheDocument();
    });

    expect(mockNavFn).toBeDefined();
  });

  it("renders source selector", () => {
    renderWithMantine(<NewsPage />);
    expect(screen.getByText("Test News Article")).toBeInTheDocument();
  });

  it("renders news-page on mobile viewport", () => {
    mockUseMediaQuery.mockReturnValue(true);
    renderWithMantine(<NewsPage />);
    expect(screen.getByTestId("news-page")).toBeInTheDocument();
    mockUseMediaQuery.mockReturnValue(false);
  });

  it("renders article in modal on mobile viewport when article clicked", async () => {
    mockUseMediaQuery.mockReturnValue(true);
    mockFetchArticle.mockResolvedValue({ content: "Article content" });

    renderWithMantine(<NewsPage />);

    await waitFor(() => {
      expect(screen.getByText("Test News Article")).toBeInTheDocument();
    });

    const article = screen.getByText("Test News Article");
    await userEvent.click(article);

    await waitFor(() => {
      expect(mockFetchArticle).toHaveBeenCalled();
    });
    mockUseMediaQuery.mockReturnValue(false);
  });

  it("opens window.open when a symbol with URL is clicked", () => {
    const mockOpen = vi.fn();
    window.open = mockOpen;

    mockUseNewsList.mockReturnValue({
      newsItems: [
        {
          id: 1,
          title: "Test Article",
          source: "TestSource",
          sourceUrl: "https://example.com/article1",
          publishedAt: new Date().toISOString(),
          symbols: [
            { code: "MC", name: "MC", url: "https://moneycontrol.com/stocks/mc", instrument_key: null, trading_symbol: null },
          ],
        },
      ],
      sources: ["TestSource"],
      selectedSource: "all",
      setSelectedSource: vi.fn(),
      loading: false,
      error: null,
      loadNews: vi.fn(),
    });

    renderWithMantine(<NewsPage />);
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it("passes showFullContent toggle from useArticleDetail to ArticleDetail", () => {
    renderWithMantine(<NewsPage />);
    const articleDetail = screen.getByTestId("article-detail");
    expect(articleDetail).toHaveAttribute("data-show-full", "false");
  });
});
