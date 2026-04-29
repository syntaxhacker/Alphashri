// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TradeIdeaCard } from "./TradeIdeaCard";
import type { TradeIdea } from "./news-types";
import { TestWrapper } from "../../test/test-utils";

describe("TradeIdeaCard", () => {
  const baseIdea: TradeIdea = {
    symbol: "RELIANCE",
    direction: "LONG",
    reasoning: "Strong support at 2800, expecting bounce",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders LONG trade idea", () => {
    render(<TradeIdeaCard idea={baseIdea} />, { wrapper: TestWrapper });
    expect(screen.getByTestId("trade-idea")).toBeInTheDocument();
    expect(screen.getByText("LONG")).toBeInTheDocument();
  });

  it("renders SHORT trade idea", () => {
    const shortIdea: TradeIdea = { ...baseIdea, direction: "SHORT" };
    render(<TradeIdeaCard idea={shortIdea} />, { wrapper: TestWrapper });
    expect(screen.getByText("SHORT")).toBeInTheDocument();
  });

  it("displays reasoning text", () => {
    render(<TradeIdeaCard idea={baseIdea} />, { wrapper: TestWrapper });
    expect(screen.getByText("Strong support at 2800, expecting bounce")).toBeInTheDocument();
  });

  it("handles empty reasoning", () => {
    const idea: TradeIdea = { ...baseIdea, reasoning: "" };
    render(<TradeIdeaCard idea={idea} />, { wrapper: TestWrapper });
    expect(screen.getByTestId("trade-idea")).toBeInTheDocument();
  });

  it("handles null reasoning", () => {
    const idea: TradeIdea = { ...baseIdea, reasoning: null as any };
    render(<TradeIdeaCard idea={idea} />, { wrapper: TestWrapper });
    expect(screen.getByTestId("trade-idea")).toBeInTheDocument();
  });

  it("handles null symbol", () => {
    const idea: TradeIdea = { ...baseIdea, symbol: null as any };
    render(<TradeIdeaCard idea={idea} />, { wrapper: TestWrapper });
    expect(screen.getByTestId("trade-idea")).toBeInTheDocument();
  });

  it("handles unknown direction", () => {
    const idea: TradeIdea = { ...baseIdea, direction: "UNKNOWN" as any };
    render(<TradeIdeaCard idea={idea} />, { wrapper: TestWrapper });
    expect(screen.getByTestId("trade-idea")).toBeInTheDocument();
  });

  it("handles empty idea object", () => {
    const idea: TradeIdea = { symbol: "", direction: "", reasoning: "" };
    render(<TradeIdeaCard idea={idea} />, { wrapper: TestWrapper });
    expect(screen.getByTestId("trade-idea")).toBeInTheDocument();
  });

  it("handles null idea", () => {
    render(<TradeIdeaCard idea={null as any} />, { wrapper: TestWrapper });
    expect(screen.queryByTestId("trade-idea")).not.toBeInTheDocument();
  });
});
