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

describe("PatternsPage chart", () => {
  beforeEach(resetHarness);
  afterEach(() => cleanup());

  test("expand button on a card opens the fullscreen chart", async () => {
    r(() => <PatternsPage {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    expect(screen.queryByTestId("patterns-fullscreen-modal")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("patterns-card-expand-IRCON-falling_wedge"));
    expect(await screen.findByTestId("patterns-fullscreen-modal")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-fullscreen-chart")).toBeInTheDocument();
    expect(fetchSymbolChart).toHaveBeenCalledWith("IRCON", "1D", {
      detectPatterns: false,
    });
  });
});
