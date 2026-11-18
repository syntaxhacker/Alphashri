// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import { TestWrapper } from "../../../test/test-utils";
import type { NewsItem } from "../../news/news-types";

const newsMock = vi.hoisted(() => ({
  fetchNews: vi.fn(),
  fetchNewsSources: vi.fn(),
}));

vi.mock("../../../api/news", () => ({
  fetchNews: newsMock.fetchNews,
  fetchNewsSources: newsMock.fetchNewsSources,
  fetchArticle: vi.fn(),
}));

import { NEWS_FEED_PANEL } from "./newsFeed";

const headline: NewsItem = {
  id: "n1",
  headline: "RBI holds repo rate steady",
  description: "The central bank kept rates unchanged.",
  source: "Reuters",
  sourceUrl: "https://example.com/rbi",
  publishedAt: "2026-11-19T10:00:00Z",
  fetchedAt: "2026-11-19T10:05:00Z",
  symbols: [],
};

function renderPanel() {
  return render(
    () => NEWS_FEED_PANEL.mount(() => ({}), { data: () => undefined, commands: {} }),
    { wrapper: TestWrapper },
  );
}

describe("news.feed window panel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    newsMock.fetchNews.mockResolvedValue([headline]);
    newsMock.fetchNewsSources.mockResolvedValue([{ id: "reuters", name: "Reuters" }]);
  });

  afterEach(() => cleanup());

  test("(c) mounts the self-contained news list with a real headline from the feed", async () => {
    renderPanel();
    await waitFor(() =>
      expect(screen.getByText("RBI holds repo rate steady")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("news-feed")).toBeInTheDocument();
  });

  test("(e) a fetch failure renders its message, not a blank feed", async () => {
    newsMock.fetchNews.mockRejectedValueOnce(new Error("News service down"));
    renderPanel();
    await waitFor(() =>
      expect(screen.getByTestId("news-error")).toHaveTextContent("News service down"),
    );
  });

  test("(empty) an empty feed renders the explicit empty message", async () => {
    newsMock.fetchNews.mockResolvedValueOnce([]);
    renderPanel();
    await waitFor(() =>
      expect(screen.getByTestId("news-empty")).toHaveTextContent("No news available"),
    );
  });
});
