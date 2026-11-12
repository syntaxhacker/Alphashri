// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/patterns/solidUiMock");
  return mockSolidUi();
});
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { within, cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import type { PatternHitDTO } from "@/types/chartPatterns";
import { PatternFullscreenView } from "./PatternFullscreenView";

vi.mock("./PatternTradingViewChart", () => ({
  PatternTradingViewChart: () => <div data-testid="patterns-tv-chart" />,
}));

// Native-select stub so the fullscreen TF wiring is deterministic (the real Select needs popup interaction). Testids + onChange contracts preserved.
vi.mock("./ChartTimeframeSelect", () => ({
  ChartTimeframeSelect: ({ timeframes, value, onChange }: any) => {
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


describe("PatternFullscreenView", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  test("renders the TV chart and the right data panel without a level row", () => {
    render(() => <PatternFullscreenView opened onClose={vi.fn()} hit={HIT} candles={[]} />);

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
    render(() => <PatternFullscreenView opened onClose={vi.fn()} hit={HIT} candles={[]} />);
    expect(screen.getByTestId("patterns-detail-pivots")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-detail-pivots-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-key-point-legend")).toHaveTextContent("L1 Swing low");
  });

  test("renders nothing but the TV chart when no hit is selected", () => {
    render(() => <PatternFullscreenView opened onClose={vi.fn()} hit={null} candles={[]} />);
    expect(screen.getByTestId("patterns-tv-chart")).toBeInTheDocument();
    expect(screen.queryByTestId("patterns-fullscreen-panel")).toBeNull();
  });

  test("renders the tradingview chart with a legend above it", () => {
    const t = "2026-09-26T09:15:00+05:30";
    const candles = [{ t, o: 100, h: 115, l: 98, c: 112, v: 1000 }];
    render(() =>       <PatternFullscreenView
        opened
        onClose={vi.fn()}
        hit={{
          ...HIT,
          trend_lines: [
            { kind: "support", start_date: t, start_price: 98, end_date: t, end_price: 100, slope: 0, touches: 3, span_bars: 1, violations: 0 },
          ],
        }}
        candles={candles}
      />);

    expect(screen.getByTestId("patterns-tv-chart")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-chart-legend")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-chart-legend-item-TLS")).toBeInTheDocument();
    // Risk levels and dot markers are not drawn any more.
    expect(screen.queryByTestId("patterns-chart-legend-item-Breakout")).toBeNull();
    expect(screen.queryByTestId("patterns-chart-legend-item-Target")).toBeNull();
    expect(screen.queryByTestId("patterns-chart-legend-item-Stop")).toBeNull();
    expect(screen.queryByTestId("patterns-chart-legend-item-Pivots")).toBeNull();
    expect(screen.queryByTestId("patterns-chart-legend-item-Key points")).toBeNull();
  });

  test("legend entries toggle the series on/off", () => {
    const t = "2026-09-26T09:15:00+05:30";
    const candles = [{ t, o: 100, h: 115, l: 98, c: 112, v: 1000 }];
    render(() =>       <PatternFullscreenView
        opened
        onClose={vi.fn()}
        hit={{
          ...HIT,
          trend_lines: [
            { kind: "support", start_date: t, start_price: 98, end_date: t, end_price: 100, slope: 0, touches: 3, span_bars: 1, violations: 0 },
          ],
        }}
        candles={candles}
      />);

    const item = screen.getByTestId("patterns-chart-legend-item-TLS");
    expect(item).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(item);
    expect(screen.getByTestId("patterns-chart-legend-item-TLS")).toHaveAttribute("aria-pressed", "false");

    expect(screen.queryByTestId("patterns-chart-legend-item-Target")).toBeNull();
    expect(screen.queryByTestId("patterns-chart-legend-item-Pivots")).toBeNull();
  });

  test("renders nothing when closed", () => {
    render(() => <PatternFullscreenView opened={false} onClose={vi.fn()} hit={HIT} candles={[]} />);
    expect(screen.queryByTestId("patterns-fullscreen-modal")).toBeNull();
    expect(screen.queryByTestId("patterns-tv-chart")).toBeNull();
  });

  test("shows the empty state without candles", () => {
    render(() => <PatternFullscreenView opened onClose={vi.fn()} hit={HIT} candles={[]} />);
    expect(screen.getByText("No chart data")).toBeInTheDocument();
  });

  test("forwards onClose to the dialog close button", () => {
    const onClose = vi.fn();
    render(() => <PatternFullscreenView opened onClose={onClose} hit={HIT} candles={[]} />);
    fireEvent.click(screen.getByLabelText("close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("renders the title, meta, notes and last-close/day values in the panel", () => {
    render(() => <PatternFullscreenView opened onClose={vi.fn()} hit={HIT} candles={[]} />);
    expect(screen.getByText("IRCON · Falling Wedge")).toBeInTheDocument();
    expect(screen.getByText("IRCON · 1D · 2 bars ago")).toBeInTheDocument();
    expect(screen.getByText("Higher lows into a falling wedge.")).toBeInTheDocument();
    expect(screen.getByText(/113\.40/)).toBeInTheDocument();
    expect(screen.getByText(/1\.20%/)).toBeInTheDocument();
  });

  test("renders the timeframe selector and fires onTimeframeChange", async () => {
    const onTimeframeChange = vi.fn();
    render(() =>       <PatternFullscreenView
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
      />);
    const select = screen.getByTestId("patterns-fullscreen-timeframe");
    expect(select).toBeInTheDocument();
    expect(screen.getByTestId("patterns-timeframe-select")).toHaveValue("1D");
    await fireEvent.change(screen.getByTestId("patterns-timeframe-select"), { target: { value: "1h" } });
    expect(onTimeframeChange).toHaveBeenCalledWith("1h");
  });

  test("shows a loader while the fullscreen timeframe reloads", () => {
    render(() =>       <PatternFullscreenView
        opened
        onClose={vi.fn()}
        hit={HIT}
        candles={[]}
        timeframe="1D"
        timeframes={[]}
        onTimeframeChange={vi.fn()}
        loading
      />);
    expect(screen.getByTestId("patterns-fullscreen-loading")).toBeInTheDocument();
  });

  test("hides the timeframe selector when the TF props are absent", () => {
    render(() => <PatternFullscreenView opened onClose={vi.fn()} hit={HIT} candles={[]} />);
    expect(screen.queryByTestId("patterns-fullscreen-timeframe")).not.toBeInTheDocument();

    cleanup();
    // onTimeframeChange without a timeframe: still hidden.
    render(() =>       <PatternFullscreenView
        opened
        onClose={vi.fn()}
        hit={HIT}
        candles={[]}
        onTimeframeChange={vi.fn()}
      />);
    expect(screen.queryByTestId("patterns-fullscreen-timeframe")).not.toBeInTheDocument();

    cleanup();
    // timeframe without a handler: still hidden.
    render(() =>       <PatternFullscreenView opened onClose={vi.fn()} hit={HIT} candles={[]} timeframe="1D" />,
    );
    expect(screen.queryByTestId("patterns-fullscreen-timeframe")).not.toBeInTheDocument();
  });

  test("omits the patterns list when hits/onSelectHit are absent", () => {
    render(() => <PatternFullscreenView opened onClose={vi.fn()} hit={HIT} candles={[]} />);
    expect(screen.queryByTestId("patterns-fullscreen-list")).not.toBeInTheDocument();
  });
});

describe("PatternFullscreenView patterns list (single-select)", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  const OLD: PatternHitDTO = {
    ...HIT,
    id: 11,
    pattern_id: "falling_wedge",
    pattern_name: "Falling Wedge",
    end_date: "2026-08-01",
    bars_ago: 40,
    confidence: 95,
  };
  const NEW: PatternHitDTO = {
    ...HIT,
    id: 33,
    pattern_id: "bull_flag",
    pattern_name: "Bull Flag",
    end_date: "2026-09-26",
    bars_ago: 2,
    confidence: 70,
  };

  test("renders the list newest-first above the active-pattern meta", () => {
    render(() =>       <PatternFullscreenView
        opened
        onClose={vi.fn()}
        hit={NEW}
        hits={[OLD, NEW]}
        onSelectHit={vi.fn()}
        candles={[]}
      />);
    expect(screen.getByTestId("patterns-fullscreen-list")).toBeInTheDocument();
    expect(screen.getByText("Patterns (1)")).toBeInTheDocument();
    // Only the newest pattern is listed.
    expect(screen.getByTestId("patterns-fullscreen-list-item-0")).toHaveTextContent("Bull Flag");
    expect(screen.queryByTestId("patterns-fullscreen-list-item-1")).not.toBeInTheDocument();
    // The newest (active) row is selected…
    expect(screen.getByTestId("patterns-fullscreen-list-item-0")).toHaveAttribute(
      "data-selected",
      "true",
    );
    // …while the active-pattern meta below still shows the hit.
    expect(screen.getByTestId("patterns-fullscreen-panel")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-detail-pivots")).toBeInTheDocument();
  });

  test("docked variant renders the rail beside the results, not a modal", async () => {
    const onClose = vi.fn();
    const onMaximize = vi.fn();
    render(() =>       <PatternFullscreenView
        opened
        docked
        onClose={onClose}
        onMaximize={onMaximize}
        hit={HIT}
        candles={[]}
      />);

    expect(screen.getByTestId("patterns-chart-dock")).toBeInTheDocument();
    expect(screen.queryByTestId("patterns-fullscreen-modal")).toBeNull();
    expect(screen.getByTestId("patterns-chart-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-fullscreen-panel")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-tv-chart")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("patterns-chart-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("patterns-chart-expand"));
    expect(onMaximize).toHaveBeenCalledTimes(1);
  });

  test("docked variant renders the prev/next stepper with a position label", async () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(() =>       <PatternFullscreenView
        opened
        docked
        onClose={vi.fn()}
        onPrev={onPrev}
        onNext={onNext}
        positionLabel="3 / 48"
        hit={HIT}
        candles={[]}
      />);
    expect(screen.getByTestId("patterns-chart-position")).toHaveTextContent("3 / 48");
    fireEvent.click(screen.getByTestId("patterns-chart-prev"));
    fireEvent.click(screen.getByTestId("patterns-chart-next"));
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  test("the modal keeps the prev/next stepper when maximized", () => {
    render(() =>       <PatternFullscreenView
        opened
        onClose={vi.fn()}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        positionLabel="2 / 9"
        hit={HIT}
        candles={[]}
      />);
    expect(screen.getByTestId("patterns-fullscreen-modal")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-chart-position")).toHaveTextContent("2 / 9");
    expect(screen.getByTestId("patterns-chart-prev")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-chart-next")).toBeInTheDocument();
  });

  test("docked replay shows a Live control that clears the as-of", async () => {
    const onLive = vi.fn();
    render(() =>       <PatternFullscreenView
        opened
        docked
        onClose={vi.fn()}
        asOf="2026-09-20T15:30"
        onLive={onLive}
        hit={HIT}
        candles={[]}
      />);
    fireEvent.click(screen.getByTestId("patterns-chart-live"));
    expect(onLive).toHaveBeenCalledTimes(1);
  });

  test("docked variant hides the expand control when no maximize handler is given", () => {
    render(() => <PatternFullscreenView opened docked onClose={vi.fn()} hit={HIT} candles={[]} />);
    expect(screen.getByTestId("patterns-chart-dock")).toBeInTheDocument();
    expect(screen.queryByTestId("patterns-chart-expand")).toBeNull();
  });

  test("clicking the row selects the newest hit", () => {
    const onSelectHit = vi.fn();
    render(() =>       <PatternFullscreenView
        opened
        onClose={vi.fn()}
        hit={NEW}
        hits={[OLD, NEW]}
        onSelectHit={onSelectHit}
        candles={[]}
      />);
    fireEvent.click(screen.getByTestId("patterns-fullscreen-list-item-0"));
    expect(onSelectHit).toHaveBeenCalledTimes(1);
    expect(onSelectHit).toHaveBeenCalledWith(NEW);
  });
});
