// @vitest-environment happy-dom
/**
 * Viewport contract for the strategy-runner route shell: the page itself never
 * scrolls; the config/stats bands stay fixed and the tab body takes the
 * remaining height with `min-h-0`.
 */
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";

vi.mock("../../api/strategyRunner", () => ({
  runStrategyRunner: vi.fn(),
}));
vi.mock("../../api/bots", () => ({
  listBots: vi.fn().mockResolvedValue([]),
}));
vi.mock("./StrategyRunnerConfig", () => ({
  StrategyRunnerConfig: () => <div data-testid="sr-config-mock" />,
}));
vi.mock("./StrategyRunnerStats", () => ({
  StrategyRunnerStats: () => <div data-testid="sr-stats-mock" />,
}));
vi.mock("./StrategyRunnerTabs", () => ({
  StrategyRunnerTabs: () => <div data-testid="sr-tabs-mock" />,
}));

import { StrategyRunnerPage } from "./StrategyRunnerPage";

afterEach(cleanup);

describe("StrategyRunnerPage viewport shell", () => {
  it("keeps the route fixed and gives the tabs the remaining height", () => {
    render(() => (
      <UIProvider>
        <StrategyRunnerPage />
      </UIProvider>
    ));

    const shell = screen.getByTestId("strategy-runner-page");
    expect(shell).toHaveClass("h-full", "min-h-0", "flex", "flex-col", "overflow-hidden");

    const tabs = screen.getByTestId("sr-tabs");
    expect(tabs).toHaveClass("flex", "min-h-0", "flex-1", "flex-col", "overflow-hidden");
  });

  it("ellipsizes the title and subtitle so the header never clips at 390", () => {
    render(() => (
      <UIProvider>
        <StrategyRunnerPage />
      </UIProvider>
    ));

    const header = screen.getByTestId("sr-header");
    expect(header).toHaveClass("flex-nowrap");

    const title = screen.getByTestId("sr-title");
    expect(title).toHaveClass("min-w-0");
    expect(title.style.textOverflow).toBe("ellipsis");
    expect(title.style.whiteSpace).toBe("nowrap");

    const subtitle = screen.getByTestId("sr-subtitle");
    expect(subtitle).toHaveClass("min-w-0", "flex-1", "whitespace-normal", "break-words");
    expect(subtitle).toHaveClass("sm:truncate", "sm:whitespace-nowrap");
    expect(subtitle.style.whiteSpace).toBe("");
  });
});
