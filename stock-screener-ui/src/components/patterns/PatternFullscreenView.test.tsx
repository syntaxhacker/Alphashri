// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/test-utils/solidUiMock");
  const { typeSize } = await import("@/ui/typography");
  return {
    ...mockSolidUi(),
    typeSize,
    // The shared stub drops `loading`/`disabled`; the real ActionIcon forwards
    // both (spinner + disabled). Keep that contract observable here.
    ActionIcon: (props: any) => (
      <button
        type="button"
        data-testid={props["data-testid"]}
        aria-label={props["aria-label"]}
        aria-busy={props.loading ? "true" : undefined}
        disabled={Boolean(props.loading || props.disabled)}
        onClick={props.onClick}
        className={props.className}
      >
        {props.children}
      </button>
    ),
  };
});
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import type { ChartIndicators, PatternHitDTO, SRZone } from "@/types/chartPatterns";
import { PatternFullscreenView } from "./PatternFullscreenView";
import {
  __resetChartIndicatorPrefsForTests,
  setChartIndicator,
} from "@/state/chartIndicators";

afterEach(() => __resetChartIndicatorPrefsForTests());

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
          <option value={tf.id}>
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
  close_bar_date: "2026-09-26",
  pivots: [{ t: "2026-05-04", price: 108, kind: "low" }],
};


const INDICATORS: ChartIndicators = {
  aligned: "candles",
  timeframe: "5m",
  session: "2026-09-26",
  partial_last: false,
  series: [
    { id: "sma20", values: [100] },
    { id: "vwap", values: [101] },
  ],
  crosses: [],
};

const ZONES: SRZone[] = [
  {
    kind: "sr",
    top: 110,
    bottom: 108,
    start_date: "2026-09-01",
    end_date: "2026-09-26",
    touches: 5,
    score: 0.9,
  },
];

