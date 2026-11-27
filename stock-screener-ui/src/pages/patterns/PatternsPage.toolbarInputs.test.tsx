// @vitest-environment happy-dom
// Harness first: its vi.mock registrations must run before PatternsPage loads.
import { makeProps, r, resetToolbarHarness, testHooks } from "./PatternsPage.mainHarness";
import { PatternsPage } from "./PatternsPage";

const { afterEach, beforeEach, describe, expect, test, cleanup, fireEvent, screen, waitFor } = testHooks;

describe("PatternsPage toolbar inputs", () => {
  beforeEach(resetToolbarHarness);
  afterEach(() => cleanup());

  test("changing the timeframe select calls setSelectedTimeframes", async () => {
    const props = makeProps({
      timeframes: [
        { id: "1D", label: "1D", minutes: 1440, native: true, source_tf: null, max_lookback_days: 730, min_bars: 60 },
        { id: "1h", label: "1h", minutes: 60, native: true, source_tf: null, max_lookback_days: 365, min_bars: 60 },
      ],
    });
    r(() => <PatternsPage {...props} />);
    fireEvent.click(screen.getByTestId("tf-option-1h"));
    expect(props.setSelectedTimeframes).toHaveBeenCalledWith(["1D", "1h"]);
  });

  test("shows the index group filter only for the indices universe", () => {
    const indices = r(() => <PatternsPage {...makeProps({ universe: "indices" })} />);
    expect(screen.getByTestId("patterns-index-group")).toBeInTheDocument();
    indices.unmount();
    r(() => <PatternsPage {...makeProps({ universe: "nifty500" })} />);
    expect(screen.queryByTestId("patterns-index-group")).not.toBeInTheDocument();
  });

  test("changing the lookback select calls setLookbackBars", async () => {
    const props = makeProps();
    r(() => <PatternsPage {...props} />);
    fireEvent.input(screen.getByTestId("patterns-lookback-select") as HTMLSelectElement, { target: { value: "250" } });
    expect(props.setLookbackBars).toHaveBeenCalledWith(250);
  });

  test("typing in Filter results commits the debounced q filter", async () => {
    const props = makeProps();
    r(() => <PatternsPage {...props} />);
    fireEvent.input(screen.getByTestId("patterns-results-search"), { target: { value: "TCS" } });
    await waitFor(
      () => expect(props.setFilter).toHaveBeenCalledWith("q", "TCS"),
      { timeout: 3000 },
    );
  });
});
