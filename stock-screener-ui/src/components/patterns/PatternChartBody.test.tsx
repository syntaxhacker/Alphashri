// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/patterns/solidUiMock");
  return mockSolidUi();
});
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import type { ChartCandle, PatternHitDTO } from "@/types/chartPatterns";
import { createSignal } from "solid-js";
import { PatternChartBody } from "./PatternChartBody";

// The TV chart mounts lightweight-charts (canvas) — stub it so the body can be
// tested without a browser canvas, while still asserting the props forwarded.
vi.mock("./PatternTradingViewChart", () => ({
  PatternTradingViewChart: ({
    hit,
    candles,
  }: {
    hit: PatternHitDTO | null;
    candles: ChartCandle[];
  }) => (
    <div
      data-testid="pattern-tv-stub"
      data-hit-symbol={hit?.symbol ?? "null"}
      data-candle-count={String(candles.length)}
    />
  ),
}));

// Stub the sibling history list so the body can assert that onSelectHit is
// forwarded with the selected hit payload and that the history slice changes.
vi.mock("./FullscreenPatternList", () => {
  const FullscreenPatternList = ({
    hits,
    onSelect,
  }: {
    hits: PatternHitDTO[];
    onSelect?: (hit: PatternHitDTO) => void;
  }) => (
    <div
      data-testid="patterns-fullscreen-list-stub"
      data-count={String(hits.length)}
      onClick={() => onSelect?.(hits[0])}
      role="button"
      tabIndex={0}
    >
      {hits.map((h) => h.symbol).join(", ")}
    </div>
  );
  return { FullscreenPatternList, fullscreenHitKey: vi.fn(() => "hk-1") };
});

const CANDLES: ChartCandle[] = [
  { t: "2026-09-25", o: 100, h: 105, l: 99, c: 102, v: 1000 },
  { t: "2026-09-26", o: 102, h: 106, l: 101, c: 104, v: 1200 },
];

const HIT: PatternHitDTO = {
  id: 7,
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
  trend_lines: [],
  notes: "Breakout above ₹112.60 on volume",
  last_close: 120,
  day_change_pct: 2.5,
  pivots: [
    { t: "2026-05-04", price: 102.5, kind: "low" },
    { t: "2026-05-20", price: 112.6, kind: "high" },
  ],
};


describe("PatternChartBody", () => {
  afterEach(() => cleanup());

  test("default render (no hit): body, history control, empty TV, no chart data", () => {
    render(() => <PatternChartBody hit={null} candles={[]} />);
    expect(screen.getByTestId("patterns-chart-body")).toBeInTheDocument();
    const history = screen.getByTestId("patterns-history-count");
    expect(history).toBeInTheDocument();
    expect(within(history).getByRole("button", { name: "3" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "5" })).toBeInTheDocument();
    const tv = screen.getByTestId("pattern-tv-stub");
    expect(tv).toHaveAttribute("data-hit-symbol", "null");
    expect(tv).toHaveAttribute("data-candle-count", "0");
    expect(screen.getByText("No chart data")).toBeInTheDocument();
    expect(screen.queryByTestId("patterns-fullscreen-panel")).toBeNull();
    expect(screen.queryByTestId("patterns-fullscreen-asof-banner")).toBeNull();
  });

  test("as-of banner renders the local datetime and is absent when null/empty", () => {
    const [asOf, setAsOf] = createSignal<string | null>("2026-09-26T14:30:00");
    render(() => <PatternChartBody hit={null} candles={[]} asOf={asOf()} />);
    expect(screen.getByTestId("patterns-fullscreen-asof-banner")).toHaveTextContent(
      "Viewing as of 2026-09-26 14:30:00",
    );
    setAsOf(null);
    expect(screen.queryByTestId("patterns-fullscreen-asof-banner")).toBeNull();
    setAsOf("");
    expect(screen.queryByTestId("patterns-fullscreen-asof-banner")).toBeNull();
  });

  test("hit present: meta panel with status, quality, last close and day change", () => {
    render(() => <PatternChartBody hit={HIT} candles={CANDLES} />);
    const panel = screen.getByTestId("patterns-fullscreen-panel");
    expect(panel).toBeInTheDocument();
    expect(screen.getByText("IRCON · 1D · 2 bars ago")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-status-confirmed")).toHaveTextContent("Confirmed");
    expect(screen.getByTestId("patterns-quality-strong")).toBeInTheDocument();
    expect(screen.getByText("₹120.00")).toBeInTheDocument();
    expect(screen.getByText("+2.50%")).toBeInTheDocument();
    expect(screen.getByText("Breakout above ₹112.60 on volume")).toBeInTheDocument();
    expect(screen.getByTestId("pattern-tv-stub")).toHaveAttribute("data-candle-count", "2");
    expect(screen.queryByText("No chart data")).toBeNull();
  });

  test("emptyState renders when there is no hit", () => {
    render(() => <PatternChartBody hit={null} candles={[]} emptyState={<div data-testid="panel-empty">No pattern selected</div>} />);
    expect(screen.getByTestId("panel-empty")).toHaveTextContent("No pattern selected");
    expect(screen.queryByTestId("patterns-fullscreen-panel")).toBeNull();
  });

  test("history segmented control toggles between 1/3/5", () => {
    const hits: PatternHitDTO[] = [1, 2, 3].map((n) => ({
      ...HIT,
      id: n,
      end_date: `2026-09-${String(27 - n).padStart(2, "0")}`,
      pattern_id: `pattern_${n}`,
      symbol: `SYM${n}`,
    }));
    render(() => <PatternChartBody hit={HIT} hits={hits} onSelectHit={vi.fn()} candles={CANDLES} />);
    const box = screen.getByTestId("patterns-history-count");
    expect(within(box).getByRole("button", { name: "3" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(within(box).getByRole("button", { name: "5" }));
    expect(within(box).getByRole("button", { name: "5" })).toHaveAttribute("aria-pressed", "true");
    expect(within(box).getByRole("button", { name: "3" })).toHaveAttribute("aria-pressed", "false");
  });

  test("clicking the history list calls onSelectHit with the selected hit payload", () => {
    const hits: PatternHitDTO[] = [
      { ...HIT, id: 1, end_date: "2026-09-26", pattern_id: "a", symbol: "AAA" },
      { ...HIT, id: 2, end_date: "2026-09-25", pattern_id: "b", symbol: "BBB" },
    ];
    const onSelectHit = vi.fn();
    render(() => <PatternChartBody hit={HIT} hits={hits} onSelectHit={onSelectHit} candles={CANDLES} />);
    fireEvent.click(screen.getByTestId("patterns-fullscreen-list-stub"));
    expect(onSelectHit).toHaveBeenCalledTimes(1);
    expect(onSelectHit).toHaveBeenCalledWith(hits[0]);
    expect(onSelectHit).toHaveBeenCalledWith(expect.objectContaining({ symbol: "AAA" }));
  });
});
