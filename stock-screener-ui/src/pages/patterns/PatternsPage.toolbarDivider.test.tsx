// @vitest-environment happy-dom
// Harness first: its vi.mock registrations must run before PatternsPage loads.
import { makeProps, r, resetToolbarHarness, testHooks } from "./PatternsPage.mainHarness";
import { PatternsPage } from "./PatternsPage";

const { afterEach, beforeEach, describe, expect, test, cleanup, screen, within } = testHooks;

describe("PatternsPage toolbar layout", () => {
  beforeEach(resetToolbarHarness);
  afterEach(() => cleanup());

  test("one divider separates scan setup from the scan toggles", () => {
    r(() => <PatternsPage {...makeProps()} />);
    const toolbar = screen.getByTestId("patterns-results-toolbar");
    expect(within(toolbar).getAllByRole("separator")).toHaveLength(1);
    expect(within(toolbar).getByTestId("patterns-replay-toggle")).toBeInTheDocument();
  });
});
