// @vitest-environment happy-dom
// Harness first: its vi.mock registrations must run before PatternsPage loads.
import { makeHit, makeProps, r, resetToolbarHarness, testHooks } from "./PatternsPage.mainHarness";
import { PatternsPage } from "./PatternsPage";

const { afterEach, beforeEach, describe, expect, test, cleanup, screen, within } = testHooks;

describe("PatternsPage toolbar filter count", () => {
  beforeEach(resetToolbarHarness);
  afterEach(() => cleanup());

  test("Filters button shows the active-filter count", () => {
    const props = makeProps({
      filters: { ...makeProps().filters, family: ["reversal"], direction: ["bullish"] },
    });
    r(() => <PatternsPage {...props} />);
    expect(screen.getByTestId("patterns-open-filters")).toHaveTextContent("Filters (2)");
  });

  test("Filters button counts the score and breakout floors", () => {
    const props = makeProps({
      filters: { ...makeProps().filters, min_confidence: 70, min_breakout_score: 60 },
    });
    r(() => <PatternsPage {...props} />);
    expect(screen.getByTestId("patterns-open-filters")).toHaveTextContent("Filters (2)");
  });

  test("results toolbar drops the redundant count label (stats strip owns the count)", () => {
    r(() => <PatternsPage {...makeProps({ results: [makeHit()], total: 1 })} />);
    const toolbar = screen.getByTestId("patterns-results-toolbar");
    expect(within(toolbar).queryByText("1 patterns")).not.toBeInTheDocument();
    expect(within(toolbar).queryByText("Patterns")).not.toBeInTheDocument();
    expect(screen.getByTestId("patterns-stat-patterns")).toHaveTextContent("1");
  });

  test("Filters button counts a non-default 10d avg volume filter", () => {
    const props = makeProps({
      filters: { ...makeProps().filters, min_avg_volume_10d: 200 },
    });
    r(() => <PatternsPage {...props} />);
    expect(screen.getByTestId("patterns-open-filters")).toHaveTextContent("Filters (1)");
  });

  test("Filters button ignores the default 10d avg volume floor", () => {
    const props = makeProps({
      filters: { ...makeProps().filters, min_avg_volume_10d: 150 },
    });
    r(() => <PatternsPage {...props} />);
    expect(screen.getByTestId("patterns-open-filters")).toHaveTextContent("Filters");
    expect(screen.getByTestId("patterns-open-filters")).not.toHaveTextContent("(");
  });

  test("Filters button shows no count when filters are pristine", () => {
    r(() => <PatternsPage {...makeProps()} />);
    expect(screen.getByTestId("patterns-open-filters")).toHaveTextContent("Filters");
    expect(screen.getByTestId("patterns-open-filters")).not.toHaveTextContent("(");
  });
});
