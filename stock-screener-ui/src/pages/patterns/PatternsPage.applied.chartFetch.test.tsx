// @vitest-environment happy-dom
// Harness first: its vi.mock registrations must run before PatternsPage loads.
import {
  fetchSymbolChart,
  getHarnessState,
  makeProps,
  r,
  resetHarness,
  testHooks,
} from "./PatternsPage.appliedHarness";
import { PatternsPage } from "./PatternsPage";

const { afterEach, beforeEach, describe, expect, test, cleanup, fireEvent, screen } = testHooks;

describe("PatternsPage chart fetch + view-only trendlines", () => {
  beforeEach(resetHarness);
  afterEach(() => cleanup());

  test("opening a card opts the chart fetch out of trendline computation when TLS/TLR is off", async () => {
    r(() => <PatternsPage {...makeProps({ computeTrendlines: false })} />);
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    fireEvent.click(screen.getByTestId("patterns-card-IRCON-falling_wedge"));
    expect(await screen.findByTestId("patterns-fullscreen-modal")).toBeInTheDocument();
    expect(fetchSymbolChart).toHaveBeenCalledWith(
      "IRCON",
      "1D",
      expect.objectContaining({ computeTrendlines: false }),
    );
  });

  test("opening a card forwards computeTrendlines when TLS/TLR is on", async () => {
    r(() => <PatternsPage {...makeProps({ computeTrendlines: true, lookbackBars: 250 })} />);
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    fireEvent.click(screen.getByTestId("patterns-card-IRCON-falling_wedge"));
    expect(await screen.findByTestId("patterns-fullscreen-modal")).toBeInTheDocument();
    expect(fetchSymbolChart).toHaveBeenCalledWith(
      "IRCON",
      "1D",
      { detectPatterns: false, lookbackBars: 250, computeTrendlines: true },
    );
  });

  test("view-only trendlines filter flows through when computation stays on", async () => {
    r(() =>
      <PatternsPage
        {...makeProps({
          computeTrendlines: true,
          filters: { ...makeProps().filters, trendlines: "support" },
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    expect(getHarnessState().gridTrendlinesViews.at(-1)).toBe("support");
  });
});
