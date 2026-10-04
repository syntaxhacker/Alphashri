// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import type { PatternHitDTO } from "@/types/chartPatterns";
import { PatternCard } from "./PatternCard";

vi.mock("@/hooks/useECharts", () => ({
  useECharts: () => ({
    chartRef: { current: null },
    chartInstance: { current: null },
    setChartOption: vi.fn(),
  }),
}));

vi.mock("./PatternMiniChart", () => ({
  PatternMiniChart: ({ trendlinesView }: { trendlinesView?: string }) => (
    <div data-testid="mini-stub" data-trendlines-view={trendlinesView ?? "both"} />
  ),
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
  notes: "",
};

const CONSOLIDATION: PatternHitDTO = {
  ...HIT,
  symbol: "CONS",
  pattern_id: "consolidation",
  pattern_name: "Consolidation",
  family: "continuation",
  direction: "neutral",
  status: "forming",
  breakout_level: 130,
  target: 150,
  stop: 110,
  rr: 1.5,
  base_days: 120,
  range_pct: 13,
  trendlines: [
    [
      { t: "2026-01-01", price: 130 },
      { t: "2026-06-01", price: 130 },
    ],
    [
      { t: "2026-01-01", price: 100 },
      { t: "2026-06-01", price: 100 },
    ],
  ],
};

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> });
}

