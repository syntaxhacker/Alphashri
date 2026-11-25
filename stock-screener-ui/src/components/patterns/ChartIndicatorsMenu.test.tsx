// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/test-utils/solidUiMock");
  const { typeSize } = await import("@/ui/typography");
  return { ...mockSolidUi(), typeSize };
});

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import type { ChartIndicators, SRZone } from "@/types/chartPatterns";
import type { ChartIndicatorId } from "@/config/chartIndicators";
import { ChartIndicatorsMenu } from "./ChartIndicatorsMenu";
import {
  __resetChartIndicatorPrefsForTests,
  chartIndicatorPrefs,
  setChartIndicator,
} from "@/state/chartIndicators";

function indicators(overrides: Partial<ChartIndicators> = {}): ChartIndicators {
  return {
    aligned: "candles",
    timeframe: "5m",
    session: "2026-11-25",
    partial_last: false,
    series: [
      { id: "sma20", values: [100, 101] },
      { id: "sma50", values: [99, 100] },
      { id: "sma200", values: [90, 91] },
      { id: "bbUpper", values: [110, 111] },
      { id: "bbMiddle", values: [105, 106] },
      { id: "bbLower", values: [100, 101] },
      { id: "vwap", values: [101, 102] },
    ],
    crosses: [{ t: "2026-11-25T09:30:00+05:30", kind: "golden" }],
    ...overrides,
  };
}

const ZONES: SRZone[] = [
  {
    kind: "support",
    top: 101,
    bottom: 99,
    start_date: "2026-11-01",
    end_date: "2026-11-25",
    touches: 3,
    score: 0.8,
  },
  {
    kind: "resistance",
    top: 112,
    bottom: 110,
    start_date: "2026-11-02",
    end_date: "2026-11-25",
    touches: 2,
    score: 0.7,
  },
];

