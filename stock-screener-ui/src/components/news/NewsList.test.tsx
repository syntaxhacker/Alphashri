// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { NewsList } from "./NewsList";
import type { NewsItem } from "./news-types";
import { TestWrapper } from "../../test/test-utils";

vi.mock("./SentimentBadge", () => ({
  SentimentBadge: ({ sentiment }: { sentiment?: string }) => (
    <div data-testid="sentiment-badge">{sentiment}</div>
  ),
}));

vi.mock("./ImpactScore", () => ({
  ImpactScore: ({ score }: { score?: number }) => <div data-testid="impact-score">{score}</div>,
}));

describe("NewsList", () => {
  const mockNewsItems: NewsItem[] = [
    {
      id: "1",
      headline: "Test News 1",
      description: "Description 1",
      source: "Reuters",
      sourceUrl: "https://example.com/1",
      publishedAt: "2025-01-01T10:00:00Z",
      fetchedAt: "2025-01-01T10:00:00Z",
      symbols: [],
    },
    {
      id: "2",
      headline: "Test News 2",
      description: "Description 2",
      source: "Bloomberg",
      sourceUrl: "https://example.com/2",
      publishedAt: "2025-01-01T11:00:00Z",
      fetchedAt: "2025-01-01T11:00:00Z",
      symbols: [],
    },
  ];

  const mockGroupedNews = {
    Reuters: [mockNewsItems[0]],
    Bloomberg: [mockNewsItems[1]],
  };

  const mockSourceData = [
    { value: "all", label: "All Sources" },
    { value: "reuters", label: "Reuters" },
    { value: "bloomberg", label: "Bloomberg" },
  ];

  const defaultProps = {
    loading: false,
    error: null,
    selectedSource: "all",
    sourceData: mockSourceData,
    selectedArticle: null,
    onSourceChange: vi.fn(),
    onRefresh: vi.fn(),
    onArticleClick: vi.fn(),
    groupedNewsItems: mockGroupedNews,
    sourceNames: ["Reuters", "Bloomberg"],
    expandedSources: new Set(["Reuters", "Bloomberg"]),
    toggleSourceExpanded: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("rendering", () => {
    it("renders news feed container", () => {
      render(<NewsList {...defaultProps} />, { wrapper: TestWrapper });
      expect(screen.getByTestId("news-feed")).toBeInTheDocument();
    });

    it("renders title", () => {
      render(<NewsList {...defaultProps} />, { wrapper: TestWrapper });
      expect(screen.getByText("News Feed")).toBeInTheDocument();
    });

    it("renders refresh button", () => {
      render(<NewsList {...defaultProps} />, { wrapper: TestWrapper });
      expect(screen.getByTestId("news-feed-refresh-btn")).toBeInTheDocument();
    });

    it("renders source selector", () => {
      render(<NewsList {...defaultProps} />, { wrapper: TestWrapper });
      expect(screen.getByTestId("source-selector")).toBeInTheDocument();
    });

    it("renders empty state when no news available", () => {
      render(
        <NewsList
          {...defaultProps}
          groupedNewsItems={{}}
          sourceNames={[]}
          expandedSources={new Set()}
        />,
        { wrapper: TestWrapper },
      );
      expect(screen.getByText("No news available")).toBeInTheDocument();
    });

    it("renders loading state", () => {
      render(<NewsList {...defaultProps} loading={true} groupedNewsItems={{}} sourceNames={[]} />, {
        wrapper: TestWrapper,
      });
      expect(screen.getByTestId("news-loader")).toBeInTheDocument();
    });

    it("renders error state", () => {
      render(<NewsList {...defaultProps} error="Failed to load news" />, { wrapper: TestWrapper });
      expect(screen.getByText("Failed to load news")).toBeInTheDocument();
    });

    it("renders news items grouped by source", () => {
      render(<NewsList {...defaultProps} />, { wrapper: TestWrapper });
      expect(screen.getByText("Test News 1")).toBeInTheDocument();
    });
  });

  describe("callbacks", () => {
    it("accepts onSourceChange callback", () => {
      const onSourceChange = vi.fn();
      render(<NewsList {...defaultProps} onSourceChange={onSourceChange} />, {
        wrapper: TestWrapper,
      });
      expect(onSourceChange).not.toHaveBeenCalled();
    });

    it("accepts onArticleClick callback", () => {
      const onArticleClick = vi.fn();
      render(<NewsList {...defaultProps} onArticleClick={onArticleClick} />, {
        wrapper: TestWrapper,
      });
      expect(onArticleClick).not.toHaveBeenCalled();
    });

    it("calls onRefresh when refresh button is clicked", () => {
      const onRefresh = vi.fn();
      render(<NewsList {...defaultProps} onRefresh={onRefresh} />, { wrapper: TestWrapper });
      screen.getByTestId("news-feed-refresh-btn").click();
      expect(onRefresh).toHaveBeenCalled();
    });

    it("calls onArticleClick when article is clicked", () => {
      const onArticleClick = vi.fn();
      render(<NewsList {...defaultProps} onArticleClick={onArticleClick} />, {
        wrapper: TestWrapper,
      });

      const article = screen.getByText("Test News 1");
      article.click();

      expect(onArticleClick).toHaveBeenCalledWith(mockNewsItems[0]);
    });

    it("calls toggleSourceExpanded when source group header is clicked", () => {
      const toggleSourceExpanded = vi.fn();
      render(<NewsList {...defaultProps} toggleSourceExpanded={toggleSourceExpanded} />, {
        wrapper: TestWrapper,
      });
      screen.getByTestId("news-source-group-Reuters").click();
      expect(toggleSourceExpanded).toHaveBeenCalledWith("Reuters");
    });

    it("handles undefined onSourceChange gracefully", () => {
      const { container } = render(
        <NewsList {...defaultProps} onSourceChange={undefined as any} />,
        { wrapper: TestWrapper },
      );
      expect(container).toBeInTheDocument();
    });

    it("handles undefined onArticleClick gracefully", () => {
      const { container } = render(
        <NewsList {...defaultProps} onArticleClick={undefined as any} />,
        { wrapper: TestWrapper },
      );
      expect(container).toBeInTheDocument();
    });

    it("handles undefined onRefresh gracefully", () => {
      const { container } = render(<NewsList {...defaultProps} onRefresh={undefined as any} />, {
        wrapper: TestWrapper,
      });
      expect(container).toBeInTheDocument();
    });
  });

  describe("edge cases", () => {
    it("renders with empty sourceData array", () => {
      render(
        <NewsList
          {...defaultProps}
          sourceData={[]}
          sourceNames={[]}
          groupedNewsItems={{} as any}
        />,
        { wrapper: TestWrapper },
      );
      expect(screen.getByTestId("source-selector")).toBeInTheDocument();
    });

    it("renders with undefined sourceData", () => {
      render(
        <NewsList
          {...defaultProps}
          sourceData={undefined as any}
          sourceNames={[]}
          groupedNewsItems={{} as any}
        />,
        { wrapper: TestWrapper },
      );
      expect(screen.getByTestId("source-selector")).toBeInTheDocument();
    });

    it("renders with null error", () => {
      render(<NewsList {...defaultProps} error={null} />, { wrapper: TestWrapper });
      expect(screen.queryByText("Failed to load news")).not.toBeInTheDocument();
    });

    it("renders with null source in news item", () => {
      const mockGroupedWithNull = {
        null: [{ ...mockNewsItems[0], source: null as any }],
      };
      render(
        <NewsList
          {...defaultProps}
          groupedNewsItems={mockGroupedWithNull as any}
          sourceNames={["null"]}
        />,
        { wrapper: TestWrapper },
      );
      expect(screen.getByTestId("news-feed")).toBeInTheDocument();
    });

    it("renders with empty sourceNames array", () => {
      render(
        <NewsList
          {...defaultProps}
          sourceNames={[]}
          groupedNewsItems={{} as any}
          expandedSources={new Set()}
        />,
        { wrapper: TestWrapper },
      );
      expect(screen.getByTestId("news-feed")).toBeInTheDocument();
    });

    it("renders with null selectedArticle", () => {
      render(<NewsList {...defaultProps} selectedArticle={null} />, { wrapper: TestWrapper });
      expect(screen.getByTestId("news-feed")).toBeInTheDocument();
    });

    it("renders with undefined groupedNewsItems", () => {
      render(
        <NewsList
          {...defaultProps}
          groupedNewsItems={undefined as any}
          sourceNames={[]}
          expandedSources={new Set()}
        />,
        { wrapper: TestWrapper },
      );
      expect(screen.getByTestId("news-feed")).toBeInTheDocument();
    });

    it("renders with empty expandedSources set", () => {
      render(<NewsList {...defaultProps} expandedSources={new Set()} />, { wrapper: TestWrapper });
      expect(screen.getByTestId("news-feed")).toBeInTheDocument();
    });

    it("handles rapid article clicks", () => {
      const onArticleClick = vi.fn();
      render(<NewsList {...defaultProps} onArticleClick={onArticleClick} />, {
        wrapper: TestWrapper,
      });

      const article = screen.getByText("Test News 1");
      article.click();
      article.click();

      expect(onArticleClick).toHaveBeenCalledTimes(2);
    });
  });
});