describe("PatternFullscreenView", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  test("renders the TV chart and the right data panel without a level row", () => {
    render(() => <PatternFullscreenView opened onClose={vi.fn()} hit={HIT} candles={[]} />);

    expect(screen.getByTestId("patterns-fullscreen-modal")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-tv-chart")).toBeInTheDocument();
    expect(screen.queryByTestId("patterns-chart-legend")).toBeNull();
    expect(screen.getByTestId("patterns-fullscreen-panel")).toBeInTheDocument();

    expect(screen.getByTestId("patterns-status-confirmed")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-quality-strong")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-close-label")).toBeInTheDocument();
    expect(screen.getByText(/1\.20%/)).toBeInTheDocument();
    expect(screen.queryByText("Target")).toBeNull();
    expect(screen.queryByText("Stop")).toBeNull();
    expect(screen.queryByText("R:R")).toBeNull();
    
  });

  test("livePrice/liveChange render the LTP line in both the modal and the dock", () => {
    const modal = render(() => (
      <PatternFullscreenView
        opened
        onClose={vi.fn()}
        hit={HIT}
        candles={[]}
        livePrice={2986}
        liveChange={-12.94}
      />
    ));
    expect(screen.getByTestId("patterns-ltp-line")).toHaveTextContent("₹2986.00");
    expect(screen.getByTestId("patterns-ltp-change")).toHaveTextContent("-12.94%");
    modal.unmount();
    cleanup();

    render(() => (
      <PatternFullscreenView
        opened
        docked
        onClose={vi.fn()}
        hit={HIT}
        candles={[]}
        livePrice={2986}
        liveChange={-12.94}
      />
    ));
    expect(screen.getByTestId("patterns-chart-dock")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-ltp-line")).toHaveTextContent("₹2986.00");
  });

  test("dock refresh button calls onRefresh and disables while loading", () => {
    const onRefresh = vi.fn();
    const [loading, setLoading] = createSignal(false);
    render(() => (
      <PatternFullscreenView
        opened
        docked
        onClose={vi.fn()}
        hit={HIT}
        candles={[]}
        onRefresh={onRefresh}
        loading={loading()}
      />
    ));
    const refresh = screen.getByTestId("patterns-dock-refresh");
    expect(refresh).toBeEnabled();
    fireEvent.click(refresh);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    setLoading(true);
    expect(screen.getByTestId("patterns-dock-refresh")).toBeDisabled();
    expect(screen.getByTestId("patterns-dock-refresh")).toHaveAttribute("aria-busy", "true");
  });

  test("loading with no candles does not claim there is no chart data", () => {
    render(() => (
      <PatternFullscreenView opened docked onClose={vi.fn()} hit={null} symbol="IRCON" candles={[]} loading />
    ));
    expect(screen.queryByText("No chart data")).toBeNull();
  });

  test("shows the endpoint reason when the chart has no candles", () => {
    render(() => (
      <PatternFullscreenView
        opened
        onClose={vi.fn()}
        hit={null}
        symbol="QUINTEGRA"
        candles={[]}
        chartError="no_data"
        chartNote="no candles for QUINTEGRA 1D in session 2026-11-15"
      />
    ));
    expect(screen.getByText("No chart data")).toBeInTheDocument();
    expect(screen.getByTestId("chart-empty-note")).toHaveTextContent(
      "no candles for QUINTEGRA 1D in session 2026-11-15",
    );
    expect(screen.getByTestId("chart-empty-reason")).toHaveTextContent("no_data");
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

  test("no hit: the fullscreen chart fills the width with no empty side column", () => {
    render(() => <PatternFullscreenView opened onClose={vi.fn()} hit={null} candles={[]} />);
    const column = screen.getByTestId("patterns-chart-column");
    expect(column).toHaveClass("flex-1");
    expect(column.className).not.toContain("lg:flex-[0_0_80%]");
    expect(screen.queryByTestId("patterns-chart-panel-column")).toBeNull();
  });

  test("with a hit: the fullscreen keeps the 80/20 split", () => {
    render(() => <PatternFullscreenView opened onClose={vi.fn()} hit={HIT} candles={[]} />);
    const column = screen.getByTestId("patterns-chart-column");
    expect(column.className).toContain("lg:flex-[0_0_80%]");
    expect(screen.getByTestId("patterns-chart-panel-column")).toBeInTheDocument();
  });

  test("renders the tradingview chart with a legend above it", () => {
    const t = "2026-09-26T09:15:00+05:30";
    const candles = [{ t, o: 100, h: 115, l: 98, c: 112, v: 1000 }];
    render(() =>       <PatternFullscreenView
        opened
        onClose={vi.fn()}
        hit={{
          ...HIT,
          trendlines: [[{ t, price: 100 }, { t: "2026-09-26T15:00:00+05:30", price: 112 }]],
        }}
        candles={candles}
      />);

    expect(screen.getByTestId("patterns-tv-chart")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-chart-legend")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-chart-legend-item-Falling Wedge")).toBeInTheDocument();
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
          trendlines: [[{ t, price: 100 }, { t: "2026-09-26T15:00:00+05:30", price: 112 }]],
        }}
        candles={candles}
      />);

    const item = screen.getByTestId("patterns-chart-legend-item-Falling Wedge");
    expect(item).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(item);
    expect(screen.getByTestId("patterns-chart-legend-item-Falling Wedge")).toHaveAttribute("aria-pressed", "false");

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
    expect(screen.getAllByText("IRCON").length).toBeGreaterThan(0);
    expect(screen.getByText(/2 bars ago/)).toBeInTheDocument();
    
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
          { id: "1D", label: "1D", minutes: 1440, native: true, source_tf: null, max_lookback_days: 730, min_bars: 60 },
          { id: "1h", label: "1h", minutes: 60, native: true, source_tf: null, max_lookback_days: 365, min_bars: 60 },
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
    render(() =>       <PatternFullscreenView
        opened
        onClose={vi.fn()}
        hit={HIT}
        candles={[]}
        onTimeframeChange={vi.fn()}
      />);
    expect(screen.queryByTestId("patterns-fullscreen-timeframe")).not.toBeInTheDocument();

    cleanup();
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
    expect(screen.getByTestId("patterns-fullscreen-list-item-0")).toHaveTextContent("Bull Flag");
    expect(screen.queryByTestId("patterns-fullscreen-list-item-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("patterns-fullscreen-list-item-0")).toHaveAttribute(
      "data-selected",
      "true",
    );
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

  test("forwards timeframe, indicators and srZones to the body strip", () => {
    render(() => (
      <PatternFullscreenView
        opened
        onClose={vi.fn()}
        hit={HIT}
        candles={[]}
        timeframe="5m"
        indicators={INDICATORS}
        srZones={ZONES}
      />
    ));
    fireEvent.click(screen.getByTestId("patterns-chart-indicators-trigger"));
    expect(screen.getByTestId("chart-indicator-vwap")).toBeEnabled();
    expect(screen.getByTestId("chart-indicator-zones-count")).toHaveTextContent("1 zone");
  });

  test("fullscreen all-on count matches the six drawable rows", () => {
    const candles = Array.from({ length: 250 }, (_, index) => {
      const day = new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10);
      return { t: day, o: 100, h: 101, l: 99, c: 100, v: 1000 };
    });
    const allIndicators: ChartIndicators = {
      aligned: "candles",
      timeframe: "1D",
      session: "2026-09-26",
      partial_last: false,
      series: [
        { id: "sma20", values: candles.map((_, index) => 100 + index * 0.01) },
        { id: "sma50", values: candles.map((_, index) => 99 + index * 0.01) },
        { id: "sma200", values: candles.map((_, index) => 90 + index * 0.01) },
        { id: "bbUpper", values: candles.map((_, index) => 110 + index * 0.01) },
        { id: "bbMiddle", values: candles.map((_, index) => 105 + index * 0.01) },
        { id: "bbLower", values: candles.map((_, index) => 100 + index * 0.01) },
      ],
      crosses: [{ t: candles[249]!.t, kind: "golden" }],
    };
    const zones: SRZone[] = [
      {
        ...ZONES[0]!,
        start_date: candles[0]!.t,
        end_date: candles[candles.length - 1]!.t,
      },
    ];
    for (const id of [
      "sma20",
      "sma50",
      "sma200",
      "vwap",
      "bb",
      "crosses",
      "srZones",
    ] as const) {
      setChartIndicator(id, true);
    }

    render(() => (
      <PatternFullscreenView
        opened
        onClose={vi.fn()}
        hit={HIT}
        candles={candles}
        timeframe="1D"
        indicators={allIndicators}
        srZones={zones}
      />
    ));

    // VWAP is disabled on 1D; the other six rows are drawable.
    expect(screen.getByTestId("patterns-chart-indicators-count")).toHaveTextContent("6");
    expect(screen.getByTestId("patterns-chart-indicators-trigger")).toHaveAttribute(
      "aria-label",
      "Indicators (6 active)",
    );
    const chipRow = screen.getByTestId("chart-active-indicators");
    expect(chipRow).toHaveAttribute("data-active-count", "6");
    expect(chipRow.querySelectorAll("[data-indicator]")).toHaveLength(5);
    expect(chipRow).toHaveTextContent("SMA20");
    expect(chipRow).toHaveTextContent("SMA50");
    expect(chipRow).toHaveTextContent("SMA200");
    expect(chipRow).toHaveTextContent("BB");
    expect(chipRow).toHaveTextContent("S/R");
    expect(chipRow).not.toHaveTextContent("Crosses");
    expect(chipRow.querySelector('[data-indicator="crosses"]')).toBeNull();

    // Dock and fullscreen share the same count and non-Crosses chip rail.
    cleanup();
    render(() => (
      <PatternFullscreenView
        opened
        docked
        onClose={vi.fn()}
        hit={HIT}
        candles={candles}
        timeframe="1D"
        indicators={allIndicators}
        srZones={zones}
      />
    ));
    expect(screen.getByTestId("patterns-chart-indicators-count")).toHaveTextContent("6");
    expect(screen.getByTestId("chart-active-indicators")).toHaveAttribute(
      "data-active-count",
      "6",
    );
    expect(
      screen.getByTestId("chart-active-indicators").querySelectorAll("[data-indicator]"),
    ).toHaveLength(5);
  });
});

