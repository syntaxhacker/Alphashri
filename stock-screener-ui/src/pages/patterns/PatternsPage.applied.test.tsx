// @vitest-environment happy-dom
// Harness first: its vi.mock registrations must run before PatternsPage loads.
import {
  makeProps,
  r,
  resetHarness,
  testHooks,
} from "./PatternsPage.appliedHarness";
import { PatternsPage } from "./PatternsPage";

const { afterEach, beforeEach, describe, expect, test, cleanup, fireEvent, screen, within } = testHooks;

describe("PatternsPage applied filters", () => {
  beforeEach(resetHarness);
  afterEach(() => cleanup());

  test("applied-filters row renders one chip per active value", () => {
    const props = makeProps({
      filters: { ...makeProps().filters, family: ["reversal"], direction: ["bullish"], quality: "strong" },
    });
    r(() => <PatternsPage {...props} />);
    expect(screen.getByTestId("patterns-applied-filters")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-applied-filter-family:reversal")).toHaveTextContent("Family: Reversal");
    expect(screen.getByTestId("patterns-applied-filter-direction:bullish")).toHaveTextContent("Direction: Bullish");
    expect(screen.getByTestId("patterns-applied-filter-quality:strong")).toBeInTheDocument();
  });

  test("applied-filters row stays mounted with a placeholder when no filters are active", () => {
    r(() => <PatternsPage {...makeProps()} />);
    const row = screen.getByTestId("patterns-applied-filters");
    expect(row).toBeInTheDocument();
    expect(row).toHaveClass("h-6");
    expect(row).toHaveTextContent("No filters");
  });

  test("removing an applied chip calls setFilter with the value dropped", async () => {
    const props = makeProps({ filters: { ...makeProps().filters, family: ["reversal"] } });
    r(() => <PatternsPage {...props} />);
    const chip = screen.getByTestId("patterns-applied-filter-family:reversal");
    fireEvent.click(
      within(chip).getByTestId("patterns-applied-filter-family:reversal-remove"),
    );
    expect(props.setFilter).toHaveBeenCalledWith("family", []);
  });

  test("Clear all in the applied row calls resetFilters", async () => {
    const props = makeProps({ filters: { ...makeProps().filters, family: ["reversal"] } });
    r(() => <PatternsPage {...props} />);
    fireEvent.click(screen.getByTestId("patterns-applied-clear-all"));
    expect(props.resetFilters).toHaveBeenCalledTimes(1);
  });
});
