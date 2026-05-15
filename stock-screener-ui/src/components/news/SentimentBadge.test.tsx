// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SentimentBadge } from "./SentimentBadge";
import { TestWrapper } from "../../test/test-utils";

describe("SentimentBadge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders bullish sentiment", () => {
    render(<SentimentBadge sentiment="Bullish" />, { wrapper: TestWrapper });
    expect(screen.getByTestId("sentiment-badge")).toBeInTheDocument();
    expect(screen.getByTestId("sentiment-badge")).toHaveTextContent("Bullish");
  });

  it("renders bearish sentiment", () => {
    render(<SentimentBadge sentiment="Bearish" />, { wrapper: TestWrapper });
    expect(screen.getByTestId("sentiment-badge")).toBeInTheDocument();
  });

  it("renders neutral sentiment", () => {
    render(<SentimentBadge sentiment="Neutral" />, { wrapper: TestWrapper });
    expect(screen.getByTestId("sentiment-badge")).toBeInTheDocument();
  });

  it("renders unknown sentiment as neutral fallback", () => {
    render(<SentimentBadge sentiment="UnknownSentiment" />, { wrapper: TestWrapper });
    expect(screen.getByTestId("sentiment-badge")).toBeInTheDocument();
  });

  it("renders nothing when sentiment is undefined", () => {
    render(<SentimentBadge sentiment={undefined} />, { wrapper: TestWrapper });
    expect(screen.queryByTestId("sentiment-badge")).not.toBeInTheDocument();
  });

  it("renders nothing when sentiment is null", () => {
    render(<SentimentBadge sentiment={null} />, { wrapper: TestWrapper });
    expect(screen.queryByTestId("sentiment-badge")).not.toBeInTheDocument();
  });
});
