// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import NewsPage from "./NewsPage";
import { setupBrowserMocks } from "../test-utils/setupBrowser";

// The @/ui Box/Flex/... stubs from src/pages/solidTestStubs.tsx render as
// intrinsic elements; page tests exercise page wiring, not the theme runtime.
vi.mock("@/ui", async (importOriginal) => {
  const { uiLayoutStub } = await import("@/pages/solidTestStubs");
  return uiLayoutStub(await importOriginal<Record<string, unknown>>());
});

// Mock modules using vi.hoisted to avoid top-level variable issues
const { mockUseNewsList, mockUseNewsSourceGroups, mockFetchArticle, nav, articleProps } =
  vi.hoisted(() => {
    const mockUseNewsList = vi.fn();
    const mockUseNewsSourceGroups = vi.fn();
    const mockFetchArticle = vi.fn();
    return {
      mockUseNewsList,
      mockUseNewsSourceGroups,
      mockFetchArticle,
      nav: { navigate: vi.fn() },
      articleProps: { current: null as any },
    };
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
  useNavigate: () => nav.navigate,
}));

vi.mock("../components/news/NewsList", () => ({
  NewsList: (props: any) => (
    <div data-testid="news-list">
      {props.error ? <div data-testid="news-error">{props.error}</div> : null}
      <div
        data-testid="news-item"
        onClick={() =>
          props.onArticleClick?.({
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
  ArticleDetail: (props: any) => {
    articleProps.current = props;
    return (
      <div data-testid="article-detail-region">
        {props.selectedArticle ? `Article: ${props.selectedArticle.title}` : "No article selected"}
      </div>
    );
  },
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

  it("keeps the page frame fixed and scrolls inside the feed pane", () => {
    render(() => <NewsPage />);

    const page = screen.getByTestId("news-page");
    expect(page).toHaveClass("h-full", "min-h-0", "flex-col", "overflow-hidden");

    const header = screen.getByTestId("news-workspace-header");
    expect(header).toHaveClass("shrink-0");
    // The feed and reader panes own their own vertical overflow; the page root
    // never becomes a document-level scroller.
    const feed = screen.getByTestId("news-list-region");
    expect(feed).toHaveClass("min-h-0", "overflow-hidden");
  });

  it("renders news list component", () => {
    render(() => <NewsPage />);
    expect(screen.getByText("Test News Article")).toBeInTheDocument();
  });

  it("keeps the empty desktop feed and reader compact instead of a full-height void", () => {
    mockUseNewsList.mockReturnValue({
      newsItems: () => [],
      sources: () => [],
      selectedSource: () => "all",
      setSelectedSource: vi.fn(),
      loading: () => false,
      error: () => null,
      loadNews: vi.fn(),
    });
    mockUseNewsSourceGroups.mockReturnValue({
      groupedNewsItems: () => ({}),
      sourceNames: () => [],
      expandedSources: () => new Set(),
      toggleSourceExpanded: vi.fn(),
    });

    render(() => <NewsPage />);

    expect(screen.getByTestId("news-list-region")).toHaveClass("self-start", "h-[240px]");
    expect(screen.getByRole("region", { name: "Article reader" })).toHaveClass(
      "self-start",
      "h-[240px]",
    );
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

  it("drops the marketing subtitle but keeps the story and source counts", () => {
    render(() => <NewsPage />);

    const header = screen.getByTestId("news-workspace-header");
    expect(header).toHaveTextContent("NEWS");
    expect(header).toHaveTextContent("Stories");
    expect(header).toHaveTextContent("Sources");
    expect(header).not.toHaveTextContent("Market intelligence");
    expect(header).not.toHaveTextContent("Headlines, catalysts");
  });

  it("sends an Indian symbol through the shared chart href", () => {
    render(() => <NewsPage />);

    articleProps.current.onSymbolClick({
      trading_symbol: "RELIANCE",
      instrument_key: "NSE_EQ|INE002A01018",
    });
    expect(nav.navigate).toHaveBeenCalledWith("/chart/RELIANCE");
  });

  it("sends a US symbol to the chart route with the market parameter", () => {
    render(() => <NewsPage />);

    articleProps.current.onSymbolClick({
      trading_symbol: "AAPL",
      instrument_key: "NASDAQ|AAPL",
    });
    expect(nav.navigate).toHaveBeenCalledWith("/chart/AAPL?market=usa");
  });
});
