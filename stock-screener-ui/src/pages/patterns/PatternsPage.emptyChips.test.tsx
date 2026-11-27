// @vitest-environment happy-dom
// Harness first: its vi.mock registrations must run before PatternsPage loads.
import { makeProps, r, resetHarness, testHooks } from "./PatternsPage.mainHarness";
import { PatternsPage } from "./PatternsPage";

const { afterEach, beforeEach, describe, expect, test, cleanup, screen } = testHooks;

describe("PatternsPage", () => {
  beforeEach(resetHarness);
  afterEach(() => cleanup());

  test("empty-state filter chips and refresh chip render without ReferenceError", async () => {
    const chipProps = makeProps({
      results: [],
      total: 0,
      filters: { ...makeProps().filters, family: ["reversal"], direction: ["bullish"] },
    });
    const chipView = r(() => <PatternsPage {...chipProps} />);
    expect(screen.getByTestId("patterns-empty-relax")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-empty-relax-family:reversal")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-empty-relax-direction:bullish")).toBeInTheDocument();
    chipView.unmount();

    r(() => <PatternsPage {...makeProps({ loading: true })} />);
    expect(await screen.findByTestId("patterns-refreshing")).toBeInTheDocument();
  });
});
