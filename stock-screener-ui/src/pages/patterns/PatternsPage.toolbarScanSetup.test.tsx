// @vitest-environment happy-dom
// Harness first: its vi.mock registrations must run before PatternsPage loads.
import { makeProps, r, resetToolbarHarness, testHooks } from "./PatternsPage.mainHarness";
import { PatternsPage } from "./PatternsPage";

const { afterEach, beforeEach, describe, expect, test, cleanup, screen, within } = testHooks;

describe("PatternsPage toolbar layout", () => {
  beforeEach(resetToolbarHarness);
  afterEach(() => cleanup());

  test("scan setup group carries symbol, timeframe and bars", () => {
    r(() => <PatternsPage {...makeProps()} />);
    const scope = screen.getByTestId("patterns-scan-scope");
    expect(within(scope).getByTestId("patterns-symbol-filter")).toBeInTheDocument();
    expect(within(scope).getByTestId("patterns-timeframe-select")).toBeInTheDocument();
    expect(within(scope).getByTestId("patterns-lookback-select")).toBeInTheDocument();
  });
});
