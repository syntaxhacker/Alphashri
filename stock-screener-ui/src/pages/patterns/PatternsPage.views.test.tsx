// @vitest-environment happy-dom
// Harness first: its vi.mock registrations must run before PatternsPage loads.
import {
  fetchPatternMatrix,
  makeHit,
  makeProps,
  r,
  resetHarness,
  testHooks,
} from "./PatternsPage.mainHarness";
import { PatternsPage } from "./PatternsPage";

const { afterEach, beforeEach, describe, expect, test, cleanup, fireEvent, screen } = testHooks;

describe("PatternsPage views", () => {
  beforeEach(resetHarness);
  afterEach(() => cleanup());

  test("view toggle switches between the dense list and the card grid", async () => {
    r(() => <PatternsPage {...makeProps()} />);
    expect(screen.getByTestId("patterns-list")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    expect(await screen.findByTestId("patterns-grid")).toBeInTheDocument();
    expect(screen.queryByTestId("patterns-list")).not.toBeInTheDocument();
    expect(screen.getByTestId("patterns-card-IRCON-falling_wedge")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    expect(await screen.findByTestId("patterns-list")).toBeInTheDocument();
    expect(screen.queryByTestId("patterns-grid")).not.toBeInTheDocument();
  });

  test("matrix view is the default and renders one row per symbol", async () => {
    fetchPatternMatrix.mockResolvedValue({
      universe: "nifty500",
      timeframes: ["5m", "1D"],
      rows: [
        {
          symbol: "IRCON",
          name: "IRCON International",
          ltp: 110,
          day_change_pct: 1.25,
          timeframes: {
            "1D": {
              direction: "bullish",
              status: "confirmed",
              count: 1,
              confidence: 80,
              patterns: ["Falling Wedge"],
              best_id: 1,
            },
          },
          hits: [makeHit()],
          best: makeHit(),
          hit_count: 1,
        },
      ],
      data_through: "2026-09-30",
    });
    r(() => <PatternsPage {...makeProps({ defaultView: "matrix" })} />);
    expect(await screen.findByTestId("patterns-symbol-matrix")).toBeInTheDocument();
    expect(await screen.findByTestId("matrix-row-IRCON")).toBeInTheDocument();
    expect(screen.getByTestId("matrix-timeframes")).toHaveTextContent("1D");
    expect(screen.queryByTestId("patterns-list")).not.toBeInTheDocument();
  });

  test("matrix row click opens the fullscreen chart", async () => {
    fetchPatternMatrix.mockResolvedValue({
      universe: "nifty500",
      timeframes: ["1D"],
      rows: [
        {
          symbol: "IRCON",
          name: null,
          ltp: 110,
          day_change_pct: null,
          timeframes: {},
          hits: [makeHit()],
          best: makeHit(),
          hit_count: 1,
        },
      ],
      data_through: null,
    });
    r(() => <PatternsPage {...makeProps({ defaultView: "matrix" })} />);
    fireEvent.click(await screen.findByTestId("matrix-row-IRCON"));
    expect(await screen.findByTestId("patterns-fullscreen-modal")).toBeInTheDocument();
  });
});
