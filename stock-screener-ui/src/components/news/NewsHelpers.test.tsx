// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import "@testing-library/jest-dom/vitest";
import { NewsListContent } from "./NewsHelpers";
import { TestWrapper } from "../../test/test-utils";
import type { NewsItem } from "./news-types";

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
