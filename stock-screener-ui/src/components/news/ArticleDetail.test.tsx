// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { ArticleDetail } from "./ArticleDetail";
import type { NewsItem, ArticleResponse } from "./news-types";
import { TestWrapper } from "../../test/test-utils";

vi.mock("./SentimentBadge", () => ({
  SentimentBadge: ({ sentiment }: { sentiment?: string }) => (
    <div data-testid="sentiment-badge">{sentiment}</div>
  ),
}));

vi.mock("./ImpactScore", () => ({
  ImpactScore: ({ score }: { score?: number }) => <div data-testid="impact-score">{score}</div>,
}));

vi.mock("./TradeIdeaCard", () => ({
  TradeIdeaCard: ({ idea }: { idea: any }) =>
    idea ? <div data-testid="trade-idea">{idea.symbol}</div> : null,
}));

describe("ArticleDetail", () => {
  const mockNewsItem: NewsItem = {
    id: "1",
    headline: "Test Article Headline",
    description: "Test description",
    source: "Reuters",
    sourceUrl: "https://example.com/article",
    publishedAt: "2025-01-01T10:00:00Z",
    fetchedAt: "2025-01-01T10:00:00Z",
    symbols: [],
  };

  const mockArticleContent: ArticleResponse = {
    summary: "Test summary",
    key_points: ["Point 1", "Point 2"],
    sentiment: "Bullish",
    impact_score: 8,
    symbols: [{ code: "RELIANCE", name: "Reliance Industries", instrument_key: "NSE:RELIANCE" }],
    trade_ideas: [{ symbol: "RELIANCE", direction: "LONG", reasoning: "Strong support" }],
    description: "Full article description here.",
    publishedAt: "2025-01-01T10:00:00Z",
  };

  const defaultProps = {
    selectedArticle: mockNewsItem,
    articleContent: mockArticleContent,
    articleLoading: false,
    isMobile: false,
    showFullContent: false,
    onClose: vi.fn(),
    onToggleFullContent: vi.fn(),
    onSymbolClick: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("rendering", () => {
    it("renders empty state when no article selected", () => {
      render(<ArticleDetail {...defaultProps} selectedArticle={null} />, { wrapper: TestWrapper });
      expect(screen.getByTestId("article-detail")).toBeInTheDocument();
    });

    it("renders article title when article is selected", () => {
      render(<ArticleDetail {...defaultProps} />, { wrapper: TestWrapper });
      expect(screen.getByTestId("article-title")).toHaveTextContent("Test Article Headline");
    });

    it("renders source badge", () => {
      render(<ArticleDetail {...defaultProps} />, { wrapper: TestWrapper });
      expect(screen.getByText("Reuters")).toBeInTheDocument();
    });

    it("renders sentiment badge when present", () => {
      render(<ArticleDetail {...defaultProps} />, { wrapper: TestWrapper });
      expect(screen.getByTestId("sentiment-badge")).toHaveTextContent("Bullish");
    });

    it("renders impact score when present", () => {
      render(<ArticleDetail {...defaultProps} />, { wrapper: TestWrapper });
      expect(screen.getByTestId("impact-score")).toHaveTextContent("8");
    });

    it("renders summary when present", () => {
      render(<ArticleDetail {...defaultProps} />, { wrapper: TestWrapper });
      expect(screen.getByText("Test summary")).toBeInTheDocument();
    });

    it("renders key points when present", () => {
      render(<ArticleDetail {...defaultProps} />, { wrapper: TestWrapper });
      expect(screen.getByText("Key Takeaways")).toBeInTheDocument();
    });

    it("renders loading state", () => {
      render(<ArticleDetail {...defaultProps} articleLoading={true} />, { wrapper: TestWrapper });
      expect(screen.getByText("Analyzing article...")).toBeInTheDocument();
    });

    it("renders external link when sourceUrl is present", () => {
      render(<ArticleDetail {...defaultProps} />, { wrapper: TestWrapper });
      expect(screen.getByText("Open Original")).toBeInTheDocument();
    });
  });

  describe("callbacks", () => {
    it("accepts onClose callback", () => {
      const onClose = vi.fn();
      render(<ArticleDetail {...defaultProps} onClose={onClose} />, { wrapper: TestWrapper });
      expect(onClose).not.toHaveBeenCalled();
    });

    it("accepts onToggleFullContent callback", () => {
      const onToggleFullContent = vi.fn();
      render(<ArticleDetail {...defaultProps} onToggleFullContent={onToggleFullContent} />, {
        wrapper: TestWrapper,
      });
      expect(onToggleFullContent).not.toHaveBeenCalled();
    });

    it("accepts onSymbolClick callback", () => {
      const onSymbolClick = vi.fn();
      render(<ArticleDetail {...defaultProps} onSymbolClick={onSymbolClick} />, {
        wrapper: TestWrapper,
      });
      expect(onSymbolClick).not.toHaveBeenCalled();
    });

    it("handles undefined onClose gracefully", () => {
      const { container } = render(<ArticleDetail {...defaultProps} onClose={undefined as any} />, {
        wrapper: TestWrapper,
      });
      expect(container).toBeInTheDocument();
    });

    it("handles undefined onToggleFullContent gracefully", () => {
      const { container } = render(
        <ArticleDetail {...defaultProps} onToggleFullContent={undefined as any} />,
        { wrapper: TestWrapper },
      );
      expect(container).toBeInTheDocument();
    });

    it("handles undefined onSymbolClick gracefully", () => {
      const { container } = render(
        <ArticleDetail {...defaultProps} onSymbolClick={undefined as any} />,
        { wrapper: TestWrapper },
      );
      expect(container).toBeInTheDocument();
    });
  });

  describe("edge cases", () => {
    it("renders with undefined selectedArticle", () => {
      const { container } = render(
        <ArticleDetail {...defaultProps} selectedArticle={undefined as any} />,
        { wrapper: TestWrapper },
      );
      expect(container).toBeInTheDocument();
    });

    it("renders with undefined articleContent", () => {
      render(
        <ArticleDetail
          {...defaultProps}
          articleContent={undefined as any}
          selectedArticle={mockNewsItem}
        />,
        { wrapper: TestWrapper },
      );
      expect(screen.getByTestId("article-title")).toHaveTextContent("Test Article Headline");
    });

    it("renders with null articleContent", () => {
      render(
        <ArticleDetail
          {...defaultProps}
          articleContent={null as any}
          selectedArticle={mockNewsItem}
        />,
        { wrapper: TestWrapper },
      );
      expect(screen.getByTestId("article-title")).toHaveTextContent("Test Article Headline");
    });

    it("renders with empty symbols array", () => {
      render(
        <ArticleDetail {...defaultProps} articleContent={{ ...mockArticleContent, symbols: [] }} />,
        { wrapper: TestWrapper },
      );
      expect(screen.getByTestId("article-detail")).toBeInTheDocument();
    });

    it("renders with empty trade_ideas array", () => {
      render(
        <ArticleDetail
          {...defaultProps}
          articleContent={{ ...mockArticleContent, trade_ideas: [] }}
        />,
        { wrapper: TestWrapper },
      );
      expect(screen.getByTestId("article-detail")).toBeInTheDocument();
    });

    it("renders with empty key_points array", () => {
      render(
        <ArticleDetail
          {...defaultProps}
          articleContent={{ ...mockArticleContent, key_points: [] }}
        />,
        { wrapper: TestWrapper },
      );
      expect(screen.getByTestId("article-detail")).toBeInTheDocument();
    });

    it("renders with undefined summary", () => {
      render(
        <ArticleDetail
          {...defaultProps}
          articleContent={{ ...mockArticleContent, summary: undefined as any }}
        />,
        { wrapper: TestWrapper },
      );
      expect(screen.getByTestId("article-detail")).toBeInTheDocument();
    });

    it("renders with undefined description", () => {
      const { container } = render(
        <ArticleDetail
          {...defaultProps}
          articleContent={{ ...mockArticleContent, description: undefined as any } as any}
          selectedArticle={null}
        />,
        { wrapper: TestWrapper },
      );
      expect(container).toBeInTheDocument();
    });

    it("renders with null sourceUrl", () => {
      render(
        <ArticleDetail
          {...defaultProps}
          selectedArticle={{ ...mockNewsItem, sourceUrl: null as any }}
        />,
        { wrapper: TestWrapper },
      );
      expect(screen.queryByText("Open Original")).not.toBeInTheDocument();
    });

    it("renders with null sentiment in content", () => {
      render(
        <ArticleDetail
          {...defaultProps}
          articleContent={{ ...mockArticleContent, sentiment: null as any }}
        />,
        { wrapper: TestWrapper },
      );
      expect(screen.queryByTestId("sentiment-badge")).not.toBeInTheDocument();
    });

    it("renders with zero impact_score", () => {
      render(
        <ArticleDetail
          {...defaultProps}
          articleContent={{ ...mockArticleContent, impact_score: 0 }}
        />,
        { wrapper: TestWrapper },
      );
      expect(screen.getByTestId("impact-score")).toHaveTextContent("0");
    });

    it("shows close button on mobile when isMobile is true", () => {
      render(<ArticleDetail {...defaultProps} isMobile={true} />, { wrapper: TestWrapper });
      expect(screen.getByTestId("close-article-btn")).toBeInTheDocument();
    });

    it("hides close button on desktop when isMobile is false", () => {
      render(<ArticleDetail {...defaultProps} isMobile={false} />, { wrapper: TestWrapper });
      expect(screen.queryByTestId("close-article-btn")).not.toBeInTheDocument();
    });

    it("calls onClose when close button is clicked on mobile", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<ArticleDetail {...defaultProps} isMobile={true} onClose={onClose} />, {
        wrapper: TestWrapper,
      });
      await user.click(screen.getByTestId("close-article-btn"));
      expect(onClose).toHaveBeenCalled();
    });

    it("renders toggle full content button when LLM summary exists", () => {
      render(<ArticleDetail {...defaultProps} />, { wrapper: TestWrapper });
      expect(screen.getByTestId("article-toggle-full-content-btn")).toBeInTheDocument();
    });

    it("calls onToggleFullContent when toggle button is clicked", async () => {
      const user = userEvent.setup();
      const onToggleFullContent = vi.fn();
      render(<ArticleDetail {...defaultProps} onToggleFullContent={onToggleFullContent} />, {
        wrapper: TestWrapper,
      });
      await user.click(screen.getByTestId("article-toggle-full-content-btn"));
      expect(onToggleFullContent).toHaveBeenCalled();
    });
  });
});
