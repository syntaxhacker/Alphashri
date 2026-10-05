// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import type { PatternHitDTO } from "@/types/chartPatterns";
import { PatternFullscreenView } from "./PatternFullscreenView";

vi.mock("./PatternTradingViewChart", () => ({
  PatternTradingViewChart: () => <div data-testid="patterns-tv-chart" />,
}));

// Native-select stub so the fullscreen TF wiring is deterministic (the real MUI
// Select needs popup interaction). Testids + onChange contracts preserved.
vi.mock("./TimeframeSelect", () => ({
  TimeframeSelect: ({ timeframes, value, onChange }: any) => {
    const source =
      (timeframes as any[]).length > 0 ? (timeframes as any[]) : [{ id: value, label: value }];
    return (
      <select
        data-testid="patterns-timeframe-select"
        aria-label="Timeframe"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {source.map((tf: any) => (
          <option key={tf.id} value={tf.id}>
            {tf.label || tf.id}
          </option>
        ))}
      </select>
    );
  },
}));

const HIT: PatternHitDTO = {
  id: 1,
  symbol: "IRCON",
  name: "IRCON International Ltd.",
  timeframe: "1D",
  pattern_id: "falling_wedge",
  pattern_name: "Falling Wedge",
  family: "reversal",
  direction: "bullish",
  status: "confirmed",
  quality: "strong",
  confidence: 78.4,
  start_date: "2026-04-26",
  end_date: "2026-09-26",
  start_price: 100,
  end_price: 112.6,
  breakout_level: 112.6,
  target: 129.6,
  stop: 102.5,
  rr: 1.7,
  bars_ago: 2,
  volume_confirmed: true,
  trendlines: [],
  notes: "Higher lows into a falling wedge.",
  last_close: 113.4,
  day_change_pct: 1.2,
  pivots: [{ t: "2026-05-04", price: 108, kind: "low" }],
};

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> });
}

