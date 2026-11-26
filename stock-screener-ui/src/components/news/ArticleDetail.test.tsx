// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { ArticleDetail } from "./ArticleDetail";
import { TestWrapper } from "@/test-utils/renderWithProviders";

const emptyProps = {
  selectedArticle: null,
  articleContent: null,
  articleLoading: false,
  isMobile: false,
  showFullContent: false,
  onClose: () => {},
  onToggleFullContent: () => {},
  onSymbolClick: () => {},
};

describe("ArticleDetail empty state", () => {
  afterEach(() => cleanup());

  it("uses one terse prompt in the empty pane, not marketing copy about a reading desk", () => {
    render(() => <ArticleDetail {...emptyProps} />, { wrapper: TestWrapper });

    const empty = screen.getByTestId("article-empty");
    expect(empty).toHaveTextContent("Select a headline");
    expect(empty).not.toHaveTextContent("reading desk");
    expect(empty).not.toHaveTextContent("AI-assisted");
    const pane = screen.getByTestId("article-detail");
    expect(pane.getAttribute("style") ?? "").toContain("justify-content: flex-start");
  });
});

describe("ArticleDetail symbol badge", () => {
  afterEach(() => cleanup());

  const symbol = {
    name: "Reliance Industries",
    code: "RELIANCE",
    url: "https://example.com/reliance",
    trading_symbol: "RELIANCE",
    instrument_key: "NSE_EQ|INE002A01018",
  };

  it("is a button that activates the symbol action with mouse and keyboard", async () => {
    const onSymbolClick = vi.fn();
    render(
      () => (
        <ArticleDetail
          {...emptyProps}
          selectedArticle={{
            id: "1",
            headline: "Headline",
            description: "",
            source: "Reuters",
            sourceUrl: "https://example.com/1",
            publishedAt: "2025-01-01T10:00:00Z",
            fetchedAt: "2025-01-01T10:00:00Z",
          }}
          articleContent={{
            id: "1",
            headline: "Headline",
            description: "Body",
            source: "Reuters",
            sourceUrl: "https://example.com/1",
            publishedAt: "2025-01-01T10:00:00Z",
            fetchedAt: "2025-01-01T10:00:00Z",
            symbols: [symbol],
          }}
          onSymbolClick={onSymbolClick}
        />
      ),
      { wrapper: TestWrapper },
    );

    const badge = screen.getByTestId("symbol-badge");
    expect(badge.tagName).toBe("BUTTON");
    expect(badge).not.toHaveAttribute("aria-label");
    expect(badge).toHaveAccessibleName(/Reliance Industries/);
    expect(badge.className).toContain("focus-visible:outline");

    await fireEvent.click(badge);
    expect(onSymbolClick).toHaveBeenCalledWith(symbol);

    onSymbolClick.mockClear();
    await fireEvent.keyDown(badge, { key: "Enter" });
    expect(onSymbolClick).toHaveBeenCalledWith(symbol);

    onSymbolClick.mockClear();
    await fireEvent.keyDown(badge, { key: " " });
    expect(onSymbolClick).toHaveBeenCalledWith(symbol);
  });
});

describe("ArticleDetail filler copy", () => {
  afterEach(() => cleanup());

  const article = {
    id: "1",
    headline: "Headline",
    description: "",
    source: "Reuters",
    sourceUrl: "https://example.com/1",
    publishedAt: "2025-01-01T10:00:00Z",
    fetchedAt: "2025-01-01T10:00:00Z",
  };

  it("states a pending analysis in one terminal line and drops the dead source button", () => {
    render(
      () => (
        <ArticleDetail
          {...emptyProps}
          selectedArticle={article}
          articleContent={{ ...article, analysis_status: "failed", description: "Body" }}
        />
      ),
      { wrapper: TestWrapper },
    );

    expect(screen.getByText("ANALYSIS PENDING")).toBeInTheDocument();
    expect(screen.queryByText(/queued for analysis/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Analysis will be available/i)).not.toBeInTheDocument();
    expect(screen.queryByText("No source link")).not.toBeInTheDocument();
  });

  it("shows the signal badges without a redundant section label", () => {
    render(
      () => (
        <ArticleDetail
          {...emptyProps}
          selectedArticle={article}
          articleContent={{
            ...article,
            analysis_status: "done",
            summary: "Summary text",
            sentiment: "BULLISH",
            impact_score: 80,
          }}
        />
      ),
      { wrapper: TestWrapper },
    );

    expect(screen.queryByText("Signal snapshot")).not.toBeInTheDocument();
    expect(screen.getByTestId("article-summary")).toBeInTheDocument();
  });
});