describe("ChartIndicatorsMenu", () => {
  beforeEach(() => __resetChartIndicatorPrefsForTests());
  afterEach(() => {
    cleanup();
    __resetChartIndicatorPrefsForTests();
  });

  test("wide trigger shows the label and active count; compact hides only the word", () => {
    const wide = render(() => (
      <ChartIndicatorsMenu timeframe="5m" candleCount={300} indicators={indicators()} />
    ));
    const trigger = screen.getByTestId("patterns-chart-indicators-trigger");
    expect(trigger).toHaveTextContent("Indicators");
    expect(screen.getByTestId("patterns-chart-indicators-count")).toHaveTextContent("1");
    expect(trigger).toHaveStyle({ height: "28px" });
    wide.unmount();

    render(() => (
      <ChartIndicatorsMenu compact timeframe="5m" candleCount={300} indicators={indicators()} />
    ));
    const compact = screen.getByTestId("patterns-chart-indicators-trigger");
    expect(compact).not.toHaveTextContent("Indicators");
    expect(compact).toHaveAttribute("aria-label", "Indicators (1 active)");
    expect(screen.getByTestId("patterns-chart-indicators-count")).toHaveTextContent("1");
  });

  test("compact trigger exposes visible 1 / 6 / 0 active states", () => {
    render(() => (
      <ChartIndicatorsMenu
        compact
        timeframe="1D"
        candleCount={300}
        indicators={indicators()}
        srZones={ZONES}
      />
    ));
    const count = () => screen.getByTestId("patterns-chart-indicators-count");

    expect(count()).toHaveTextContent("1");

    for (const id of ["sma50", "sma200", "vwap", "bb", "crosses", "srZones"] as const) {
      setChartIndicator(id, true);
    }
    // VWAP is unavailable on 1D, so all-on tops out at six drawable rows.
    expect(count()).toHaveTextContent("6");

    for (const id of ["sma20", "sma50", "sma200", "vwap", "bb", "crosses", "srZones"] as const) {
      setChartIndicator(id, false);
    }
    expect(count()).toHaveTextContent("0");
  });

  test("drawable presentIndicatorIds override a partial/empty payload", () => {
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
    const present = new Set<ChartIndicatorId>([
      "sma20",
      "sma50",
      "sma200",
      "bb",
      "crosses",
      "srZones",
    ]);
    render(() => (
      <ChartIndicatorsMenu
        timeframe="1D"
        candleCount={250}
        indicators={indicators({ series: [], crosses: [] })}
        srZones={[]}
        presentIndicatorIds={present}
      />
    ));
    expect(screen.getByTestId("patterns-chart-indicators-count")).toHaveTextContent("6");
    expect(screen.getByTestId("patterns-chart-indicators-trigger")).toHaveAttribute(
      "aria-label",
      "Indicators (6 active)",
    );
  });

  test("popover groups MAs, Studies, Signals and Zones with native checkbox rows", () => {
    render(() => (
      <ChartIndicatorsMenu
        timeframe="5m"
        candleCount={300}
        indicators={indicators()}
        srZones={ZONES}
      />
    ));
    fireEvent.click(screen.getByTestId("patterns-chart-indicators-trigger"));
    const popover = screen.getByTestId("patterns-chart-indicators-popover");
    expect(popover).toHaveAttribute("role", "dialog");
    expect(popover).toHaveStyle({ width: "260px" });
    expect(popover.style.maxHeight).toContain("420px");
    expect(screen.getByTestId("chart-indicators-group-mas")).toHaveTextContent("MAs");
    expect(screen.getByTestId("chart-indicators-group-studies")).toHaveTextContent("Studies");
    expect(screen.getByTestId("chart-indicators-group-signals")).toHaveTextContent("Signals");
    expect(screen.getByTestId("chart-indicators-group-zones")).toHaveTextContent("Zones");

    for (const id of ["sma20", "sma50", "sma200", "vwap", "bb", "crosses", "srZones"]) {
      expect(screen.getByTestId(`chart-indicator-${id}`)).toHaveAttribute("type", "checkbox");
    }
    expect(screen.getByText("BB 20,2")).toBeInTheDocument();
    expect(screen.getByText("Crosses 50/200")).toBeInTheDocument();
    expect(screen.getByText("Historical reaction zones, not forecasts")).toBeInTheDocument();
    expect(screen.getByTestId("chart-indicator-zones-count")).toHaveTextContent("2 zones");
  });

  test("VWAP is disabled with 'Intraday only' on daily frames and enabled on 5m", () => {
    const view = render(() => (
      <ChartIndicatorsMenu timeframe="1D" candleCount={300} indicators={indicators()} />
    ));
    fireEvent.click(screen.getByTestId("patterns-chart-indicators-trigger"));
    expect(screen.getByTestId("chart-indicator-vwap")).toBeDisabled();
    expect(screen.getByTestId("chart-indicator-vwap-reason")).toHaveTextContent("Intraday only");
    view.unmount();
    cleanup();

    render(() => (
      <ChartIndicatorsMenu timeframe="5m" candleCount={300} indicators={indicators()} />
    ));
    fireEvent.click(screen.getByTestId("patterns-chart-indicators-trigger"));
    expect(screen.getByTestId("chart-indicator-vwap")).toBeEnabled();
    expect(screen.queryByTestId("chart-indicator-vwap-reason")).toBeNull();
  });

  test("VWAP checkbox matches the drawable state while its preference survives a timeframe switch", () => {
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
    const [timeframe, setTimeframe] = createSignal<"1m" | "1D">("1m");
    render(() => (
      <ChartIndicatorsMenu
        timeframe={timeframe()}
        candleCount={300}
        indicators={indicators({ timeframe: "1m" })}
        srZones={ZONES}
      />
    ));
    fireEvent.click(screen.getByTestId("patterns-chart-indicators-trigger"));
    const vwap = () => screen.getByTestId("chart-indicator-vwap");

    expect(vwap()).toBeChecked();
    expect(screen.getByTestId("patterns-chart-indicators-count")).toHaveTextContent("7");

    setTimeframe("1D");
    expect(vwap()).not.toBeChecked();
    expect(vwap()).toBeDisabled();
    expect(screen.getByTestId("chart-indicator-vwap-reason")).toHaveTextContent("Intraday only");
    expect(chartIndicatorPrefs().vwap).toBe(true);
    expect(screen.getByTestId("patterns-chart-indicators-count")).toHaveTextContent("6");

    setTimeframe("1m");
    expect(vwap()).toBeChecked();
    expect(screen.getByTestId("patterns-chart-indicators-count")).toHaveTextContent("7");
  });

  test("a lone stored VWAP preference shows no active count on a daily frame", () => {
    setChartIndicator("sma20", false);
    setChartIndicator("vwap", true);
    const [timeframe, setTimeframe] = createSignal<"1m" | "1D">("1m");
    render(() => (
      <ChartIndicatorsMenu
        timeframe={timeframe()}
        candleCount={300}
        indicators={indicators({ timeframe: "1m" })}
      />
    ));
    expect(screen.getByTestId("patterns-chart-indicators-count")).toHaveTextContent("1");

    setTimeframe("1D");
    expect(screen.getByTestId("patterns-chart-indicators-count")).toHaveTextContent("0");
    fireEvent.click(screen.getByTestId("patterns-chart-indicators-trigger"));
    expect(screen.getByTestId("chart-indicator-vwap")).not.toBeChecked();
    expect(screen.getByTestId("chart-indicator-vwap")).toBeDisabled();
  });

  test("the zone badge counts drawable zones, not the raw payload", () => {
    setChartIndicator("srZones", true);
    render(() => (
      <ChartIndicatorsMenu
        timeframe="5m"
        candleCount={300}
        indicators={indicators()}
        srZones={ZONES}
        presentIndicatorIds={new Set<ChartIndicatorId>(["sma20"])}
        drawableZoneCount={0}
      />
    ));
    expect(screen.getByTestId("patterns-chart-indicators-count")).toHaveTextContent("1");

    fireEvent.click(screen.getByTestId("patterns-chart-indicators-trigger"));
    expect(screen.getByTestId("chart-indicator-srZones-reason")).toHaveTextContent("No zones");
    expect(screen.queryByTestId("chart-indicator-zones-count")).toBeNull();
  });

  test("SMA200 disables below 200 candles and absent payload rows say 'No data'", () => {
    render(() => (
      <ChartIndicatorsMenu
        timeframe="1D"
        candleCount={199}
        indicators={indicators({ series: [] })}
      />
    ));
    fireEvent.click(screen.getByTestId("patterns-chart-indicators-trigger"));
    expect(screen.getByTestId("chart-indicator-sma200")).toBeDisabled();
    expect(screen.getByTestId("chart-indicator-sma200-reason")).toHaveTextContent("Needs 200 bars");
    expect(screen.getByTestId("chart-indicator-sma20")).toBeDisabled();
    expect(screen.getByTestId("chart-indicator-sma20-reason")).toHaveTextContent("No data");
  });

  test("toggles persist in the session store and a dirty menu offers reset", () => {
    render(() => (
      <ChartIndicatorsMenu timeframe="5m" candleCount={300} indicators={indicators()} />
    ));
    fireEvent.click(screen.getByTestId("patterns-chart-indicators-trigger"));
    expect(screen.queryByTestId("chart-indicators-reset")).toBeNull();

    fireEvent.click(screen.getByTestId("chart-indicator-sma50"));
    expect(chartIndicatorPrefs().sma50).toBe(true);
    expect(screen.getByTestId("patterns-chart-indicators-count")).toHaveTextContent("2");

    fireEvent.click(screen.getByTestId("chart-indicators-reset"));
    expect(chartIndicatorPrefs()).toEqual(
      expect.objectContaining({ sma20: true, sma50: false, sma200: false, vwap: false }),
    );
    expect(screen.queryByTestId("chart-indicators-reset")).toBeNull();
    expect(screen.getByTestId("patterns-chart-indicators-count")).toHaveTextContent("1");
  });

  test("disabled rows cannot be toggled", () => {
    setChartIndicator("vwap", false);
    render(() => (
      <ChartIndicatorsMenu timeframe="1D" candleCount={300} indicators={indicators()} />
    ));
    fireEvent.click(screen.getByTestId("patterns-chart-indicators-trigger"));
    fireEvent.click(screen.getByTestId("chart-indicator-vwap"));
    expect(chartIndicatorPrefs().vwap).toBe(false);
  });

  test("Escape closes the popover", () => {
    render(() => (
      <ChartIndicatorsMenu timeframe="5m" candleCount={300} indicators={indicators()} />
    ));
    fireEvent.click(screen.getByTestId("patterns-chart-indicators-trigger"));
    expect(screen.getByTestId("patterns-chart-indicators-popover")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("patterns-chart-indicators-popover")).toBeNull();
  });
});
