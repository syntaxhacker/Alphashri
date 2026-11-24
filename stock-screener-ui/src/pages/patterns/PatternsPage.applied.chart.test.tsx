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

describe("PatternsPage chart + trendlines", () => {
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
      computeTrendlines: true,
    });
  });

  test("grid + fullscreen default to the both trendlines view when computing", async () => {
    r(() => <PatternsPage {...makeProps({ computeTrendlines: true })} />);
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    expect(getHarnessState().gridTrendlinesViews.at(-1)).toBe("both");
    expect(screen.getByTestId("patterns-grid")).toHaveAttribute("data-trendlines-view", "both");
  });

  test("TLS/TLR toggle off passes trendlinesView=none to grid and fullscreen", async () => {
    r(() => <PatternsPage {...makeProps({ computeTrendlines: false })} />);
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    expect(getHarnessState().gridTrendlinesViews.at(-1)).toBe("none");
    expect(screen.getByTestId("patterns-grid")).toHaveAttribute("data-trendlines-view", "none");
    fireEvent.click(screen.getByTestId("patterns-card-IRCON-falling_wedge"));
    expect(await screen.findByTestId("patterns-fullscreen-modal")).toHaveAttribute(
      "data-trendlines-view",
      "none",
    );
    expect(getHarnessState().fullscreenTrendlinesViews.at(-1)).toBe("none");
  });
});
