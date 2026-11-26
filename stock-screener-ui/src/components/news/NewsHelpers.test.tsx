// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import "@testing-library/jest-dom/vitest";
import { ArticleSymbols, NewsItemCard, NewsListContent } from "./NewsHelpers";
import { TestWrapper } from "@/test-utils/renderWithProviders";
import type { NewsItem, NewsSymbol } from "./news-types";

const SOURCES = ["Reuters", "Bloomberg", "Moneycontrol", "Economic Times", "Mint", "CNBC"];

function sourceArticle(source: string): NewsItem {
  return {
    id: `id-${source}`,
    headline: `Headline ${source}`,
    description: "",
    source,
    sourceUrl: `https://example.com/${source}`,
    publishedAt: "2025-01-01T08:00:00Z",
    fetchedAt: "2025-01-01T08:00:00Z",
  };
}

function fixture() {
  const grouped: Record<string, NewsItem[]> = {};
  for (const source of SOURCES) grouped[source] = [sourceArticle(source)];
  return {
    items: SOURCES.map((source) => sourceArticle(source)),
    grouped,
  };
}

/** Stands in for `sourceNames` so the number of filter derivations is observable. */
function countedSourceNames(names: string[], counter: { calls: number }): string[] {
  return {
    filter(predicate: (value: string, index: number, array: string[]) => boolean) {
      counter.calls += 1;
      return names.filter(predicate);
    },
  } as unknown as string[];
}

describe("NewsListContent source derivation", () => {
  afterEach(() => cleanup());

  it("derives the visible source list once, not once per group and divider", () => {
    const { items, grouped } = fixture();
    const counter = { calls: 0 };
    const sourceNames = countedSourceNames(SOURCES, counter);

    render(() => (
      <NewsListContent
        loading={false}
        error={null}
        newsItems={items}
        selectedSource="all"
        sourceNames={sourceNames}
        groupedNewsItems={grouped}
        expandedSources={new Set(SOURCES)}
        readIds={new Set()}
        onToggleSource={() => {}}
        onArticleClick={() => {}}
      />
    ), { wrapper: TestWrapper });

    // <For> plus one divider <Show> per group used to re-filter the full list.
    expect(counter.calls).toBe(1);

    // Feed order, source attribution, payload and test ids survive the memo.
    const headers = SOURCES.map((source) => screen.getByTestId(`news-source-group-${source}`));
    expect(headers).toHaveLength(SOURCES.length);
    SOURCES.forEach((source, index) => {
      expect(headers[index].textContent).toContain(source);
      expect(headers[index].textContent).toContain("1 article");
    });
    const cards = screen.getAllByTestId("news-item");
    expect(cards).toHaveLength(SOURCES.length);
    SOURCES.forEach((source, index) => {
      expect(cards[index].getAttribute("aria-label")).toBe(`Headline ${source}`);
    });
  });

  it("does not re-filter sources on an unrelated expansion tick", () => {
    const { items, grouped } = fixture();
    const counter = { calls: 0 };
    const sourceNames = countedSourceNames(SOURCES, counter);
    const [expanded, setExpanded] = createSignal(new Set(SOURCES));

    render(() => (
      <NewsListContent
        loading={false}
        error={null}
        newsItems={items}
        selectedSource="all"
        sourceNames={sourceNames}
        groupedNewsItems={grouped}
        expandedSources={expanded()}
        readIds={new Set()}
        onToggleSource={() => {}}
        onArticleClick={() => {}}
      />
    ), { wrapper: TestWrapper });

    expect(counter.calls).toBe(1);
    setExpanded(new Set());
    expect(counter.calls).toBe(1);
  });

  it("normalizes the selected source id the same way as the feed filter", () => {
    const { items, grouped } = fixture();
    const counter = { calls: 0 };
    const sourceNames = countedSourceNames(SOURCES, counter);

    render(() => (
      <NewsListContent
        loading={false}
        error={null}
        newsItems={items}
        selectedSource="economic-times"
        sourceNames={sourceNames}
        groupedNewsItems={grouped}
        expandedSources={new Set(SOURCES)}
        readIds={new Set()}
        onToggleSource={() => {}}
        onArticleClick={() => {}}
      />
    ), { wrapper: TestWrapper });

    expect(counter.calls).toBe(1);
    expect(screen.getByTestId("news-source-group-Economic Times")).toBeInTheDocument();
    expect(screen.queryByTestId("news-source-group-Reuters")).not.toBeInTheDocument();
  });
});

describe("ArticleSymbols", () => {
  afterEach(() => cleanup());

  const symbol: NewsSymbol = {
    name: "Reliance Industries",
    code: "RELIANCE",
    url: "https://example.com/reliance",
    trading_symbol: "RELIANCE",
    instrument_key: "NSE_EQ|INE002A01018",
  };

  it("renders a focusable button that activates with click and Enter/Space", async () => {
    const onSymbolClick = vi.fn();
    render(
      () => <ArticleSymbols symbols={[symbol]} onSymbolClick={onSymbolClick} />,
      { wrapper: TestWrapper },
    );

    const badge = screen.getByTestId("news-symbol-RELIANCE");
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

describe("NewsItemCard headline", () => {
  afterEach(() => cleanup());

  it("clamps a long desk headline to two wrapping lines with an ellipsis", () => {
    const headline = "Reliance Industries hits all-time high on strong Q3 results and guidance";
    const { container } = render(
      () => (
        <NewsItemCard
          item={{ ...sourceArticle("Moneycontrol"), headline }}
          isUnread={false}
          variant="desk"
          onClick={() => {}}
        />
      ),
      { wrapper: TestWrapper },
    );

    const headlineEl = container.querySelector(".news-item-headline") as HTMLElement;
    expect(headlineEl).toBeInTheDocument();
    const style = headlineEl.getAttribute("style") ?? "";
    expect(style).toMatch(/-webkit-line-clamp:\s*2/);
    expect(style).toContain("-webkit-box");
    expect(style).not.toMatch(/white-space:\s*nowrap/);
    expect(style).toMatch(/overflow-wrap:\s*anywhere/);
  });
});
