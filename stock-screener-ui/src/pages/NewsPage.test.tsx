// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import NewsPage from "./NewsPage";
import { setupBrowserMocks } from "../test-utils/setupBrowser";

// @/ui's dynamic-tag layout primitives crash at runtime on this branch;
// stub them with intrinsic elements (see src/pages/solidTestStubs.tsx).
vi.mock("@/ui", async (importOriginal) => {
  const { uiLayoutStub } = await import("@/pages/solidTestStubs");
  return uiLayoutStub(await importOriginal<Record<string, unknown>>());
});

// Mock modules using vi.hoisted to avoid top-level variable issues
const { mockUseNewsList, mockUseNewsSourceGroups, mockFetchArticle } = vi.hoisted(() => {
  const mockUseNewsList = vi.fn();
  const mockUseNewsSourceGroups = vi.fn();
  const mockFetchArticle = vi.fn();
  return { mockUseNewsList, mockUseNewsSourceGroups, mockFetchArticle };
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

vi.mock("@solidjs/router", () => ({
  useNavigate: vi.fn(() => vi.fn()),
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
  ArticleDetail: ({ selectedArticle }: any) => (
    <div data-testid="article-detail-region">
      {selectedArticle ? `Article: ${selectedArticle.title}` : "No article selected"}
    </div>
  ),
}));

describe("NewsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupBrowserMocks();

    // Set default mock implementations — the real hooks return accessors
    mockUseNewsList.mockReturnValue({
      newsItems: () => [
        {
          id: 1,
          title: "Test News Article",
          source: "TestSource",
          sourceUrl: "https://example.com/article1",
          publishedAt: new Date().toISOString(),
          symbols: [{ instrument_key: "TEST123", trading_symbol: "TEST", url: null }],
        },
      ],
      sources: () => ["TestSource"],
      selectedSource: () => "all",
      setSelectedSource: vi.fn(),
      loading: () => false,
      error: () => null,
      loadNews: vi.fn(),
    });

    mockUseNewsSourceGroups.mockReturnValue({
      groupedNewsItems: () => ({ TestSource: [] }),
      sourceNames: () => ["TestSource"],
      expandedSources: () => new Set(),
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

  it("renders the news workspace on desktop", () => {
    render(() => <NewsPage />);
    expect(screen.getByTestId("news-page")).toBeInTheDocument();
    expect(screen.getByTestId("news-workspace-header")).toBeInTheDocument();
    expect(screen.getByTestId("news-list-region")).toBeInTheDocument();
    expect(screen.getByTestId("article-detail-region")).toBeInTheDocument();
  });

  it("renders news list component", () => {
    render(() => <NewsPage />);
    expect(screen.getByText("Test News Article")).toBeInTheDocument();
  });

  it("shows error state", () => {
    mockUseNewsList.mockReturnValue({
      newsItems: () => [],
      sources: () => [],
      selectedSource: () => "all",
      setSelectedSource: vi.fn(),
      loading: () => false,
      error: () => "Failed to load news",
      loadNews: vi.fn(),
    });

    render(() => <NewsPage />);
    expect(screen.getByText("Failed to load news")).toBeInTheDocument();
  });

  it("clicking article calls fetchArticle", async () => {
    render(() => <NewsPage />);

    await waitFor(() => {
      expect(screen.getByText("Test News Article")).toBeInTheDocument();
    });

    const article = screen.getByText("Test News Article");
    fireEvent.click(article);

    await waitFor(() => {
      expect(mockFetchArticle).toHaveBeenCalledWith("https://example.com/article1");
    });
  });
});
