// @vitest-environment happy-dom
// Harness first: its vi.mock registrations must run before PatternsPage loads.
import {
  fetchSymbolChart,
  makeHit,
  makeProps,
  r,
  resetHarness,
  testHooks,
} from "./PatternsPage.mainHarness";
import { PatternsPage } from "./PatternsPage";

const { afterEach, beforeEach, describe, expect, test, cleanup, fireEvent, screen, waitFor } = testHooks;

describe("PatternsPage chart fetch ordering", () => {
  beforeEach(resetHarness);
  afterEach(() => cleanup());

  test("stale fetches never overwrite the newer selection", async () => {
    let resolveFirst!: (v: unknown) => void;
    let resolveSecond!: (v: unknown) => void;
    fetchSymbolChart
      .mockImplementationOnce(
        () => new Promise((resolve) => { resolveFirst = resolve; }),
      )
      .mockImplementationOnce(
        () => new Promise((resolve) => { resolveSecond = resolve; }),
      );
    const first = makeHit({ id: 11, symbol: "IRCON", pattern_id: "falling_wedge", pattern_name: "Falling Wedge", start_date: "2026-04-26" });
    const second = makeHit({ id: 22, symbol: "RELIANCE", pattern_id: "rising_wedge", pattern_name: "Rising Wedge", start_date: "2026-07-01" });
    r(() => <PatternsPage {...makeProps({ results: [first, second], total: 2 })} />);
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));

    fireEvent.click(screen.getByTestId("patterns-card-IRCON-falling_wedge"));
    fireEvent.click(screen.getByTestId("patterns-card-RELIANCE-rising_wedge"));
    expect(fetchSymbolChart).toHaveBeenCalledTimes(2);

    // Current request resolves with no candles; the stale one resolves last
    // carrying candles. Without the guard the stale fetch would paint the
    // first hit's candles into the second hit's fullscreen view.
    resolveSecond({ symbol: "RELIANCE", timeframe: "1D", candles: [], overlays: [] });
    await waitFor(() =>
      expect(screen.getByTestId("patterns-fullscreen-modal")).toHaveTextContent("Rising Wedge"),
    );
    resolveFirst({
      symbol: "IRCON",
      timeframe: "1D",
      candles: [{ t: "2026-05-04T18:30:00+00:00", o: 1, h: 1, l: 1, c: 1, v: 1 }],
      overlays: [],
    });
    // Flush the stale promise chain: without the guard it would paint the
    // first hit's candles here and remove "No chart data".
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByTestId("patterns-fullscreen-modal")).toHaveTextContent("Rising Wedge");
    expect(screen.getByText("No chart data")).toBeInTheDocument();
  });
});
