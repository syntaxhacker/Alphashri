// @vitest-environment happy-dom
// Harness first: its vi.mock registrations must run before PatternsPage loads.
import {
  fetchSymbolChart,
  makeProps,
  r,
  resetHarness,
  testHooks,
} from "./PatternsPage.appliedHarness";
import { PatternsPage } from "./PatternsPage";

const { afterEach, beforeEach, describe, expect, test, cleanup, fireEvent, screen } = testHooks;

describe("PatternsPage chart fetch", () => {
  beforeEach(resetHarness);
  afterEach(() => cleanup());

  test("opening a card forwards the lookback window to the chart fetch", async () => {
    r(() => <PatternsPage {...makeProps({ lookbackBars: 250 })} />);
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    fireEvent.click(screen.getByTestId("patterns-card-IRCON-falling_wedge"));
    expect(await screen.findByTestId("patterns-fullscreen-modal")).toBeInTheDocument();
    expect(fetchSymbolChart).toHaveBeenCalledWith(
      "IRCON",
      "1D",
      { detectPatterns: false, lookbackBars: 250 },
    );
  });
});
