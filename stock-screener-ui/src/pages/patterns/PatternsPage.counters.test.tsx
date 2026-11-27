// @vitest-environment happy-dom
// Harness first: its vi.mock registrations must run before PatternsPage loads.
import { makeProps, r, resetHarness, testHooks } from "./PatternsPage.mainHarness";
import { PatternsPage } from "./PatternsPage";

const { afterEach, beforeEach, describe, expect, test, cleanup, screen } = testHooks;

describe("PatternsPage", () => {
  beforeEach(resetHarness);
  afterEach(() => cleanup());

  test("renders the live counters on the tab row instead of a second band", () => {
    r(() => <PatternsPage {...makeProps()} />);
    const tabList = screen.getByTestId("patterns-tab-list");
    const stats = screen.getByTestId("patterns-stats");
    const panel = screen.getByTestId("patterns-panel-scan");
    expect(tabList.parentElement).toBe(stats.parentElement?.parentElement);
    expect(panel).not.toContainElement(stats);
    // The wrapper owns the single bottom rule; the list's own rule is zeroed.
    const band = tabList.parentElement as HTMLElement;
    expect(band.className).toContain("border-b");
    expect(tabList.getAttribute("style")).toContain("border-bottom-width: 0px");
  });
});
