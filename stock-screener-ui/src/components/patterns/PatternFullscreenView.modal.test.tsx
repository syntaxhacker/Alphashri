// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import type { PatternHitDTO, TFSpec } from "@/types/chartPatterns";
import { __resetChartIndicatorPrefsForTests } from "@/state/chartIndicators";
import { PatternFullscreenView } from "./PatternFullscreenView";

vi.mock("./PatternTradingViewChart", () => ({
  PatternTradingViewChart: () => <div data-testid="patterns-tv-chart" />,
}));

const HIT: PatternHitDTO = {
  id: 1,
  symbol: "RELIANCE",
  name: "Reliance Industries",
  timeframe: "1D",
  pattern_id: "falling_wedge",
  pattern_name: "Falling Wedge",
  family: "reversal",
  direction: "bullish",
  status: "confirmed",
  quality: "strong",
  confidence: 78,
  start_date: "2026-04-26",
  end_date: "2026-09-26",
  start_price: 100,
  end_price: 112,
  breakout_level: 112,
  target: 129,
  stop: 102,
  rr: 1.7,
  bars_ago: 2,
  volume_confirmed: true,
  trendlines: [],
  notes: "",
  pivots: [],
};

const TFS: TFSpec[] = [
  {
    id: "1D",
    label: "1D",
    minutes: 1440,
    native: true,
    source_tf: null,
    max_lookback_days: 730,
    min_bars: 60,
  },
  {
    id: "1h",
    label: "1h",
    minutes: 60,
    native: true,
    source_tf: null,
    max_lookback_days: 365,
    min_bars: 60,
  },
];

describe("real modal", () => {
  afterEach(() => {
    cleanup();
    __resetChartIndicatorPrefsForTests();
  });

  test("renders a real title, timeframe/replay controls and a 28px close button", () => {
    render(() => (
      <PatternFullscreenView
        opened
        onClose={vi.fn()}
        hit={HIT}
        candles={[]}
        timeframe="1D"
        timeframes={TFS}
        onTimeframeChange={vi.fn()}
        asOf="2026-09-20T15:30"
        fromDate="2026-09-01T09:15"
        onAsOfChange={vi.fn()}
      />
    ));
    expect(screen.getByText("RELIANCE · 1D")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-fullscreen-timeframe")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-fullscreen-asof-controls")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-fullscreen-asof-from")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-fullscreen-asof-to")).toBeInTheDocument();
    expect(screen.getByLabelText("close")).toHaveClass("size-7");
  });
});
