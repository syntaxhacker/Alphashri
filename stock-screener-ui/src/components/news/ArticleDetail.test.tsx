// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
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

  it("explains the reading desk at the top of the pane instead of a blank body", () => {
    render(() => <ArticleDetail {...emptyProps} />, { wrapper: TestWrapper });

    expect(screen.getByTestId("article-empty")).toHaveTextContent("Your reading desk is ready");
    const pane = screen.getByTestId("article-detail");
    expect(pane.getAttribute("style") ?? "").toContain("justify-content: flex-start");
  });
});