describe("PatternCard", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  test("renders symbol, pattern, status and levels", () => {
    r(<PatternCard hit={HIT} />);
    expect(screen.getByTestId("patterns-card-IRCON-falling_wedge")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-card")).toBeInTheDocument();
    expect(screen.getByText("Falling Wedge")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-status-confirmed")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-quality-strong")).toBeInTheDocument();
    expect(screen.getByText("1.70")).toBeInTheDocument();
    expect(screen.getByText("2 1D candles ago")).toBeInTheDocument();
  });

  test("marks the selected card with the primary border", () => {
    const { container } = r(<PatternCard hit={HIT} selected />);
    const card = container.querySelector('[data-testid="patterns-card-IRCON-falling_wedge"]');
    expect(card).not.toBeNull();
  });

  test("clicking the card passes the hit to onClick", async () => {
    const onClick = vi.fn();
    r(<PatternCard hit={HIT} onClick={onClick} />);
    await userEvent.click(screen.getByTestId("patterns-card-IRCON-falling_wedge"));
    expect(onClick).toHaveBeenCalledWith(HIT);
  });

  test("card is keyboard-operable with role=button", async () => {
    const onClick = vi.fn();
    r(<PatternCard hit={HIT} onClick={onClick} />);
    const card = screen.getByTestId("patterns-card-IRCON-falling_wedge");
    expect(card).toHaveAttribute("role", "button");
    expect(card).toHaveAttribute("tabIndex", "0");

    card.focus();
    expect(card).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledTimes(1);
    await userEvent.keyboard(" ");
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  test("card without onClick has no button role", () => {
    r(<PatternCard hit={HIT} />);
    expect(screen.getByTestId("patterns-card-IRCON-falling_wedge")).not.toHaveAttribute("role");
  });

  test("renders the base length line when base_days is present", () => {
    r(<PatternCard hit={{ ...HIT, base_days: 120, range_pct: 13 }} />);
    expect(screen.getByText("Base 120d · 13%")).toBeInTheDocument();
  });

  test("omits the base length line when base_days is absent", () => {
    r(<PatternCard hit={HIT} />);
    expect(screen.queryByText(/Base \d+d/)).toBeNull();
  });

  test("non-consolidation keeps the breakout/target/stop/rr row", () => {
    r(<PatternCard hit={HIT} />);
    expect(screen.getByText("Breakout")).toBeInTheDocument();
    expect(screen.getByText("Target")).toBeInTheDocument();
    expect(screen.getByText("Stop")).toBeInTheDocument();
    expect(screen.getByText("R:R")).toBeInTheDocument();
    expect(screen.queryByTestId("patterns-card-range-IRCON")).toBeNull();
    expect(screen.queryByTestId("patterns-card-breakout-both-IRCON")).toBeNull();
  });

  test("consolidation shows both range edges and a two-sided breakout", () => {
    r(<PatternCard hit={CONSOLIDATION} />);
    const range = screen.getByTestId("patterns-card-range-CONS");
    expect(range).toHaveTextContent("Range");
    expect(range).toHaveTextContent("₹100.00 – ₹130.00");

    const breakout = screen.getByTestId("patterns-card-breakout-both-CONS");
    expect(breakout).toHaveTextContent("↑ ₹130.00");
    expect(breakout).toHaveTextContent("↓ ₹100.00");

    // Target/Stop/R:R are omitted for consolidation.
    expect(screen.queryByText("Target")).toBeNull();
    expect(screen.queryByText("Stop")).toBeNull();
    expect(screen.queryByText("R:R")).toBeNull();
    // Base line is retained.
    expect(screen.getByText("Base 120d · 13%")).toBeInTheDocument();
  });

  test("base_days alone triggers the consolidation range layout", () => {
    // A non-consolidation id that still carries a base is treated as a range.
    r(<PatternCard hit={{ ...HIT, base_days: 60 }} />);
    const range = screen.getByTestId("patterns-card-range-IRCON");
    expect(range).toHaveTextContent("₹102.50 – ₹112.60");
    expect(screen.getByTestId("patterns-card-breakout-both-IRCON")).toHaveTextContent("↓ ₹102.50");
    expect(screen.queryByText("Target")).toBeNull();
  });

  test("consolidation range row falls back to pivot lows when trendlines are absent", () => {
    r(
      <PatternCard
        hit={{
          ...CONSOLIDATION,
          trendlines: [],
          stop: 0,
          pivots: [
            { t: "2026-02-01", price: 112, kind: "low" },
            { t: "2026-03-01", price: 105, kind: "low" },
            { t: "2026-04-01", price: 128, kind: "high" },
          ],
        }}
      />,
    );
    expect(screen.getByTestId("patterns-card-range-CONS")).toHaveTextContent("₹105.00 – ₹130.00");
  });
});

describe("PatternCard missing coverage", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  test("expand button calls onExpand without triggering onClick", async () => {
    const onClick = vi.fn();
    const onExpand = vi.fn();
    r(<PatternCard hit={HIT} onClick={onClick} onExpand={onExpand} />);
    await userEvent.click(screen.getByTestId("patterns-card-expand-IRCON-falling_wedge"));
    expect(onExpand).toHaveBeenCalledTimes(1);
    expect(onExpand).toHaveBeenCalledWith(HIT);
    expect(onClick).not.toHaveBeenCalled();
  });

  test("renders no expand button when onExpand is omitted", () => {
    r(<PatternCard hit={HIT} onClick={vi.fn()} />);
    expect(
      screen.queryByTestId("patterns-card-expand-IRCON-falling_wedge"),
    ).not.toBeInTheDocument();
  });

  test("selected card renders a different border treatment than unselected", () => {
    const selected = r(<PatternCard hit={HIT} selected />);
    const selectedCard = selected.container.querySelector(
      '[data-testid="patterns-card-IRCON-falling_wedge"]',
    );
    const plain = r(<PatternCard hit={HIT} />);
    const plainCard = plain.container.querySelector(
      '[data-testid="patterns-card-IRCON-falling_wedge"]',
    );
    expect(selectedCard).toBeInTheDocument();
    expect(plainCard).toBeInTheDocument();
    expect(selectedCard!.className).not.toBe(plainCard!.className);
  });

  test("shows the last close and signed day change", () => {
    const view = r(<PatternCard hit={{ ...HIT, last_close: 120, day_change_pct: 2.5 }} />);
    expect(view.getByText("₹120.00")).toBeInTheDocument();
    expect(view.getByText("+2.50%")).toBeInTheDocument();
  });

  test("falls back to end price and since-start change without enrichment", () => {
    const view = r(<PatternCard hit={{ ...HIT, end_price: 115.4 }} />);
    expect(view.getByText("₹115.40")).toBeInTheDocument();
    expect(view.getByText("+15.40%")).toBeInTheDocument();
  });

  test("gain and loss day-change render with different color treatments", () => {
    const gain = r(<PatternCard hit={{ ...HIT, last_close: 120, day_change_pct: 2.5 }} />);
    const gainEl = gain.getByText("+2.50%");
    gain.unmount();
    const loss = r(<PatternCard hit={{ ...HIT, last_close: 118, day_change_pct: -1.25 }} />);
    const lossEl = loss.getByText("-1.25%");
    expect(lossEl).toBeInTheDocument();
    expect(gainEl.className).not.toBe(lossEl.className);
  });

  test("uses the singular candle label when bars_ago is 1", () => {
    const view = r(<PatternCard hit={{ ...HIT, bars_ago: 1 }} />);
    expect(view.getByText("1 1D candle ago")).toBeInTheDocument();
  });

  test("trims a fractional range_pct to one decimal", () => {
    const view = r(<PatternCard hit={{ ...HIT, base_days: 45, range_pct: 13.26 }} />);
    expect(view.getByText("Base 45d · 13.3%")).toBeInTheDocument();
  });

  test("omits the range share when range_pct is absent", () => {
    const view = r(<PatternCard hit={{ ...HIT, base_days: 60 }} />);
    expect(
      view.getByTestId("patterns-card-base-IRCON-falling_wedge"),
    ).toHaveTextContent("Base 60d");
    expect(
      view.getByTestId("patterns-card-base-IRCON-falling_wedge"),
    ).not.toHaveTextContent("·");
  });

  test("forwards the default trendlinesView to the mini chart", () => {
    r(<PatternCard hit={HIT} />);
    expect(screen.getByTestId("mini-stub")).toHaveAttribute("data-trendlines-view", "both");
  });

  test("forwards a custom trendlinesView to the mini chart", () => {
    r(<PatternCard hit={HIT} trendlinesView="resistance" />);
    expect(screen.getByTestId("mini-stub")).toHaveAttribute(
      "data-trendlines-view",
      "resistance",
    );
  });
});