describe("PatternFullscreenView", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  test("renders the TV chart and the right data panel without a level row", () => {
    r(<PatternFullscreenView opened onClose={vi.fn()} hit={HIT} candles={[]} />);

    expect(screen.getByTestId("patterns-fullscreen-modal")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-tv-chart")).toBeInTheDocument();
    expect(screen.queryByTestId("patterns-chart-legend")).toBeNull();
    expect(screen.getByTestId("patterns-fullscreen-panel")).toBeInTheDocument();

    // Meta lives in the panel; the breakout/target/stop/rr/confidence row is gone.
    expect(screen.getByTestId("patterns-status-confirmed")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-quality-strong")).toBeInTheDocument();
    expect(screen.getByText("Last close")).toBeInTheDocument();
    expect(screen.getByText("Day")).toBeInTheDocument();
    expect(screen.queryByText("Target")).toBeNull();
    expect(screen.queryByText("Stop")).toBeNull();
    expect(screen.queryByText("R:R")).toBeNull();
    expect(screen.queryByText("Confidence")).toBeNull();
  });

  test("keeps the collapsible pivot list in the panel", () => {
    r(<PatternFullscreenView opened onClose={vi.fn()} hit={HIT} candles={[]} />);
    expect(screen.getByTestId("patterns-detail-pivots")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-detail-pivots-toggle")).toBeInTheDocument();
  });

  test("renders nothing but the TV chart when no hit is selected", () => {
    r(<PatternFullscreenView opened onClose={vi.fn()} hit={null} candles={[]} />);
    expect(screen.getByTestId("patterns-tv-chart")).toBeInTheDocument();
    expect(screen.queryByTestId("patterns-fullscreen-panel")).toBeNull();
  });

  test("renders the tradingview chart with a legend above it", () => {
    const t = "2026-09-26T09:15:00+05:30";
    const candles = [{ t, o: 100, h: 115, l: 98, c: 112, v: 1000 }];
    r(
      <PatternFullscreenView
        opened
        onClose={vi.fn()}
        hit={{
          ...HIT,
          trend_lines: [
            { kind: "support", start_date: t, start_price: 98, end_date: t, end_price: 100, slope: 0, touches: 3, span_bars: 1, violations: 0 },
          ],
        }}
        candles={candles}
      />,
    );

    expect(screen.getByTestId("patterns-tv-chart")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-chart-legend")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-chart-legend-item-TLS")).toBeInTheDocument();
    // Level guides are toggleable from the legend too.
    expect(screen.getByTestId("patterns-chart-legend-item-Breakout")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-chart-legend-item-Target")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-chart-legend-item-Stop")).toBeInTheDocument();
    // Swing-pivot markers get a single toggle entry.
    expect(screen.getByTestId("patterns-chart-legend-item-Pivots")).toBeInTheDocument();
  });

  test("legend entries toggle the series on/off", () => {
    const t = "2026-09-26T09:15:00+05:30";
    const candles = [{ t, o: 100, h: 115, l: 98, c: 112, v: 1000 }];
    r(
      <PatternFullscreenView
        opened
        onClose={vi.fn()}
        hit={{
          ...HIT,
          trend_lines: [
            { kind: "support", start_date: t, start_price: 98, end_date: t, end_price: 100, slope: 0, touches: 3, span_bars: 1, violations: 0 },
          ],
        }}
        candles={candles}
      />,
    );

    const item = screen.getByTestId("patterns-chart-legend-item-TLS");
    expect(item).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(item);
    expect(screen.getByTestId("patterns-chart-legend-item-TLS")).toHaveAttribute("aria-pressed", "false");

    const target = screen.getByTestId("patterns-chart-legend-item-Target");
    expect(target).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(target);
    expect(screen.getByTestId("patterns-chart-legend-item-Target")).toHaveAttribute("aria-pressed", "false");

    const pivots = screen.getByTestId("patterns-chart-legend-item-Pivots");
    expect(pivots).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(pivots);
    expect(screen.getByTestId("patterns-chart-legend-item-Pivots")).toHaveAttribute("aria-pressed", "false");
  });

  test("renders nothing when closed", () => {
    r(<PatternFullscreenView opened={false} onClose={vi.fn()} hit={HIT} candles={[]} />);
    expect(screen.queryByTestId("patterns-fullscreen-modal")).toBeNull();
    expect(screen.queryByTestId("patterns-tv-chart")).toBeNull();
  });

  test("shows the empty state without candles", () => {
    r(<PatternFullscreenView opened onClose={vi.fn()} hit={HIT} candles={[]} />);
    expect(screen.getByText("No chart data")).toBeInTheDocument();
  });

  test("forwards onClose to the dialog close button", () => {
    const onClose = vi.fn();
    r(<PatternFullscreenView opened onClose={onClose} hit={HIT} candles={[]} />);
    fireEvent.click(screen.getByLabelText("close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("renders the title, meta, notes and last-close/day values in the panel", () => {
    r(<PatternFullscreenView opened onClose={vi.fn()} hit={HIT} candles={[]} />);
    expect(screen.getByText("IRCON · Falling Wedge")).toBeInTheDocument();
    expect(screen.getByText("IRCON · 1D · 2 bars ago")).toBeInTheDocument();
    expect(screen.getByText("Higher lows into a falling wedge.")).toBeInTheDocument();
    expect(screen.getByText(/113\.40/)).toBeInTheDocument();
    expect(screen.getByText(/1\.20%/)).toBeInTheDocument();
  });

  test("renders the timeframe selector and fires onTimeframeChange", async () => {
    const onTimeframeChange = vi.fn();
    r(
      <PatternFullscreenView
        opened
        onClose={vi.fn()}
        hit={HIT}
        candles={[]}
        timeframe="1D"
        timeframes={[
          { id: "1D", label: "1D", minutes: 1440, native: "days/1", source_tf: null, max_lookback_days: 730, min_bars: 60 },
          { id: "1h", label: "1h", minutes: 60, native: "hours/1", source_tf: null, max_lookback_days: 365, min_bars: 60 },
        ]}
        onTimeframeChange={onTimeframeChange}
      />,
    );
    const select = screen.getByTestId("patterns-fullscreen-timeframe");
    expect(select).toBeInTheDocument();
    expect(screen.getByTestId("patterns-timeframe-select")).toHaveValue("1D");
    await userEvent.selectOptions(screen.getByTestId("patterns-timeframe-select"), "1h");
    expect(onTimeframeChange).toHaveBeenCalledWith("1h");
  });

  test("shows a loader while the fullscreen timeframe reloads", () => {
    r(
      <PatternFullscreenView
        opened
        onClose={vi.fn()}
        hit={HIT}
        candles={[]}
        timeframe="1D"
        timeframes={[]}
        onTimeframeChange={vi.fn()}
        loading
      />,
    );
    expect(screen.getByTestId("patterns-fullscreen-loading")).toBeInTheDocument();
  });

  test("hides the timeframe selector when the TF props are absent", () => {
    r(<PatternFullscreenView opened onClose={vi.fn()} hit={HIT} candles={[]} />);
    expect(screen.queryByTestId("patterns-fullscreen-timeframe")).not.toBeInTheDocument();

    cleanup();
    // onTimeframeChange without a timeframe: still hidden.
    r(
      <PatternFullscreenView
        opened
        onClose={vi.fn()}
        hit={HIT}
        candles={[]}
        onTimeframeChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("patterns-fullscreen-timeframe")).not.toBeInTheDocument();

    cleanup();
    // timeframe without a handler: still hidden.
    r(
      <PatternFullscreenView opened onClose={vi.fn()} hit={HIT} candles={[]} timeframe="1D" />,
    );
    expect(screen.queryByTestId("patterns-fullscreen-timeframe")).not.toBeInTheDocument();
  });
});
