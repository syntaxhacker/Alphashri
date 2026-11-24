// @vitest-environment happy-dom
// Harness first: its vi.mock registrations must run before PatternsPage loads.
import { makeProps, r, resetToolbarHarness, testHooks } from "./PatternsPage.mainHarness";
import { PatternsPage } from "./PatternsPage";

const { afterEach, beforeEach, describe, expect, test, cleanup, screen } = testHooks;

describe("PatternsPage toolbar layout", () => {
  beforeEach(resetToolbarHarness);
  afterEach(() => cleanup());

  test("renders the scan-scope and results-toolbar contract regions", () => {
    r(() => <PatternsPage {...makeProps()} />);
    expect(screen.getByTestId("patterns-scan-scope")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-results-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-symbol-filter")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-universe-bar")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-job-status")).toBeInTheDocument();
  });
});
