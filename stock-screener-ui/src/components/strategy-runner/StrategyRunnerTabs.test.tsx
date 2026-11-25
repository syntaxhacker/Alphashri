// @vitest-environment happy-dom
/**
 * Viewport contract: the strategy-runner tab body fills the space left by the
 * fixed config/stats bands and owns vertical scroll. A `min-h-[300px]` panel
 * used to push the trade log past the route's hidden overflow on short screens.
 */
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import { StrategyRunnerTabs } from "./StrategyRunnerTabs";

afterEach(cleanup);

describe("StrategyRunnerTabs scroll contract", () => {
  it("fills the remaining height and marks the active panel as the content region", () => {
    render(() => (
      <UIProvider>
        <div class="flex h-[700px] flex-col">
          <StrategyRunnerTabs trades={[]} summary={null} bots={[]} />
        </div>
      </UIProvider>
    ));

    const tabs = screen.getByTestId("sr-tabs-content");
    expect(tabs).toHaveClass("flex", "h-full", "min-h-0", "flex-col");

    const panel = document.querySelector('[role="tabpanel"]') as HTMLElement;
    expect(panel).toHaveClass("flex", "min-h-0", "flex-1", "flex-col");
    expect(panel).not.toHaveStyle({ "min-height": "300px" });
  });
});
