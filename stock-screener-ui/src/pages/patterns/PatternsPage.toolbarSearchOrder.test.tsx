// @vitest-environment happy-dom
// Harness first: its vi.mock registrations must run before PatternsPage loads.
import { makeProps, r, resetToolbarHarness, testHooks } from "./PatternsPage.mainHarness";
import { PatternsPage } from "./PatternsPage";

const { afterEach, beforeEach, describe, expect, test, cleanup, screen, within } = testHooks;

describe("PatternsPage toolbar layout", () => {
  beforeEach(resetToolbarHarness);
  afterEach(() => cleanup());

  test("search sits immediately before the view toggle in the results group", () => {
    r(() => <PatternsPage {...makeProps()} />);
    const results = screen.getByTestId("patterns-results-view-toolbar");
    const ids = Array.from(results.querySelectorAll("[data-testid]")).map(
      (el) => el.getAttribute("data-testid") ?? "",
    );
    const searchAt = ids.indexOf("patterns-results-search");
    const toggleAt = ids.indexOf("patterns-view-toggle");
    expect(searchAt).toBeGreaterThanOrEqual(0);
    expect(toggleAt).toBe(searchAt + 1);
    expect(within(results).getByTestId("patterns-open-filters")).toBeInTheDocument();
  });
});