describe("PatternFullscreenView full-chart page link", () => {
  afterEach(() => cleanup());

  test("the modal header links to the chart route with an accessible name", () => {
    render(() => (
      <PatternFullscreenView opened onClose={vi.fn()} symbol="IRCON" hit={HIT} candles={[]} />
    ));

    const link = screen.getByRole("link", { name: "Open full chart page" });
    expect(link).toHaveAttribute("href", "/chart/IRCON");
    expect(screen.getByTestId("patterns-fullscreen-modal-title")).toContainElement(link);
  });

  test("chartHrefForSymbol tags a US symbol with the provider marker", () => {
    render(() => (
      <PatternFullscreenView
        opened
        onClose={vi.fn()}
        symbol="AAPL"
        market="usa"
        hit={null}
        candles={[]}
      />
    ));
    expect(screen.getByRole("link", { name: "Open full chart page" })).toHaveAttribute(
      "href",
      "/chart/AAPL?market=usa",
    );
  });

  test("the link appears only with a symbol and only on the modal, not the dock", () => {
    render(() => <PatternFullscreenView opened onClose={vi.fn()} hit={HIT} candles={[]} />);
    expect(screen.queryByRole("link", { name: "Open full chart page" })).toBeNull();
    cleanup();

    render(() => (
      <PatternFullscreenView
        opened
        docked
        onClose={vi.fn()}
        symbol="IRCON"
        hit={HIT}
        candles={[]}
      />
    ));
    expect(screen.queryByRole("link", { name: "Open full chart page" })).toBeNull();
  });

  test("Escape pressed on the link still bubbles to the modal's dismissal path", () => {
    const onDocumentEscape = vi.fn();
    document.addEventListener("keydown", onDocumentEscape);
    render(() => (
      <PatternFullscreenView opened onClose={vi.fn()} symbol="IRCON" hit={HIT} candles={[]} />
    ));

    const link = screen.getByTestId("patterns-open-chart-page");
    expect(link).toHaveAttribute("aria-label", "Open full chart page");
    fireEvent.keyDown(link, { key: "Escape" });
    expect(onDocumentEscape).toHaveBeenCalledTimes(1);
    document.removeEventListener("keydown", onDocumentEscape);
  });

  test("the modal title row wraps its toolbar and pushes the link last at narrow widths", () => {
    render(() => (
      <PatternFullscreenView opened onClose={vi.fn()} symbol="IRCON" hit={HIT} candles={[]} />
    ));

    const title = screen.getByTestId("patterns-fullscreen-modal-title");
    const row = title.firstElementChild as HTMLElement;
    expect(row.className).toContain("max-[640px]:flex-wrap");
    expect(row.className).toContain("max-[640px]:items-start");
    expect((row.firstElementChild as HTMLElement).className).toContain("max-[640px]:basis-full");
    expect(screen.getByTestId("patterns-open-chart-page").className).toContain(
      "max-[640px]:order-last",
    );
  });
});
