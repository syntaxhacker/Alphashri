// @vitest-environment happy-dom
// Harness first: its vi.mock registrations must run before PatternsPage loads.
import { makeProps, r, resetToolbarHarness, testHooks } from "./PatternsPage.mainHarness";
import { PatternsPage } from "./PatternsPage";

const { afterEach, beforeEach, describe, expect, test, cleanup, screen } = testHooks;

describe("PatternsPage toolbar layout", () => {
  beforeEach(resetToolbarHarness);
  afterEach(() => cleanup());

  test("toolbar shows timeframe, lookback and filter-results controls", () => {
    r(() => <PatternsPage {...makeProps()} />);
    expect(screen.getByTestId("patterns-timeframe-select")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-lookback-select")).toBeInTheDocument();
    // Native input carries the testid (see TextInput htmlInput slot).
    expect(screen.getByTestId("patterns-results-search")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search results…")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-open-filters")).toHaveTextContent("Filters");
  });
});
