// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { UIProvider } from "@/ui";
import type { PatternHitDTO, SymbolDetail } from "@/types/chartPatterns";
import { PatternDetailPane } from "./PatternDetailPane";

vi.mock("@/hooks/useECharts", () => ({
  useECharts: () => ({
    chartRef: { current: null },
    chartInstance: { current: null },
    setChartOption: vi.fn(),
  }),
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
  bars_ago: 1,
  volume_confirmed: true,
  trendlines: [],
  notes: "Higher lows into resistance.",
};

const DETAIL: SymbolDetail = {
  symbol: "IRCON",
  name: "IRCON International Ltd.",
  last_close: 112.6,
  day_change_pct: 1.25,
  history_bars: 240,
  timeframes: [
    { timeframe: "1D", count: 2 },
    { timeframe: "1W", count: 1 },
  ],
  counts: { confirmed: 2, forming: 1 },
  patterns: [HIT],
};

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> });
}

describe("PatternDetailPane", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  test("prompts to select when nothing is selected", () => {
    r(<PatternDetailPane detail={null} detailChart={null} loading={false} selectedSymbol={null} />);
    expect(screen.getByTestId("patterns-detail-pane")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-detail-chart")).toBeInTheDocument();
    expect(screen.getByText(/Select a pattern/i)).toBeInTheDocument();
  });

  test("renders detail stats, chart, levels and explainer", () => {
    r(<PatternDetailPane detail={DETAIL} detailChart={null} loading={false} selectedSymbol="IRCON" />);
    const pane = screen.getByTestId("patterns-detail-pane");
    expect(pane).toHaveTextContent("IRCON International Ltd.");
    expect(pane).toHaveTextContent("240 bars");
    expect(pane).toHaveTextContent("2 C / 1 F");
    expect(screen.getByTestId("patterns-detail-chart")).toBeInTheDocument();
    expect(pane).toHaveTextContent("Falling Wedge");
    expect(screen.getByTestId("patterns-detail-explainer")).toHaveTextContent("Higher lows into resistance.");
  });

  test("shows a loading indicator without detail", () => {
    r(<PatternDetailPane detail={null} detailChart={null} loading selectedSymbol="IRCON" />);
    expect(screen.getByText(/Loading IRCON/)).toBeInTheDocument();
  });

  test("generates an explainer when notes are empty", () => {
    r(
      <PatternDetailPane
        detail={{ ...DETAIL, patterns: [{ ...HIT, notes: "" }] }}
        detailChart={null}
        loading={false}
        selectedSymbol="IRCON"
      />,
    );
    expect(screen.getByTestId("patterns-detail-explainer")).toHaveTextContent(/falling wedge/i);
    expect(screen.getByTestId("patterns-detail-explainer")).toHaveTextContent("1.70:1");
  });
});
