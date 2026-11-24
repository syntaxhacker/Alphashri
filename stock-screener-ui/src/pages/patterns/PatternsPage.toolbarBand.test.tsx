// @vitest-environment happy-dom
// Harness first: its vi.mock registrations must run before PatternsPage loads.
import { makeProps, r, resetToolbarHarness, testHooks } from "./PatternsPage.mainHarness";
import { PatternsPage } from "./PatternsPage";

const { afterEach, beforeEach, describe, expect, test, cleanup, screen } = testHooks;

describe("PatternsPage toolbar layout", () => {
  beforeEach(resetToolbarHarness);
  afterEach(() => cleanup());

  test("the band never wraps and every control is one height", () => {
    r(() => <PatternsPage {...makeProps()} />);
    const results = screen.getByTestId("patterns-results-view-toolbar");
    const band = results.parentElement;
    expect(band?.className).toContain("flex-nowrap");
    expect(screen.getByTestId("patterns-results-toolbar").className).toContain("flex-nowrap");
    expect(screen.getByTestId("patterns-open-filters")).toHaveStyle({ height: "30px" });
    expect(screen.getByTestId("patterns-overflow")).toHaveStyle({
      width: "30px",
      height: "30px",
    });
  });
});
