// @vitest-environment happy-dom
// Harness first: its vi.mock registrations must run before PatternsPage loads.
import {
  fetchPatternHit,
  fetchSymbolChart,
  makeHit,
  makeProps,
  r,
  resetHarness,
  testHooks,
} from "./PatternsPage.appliedHarness";
import { PatternsPage } from "./PatternsPage";

const { afterEach, beforeEach, describe, expect, test, cleanup, fireEvent, screen, waitFor } = testHooks;

describe("PatternsPage fullscreen hit resolution", () => {
  beforeEach(resetHarness);
  afterEach(() => cleanup());

  test("opening a card shows that hit and keeps a single-item pattern list", async () => {
    const cardHit = makeHit({ id: 11, pattern_id: "falling_wedge", pattern_name: "Falling Wedge", confidence: 95, end_date: "2026-08-01", bars_ago: 40 });
    r(() => <PatternsPage {...makeProps({ results: [cardHit], total: 1 })} />);
    fetchSymbolChart.mockClear();
    fetchSymbolChart.mockResolvedValueOnce({
      symbol: "IRCON",
      timeframe: "1D",
      candles: [{ t: "2026-09-26T09:15:00+05:30", o: 100, h: 115, l: 98, c: 112, v: 1000 }],
      overlays: [],
      trend_lines: [],
      hits: [],
    });

    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    fireEvent.click(screen.getByTestId("patterns-card-IRCON-falling_wedge"));
    await screen.findByTestId("patterns-fullscreen-modal");
    await waitFor(() =>
      expect(fetchSymbolChart).toHaveBeenCalledWith(
        "IRCON",
        "1D",
        expect.objectContaining({ detectPatterns: false }),
      ),
    );
    expect(fetchPatternHit).toHaveBeenCalledWith(11);
    await waitFor(() =>
      expect(screen.getByTestId("patterns-fullscreen-active-hit")).toHaveTextContent("Falling Wedge"),
    );
    expect(screen.getByTestId("patterns-fullscreen-list-item-0")).toHaveTextContent("Falling Wedge");
    expect(screen.queryByTestId("patterns-fullscreen-list-item-1")).not.toBeInTheDocument();
  });

  test("de-duplicates a stored card hit against the same live hit returned with id:null", async () => {
    const cardHit = makeHit({
      id: 34562,
      pattern_id: "ascending_channel",
      pattern_name: "Ascending Channel",
      start_date: "2026-05-21",
      end_date: "2026-09-08",
      bars_ago: 17,
    });
    r(() => <PatternsPage {...makeProps({ results: [cardHit], total: 1 })} />);
    fetchSymbolChart.mockClear();
    fetchSymbolChart.mockResolvedValueOnce({
      symbol: "IRCON",
      timeframe: "1D",
      candles: [],
      overlays: [],
      trend_lines: [],
      hits: [{ ...cardHit, id: null }],
    });

    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    fireEvent.click(screen.getByTestId("patterns-card-IRCON-ascending_channel"));
    await screen.findByTestId("patterns-fullscreen-modal");
    await waitFor(() =>
      expect(screen.getByTestId("patterns-fullscreen-active-hit")).toHaveTextContent("Ascending Channel"),
    );
    expect(screen.getByTestId("patterns-fullscreen-list-item-0")).toHaveTextContent("Ascending Channel");
    expect(screen.queryByTestId("patterns-fullscreen-list-item-1")).not.toBeInTheDocument();
  });
});
