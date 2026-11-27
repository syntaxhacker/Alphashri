// @vitest-environment happy-dom
// Harness first: its vi.mock registrations must run before PatternsPage loads.
import {
  fetchSymbolChart,
  getHarnessState,
  makeHit,
  makeProps,
  r,
  resetHarness,
  testHooks,
} from "./PatternsPage.appliedHarness";
import { PatternsPage } from "./PatternsPage";

const { afterEach, beforeEach, describe, expect, test, cleanup, fireEvent, screen, waitFor } = testHooks;

describe("PatternsPage fullscreen chart", () => {
  beforeEach(resetHarness);
  afterEach(() => cleanup());

  test("opening a card loads the hit's timeframe into the fullscreen selector", async () => {
    const hit = makeHit({ timeframe: "1h" });
    r(() =>
      <PatternsPage
        {...makeProps({
          timeframe: "1D",
          results: [hit],
          total: 1,
          timeframes: [
            { id: "1D", label: "1D", minutes: 1440, native: "days/1", source_tf: null, max_lookback_days: 730, min_bars: 60 },
            { id: "1h", label: "1h", minutes: 60, native: "hours/1", source_tf: null, max_lookback_days: 365, min_bars: 60 },
          ],
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    fireEvent.click(screen.getByTestId("patterns-card-IRCON-falling_wedge"));
    const select = await screen.findByTestId("patterns-fullscreen-timeframe");
    expect(select).toHaveValue("1h");
    expect(fetchSymbolChart).toHaveBeenCalledWith(
      "IRCON",
      "1h",
      expect.objectContaining({ detectPatterns: false }),
    );
  });

  test("selecting a new fullscreen timeframe re-runs detection and promotes the newest hit", async () => {
    // Newest wins over confidence: the older hit is far more confident but
    // the fullscreen must default to the newest formation.
    const oldConfident = makeHit({ id: 11, pattern_id: "falling_wedge", pattern_name: "Falling Wedge", confidence: 95, end_date: "2026-08-01", bars_ago: 40 });
    const newWeak = makeHit({ id: 22, pattern_id: "rising_wedge", pattern_name: "Rising Wedge", confidence: 60, end_date: "2026-09-28", bars_ago: 1, start_date: "2026-07-01" });
    r(() =>
      <PatternsPage
        {...makeProps({
          results: [oldConfident],
          total: 1,
          timeframes: [
            { id: "1D", label: "1D", minutes: 1440, native: "days/1", source_tf: null, max_lookback_days: 730, min_bars: 60 },
            { id: "1h", label: "1h", minutes: 60, native: "hours/1", source_tf: null, max_lookback_days: 365, min_bars: 60 },
          ],
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    fireEvent.click(screen.getByTestId("patterns-card-IRCON-falling_wedge"));
    await screen.findByTestId("patterns-fullscreen-modal");
    fetchSymbolChart.mockClear();
    // Phase 1 (candles only) then phase 2 (detection) — two-phase timeframe switch.
    fetchSymbolChart.mockResolvedValueOnce({
      symbol: "IRCON",
      timeframe: "1h",
      candles: [{ t: "2026-09-26T09:15:00+05:30", o: 100, h: 115, l: 98, c: 112, v: 1000 }],
      hits: [],
    });
    fetchSymbolChart.mockResolvedValueOnce({
      symbol: "IRCON",
      timeframe: "1h",
      candles: [{ t: "2026-09-26T09:15:00+05:30", o: 100, h: 115, l: 98, c: 112, v: 1000 }],
      overlays: [{ pattern_id: "rising_wedge", pattern_name: "Rising Wedge", trendlines: [] }],
      // Live detection returns hits stamped with the requested frame.
      hits: [{ ...oldConfident, timeframe: "1h" }, { ...newWeak, timeframe: "1h" }],
    });

    await fireEvent.change(screen.getByTestId("patterns-fullscreen-timeframe"), { target: { value: "1h" } });

    await waitFor(() =>
      expect(fetchSymbolChart).toHaveBeenCalledWith("IRCON", "1h", {
        detectPatterns: true,
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("patterns-fullscreen-active-hit")).toHaveTextContent("Rising Wedge"),
    );
    expect(screen.queryByText("No chart data")).not.toBeInTheDocument();
    // Single-pattern contract: no dashed sibling overlays reach the chart.
    expect(getHarnessState().fullscreenOverlays.at(-1)).toEqual([]);
  });

  test("a fullscreen timeframe switch with no hits clears the displayed hit", async () => {
    r(() =>
      <PatternsPage
        {...makeProps({
          timeframes: [
            { id: "1D", label: "1D", minutes: 1440, native: "days/1", source_tf: null, max_lookback_days: 730, min_bars: 60 },
            { id: "1h", label: "1h", minutes: 60, native: "hours/1", source_tf: null, max_lookback_days: 365, min_bars: 60 },
          ],
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    fireEvent.click(screen.getByTestId("patterns-card-IRCON-falling_wedge"));
    await screen.findByTestId("patterns-fullscreen-modal");
    expect(screen.getByTestId("patterns-fullscreen-modal")).toHaveTextContent("Falling Wedge");
    fetchSymbolChart.mockClear();
    // Phase 1 (candles only) then phase 2 (detection, no hits) — two-phase timeframe switch.
    fetchSymbolChart.mockResolvedValueOnce({
      symbol: "IRCON",
      timeframe: "1h",
      candles: [{ t: "2026-09-26T09:15:00+05:30", o: 100, h: 115, l: 98, c: 112, v: 1000 }],
      hits: [],
    });
    fetchSymbolChart.mockResolvedValueOnce({
      symbol: "IRCON",
      timeframe: "1h",
      candles: [{ t: "2026-09-26T09:15:00+05:30", o: 100, h: 115, l: 98, c: 112, v: 1000 }],
      overlays: [],
      hits: [],
    });

    await fireEvent.change(screen.getByTestId("patterns-fullscreen-timeframe"), { target: { value: "1h" } });

    await waitFor(() =>
      expect(fetchSymbolChart).toHaveBeenCalledWith("IRCON", "1h", {
        detectPatterns: true,
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("patterns-fullscreen-modal")).not.toHaveTextContent("Falling Wedge"),
    );
  });
});
