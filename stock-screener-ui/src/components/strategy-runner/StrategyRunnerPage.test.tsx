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
});
