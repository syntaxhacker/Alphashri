// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import { createSignal, type JSX } from "solid-js";
import { UIProvider } from "@/ui";
import type { NiftyFutures, NiftyFuturesRegime } from "@/types/niftyReport";
import { NiftyFuturesPanel, regimeLabel, regimeTone } from "./NiftyFuturesPanel";
import * as palette from "@/ui/palette";

const setChartOption = vi.hoisted(() => vi.fn());

vi.mock("./echartsSolid", () => ({
  createECharts: () => ({ ref: () => {}, setChartOption }),
}));

function r(node: () => JSX.Element) {
  return render(node, { wrapper: UIProvider });
}

function futures(overrides: Partial<NiftyFutures> = {}): NiftyFutures {
  return {
    symbol: "NIFTY-FUT",
    instrument_key: "NSE_FO|NIFTY26NOVFUT",
    expiry: "2026-11-26",
    series: [
      { t: "2026-11-17T09:15:00+05:30", close: 25_980.5, oi: 11_200_000, volume: 1_200 },
      { t: "2026-11-17T09:30:00+05:30", close: 25_993.1, oi: 11_480_000, volume: 900 },
    ],
    change_pts: 12.6,
    oi_change: 280_000,
    regime: "long_buildup",
    as_of: "2026-11-17T09:30:00+05:30",
    ...overrides,
  };
}

beforeEach(() => setChartOption.mockClear());

describe("NiftyFuturesPanel", () => {
  test("renders regime chip, 15m change, OI change and the last print", () => {
    r(() => <NiftyFuturesPanel futures={futures()} />);

    expect(screen.getByTestId("nifty-futures-regime")).toHaveTextContent("LONG BUILDUP");
    expect(screen.getByTestId("nifty-futures-change")).toHaveTextContent("+12.60");
    expect(screen.getByTestId("nifty-futures-oi")).toHaveTextContent("+280.00K");
    expect(screen.getByTestId("nifty-futures-last")).toHaveTextContent("25993.10");
    expect(screen.getByTestId("nifty-futures-chart")).toBeInTheDocument();
  });

  test("plots close and OI as two series on one time axis", () => {
    r(() => <NiftyFuturesPanel futures={futures()} />);

    const option = setChartOption.mock.calls.at(-1)?.[0] as {
      xAxis: { data: string[] };
      series: { name: string; data: number[]; yAxisIndex?: number }[];
    };
    expect(option.xAxis.data).toEqual(["09:15", "09:30"]);
    expect(option.series[0]).toMatchObject({ name: "close", data: [25_980.5, 25_993.1] });
    expect(option.series[1]).toMatchObject({ name: "oi", data: [11_200_000, 11_480_000] });
    expect(option.series[1].yAxisIndex).toBe(1);
  });

  test("an absent block says unavailable and paints no chart", () => {
    r(() => <NiftyFuturesPanel futures={null} />);

    expect(screen.getByTestId("nifty-futures-empty")).toHaveTextContent(
      "Futures positioning unavailable",
    );
    expect(screen.queryByTestId("nifty-futures-chart")).not.toBeInTheDocument();
    expect(setChartOption).not.toHaveBeenCalled();
  });

  test("a connected feed with no bars is not reported as missing", () => {
    r(() => <NiftyFuturesPanel futures={futures({ series: [] })} />);

    expect(screen.getByTestId("nifty-futures-empty")).toHaveTextContent(
      "Futures feed connected",
    );
    expect(screen.getByTestId("nifty-futures-regime")).toHaveTextContent("LONG BUILDUP");
  });

  test("regime labels cover every verdict and keep the side's colour", () => {
    const regimes: NiftyFuturesRegime[] = [
      "long_buildup",
      "short_buildup",
      "long_unwinding",
      "short_covering",
      "neutral",
    ];
    expect(regimes.map(regimeLabel)).toEqual([
      "LONG BUILDUP",
      "SHORT BUILDUP",
      "LONG UNWINDING",
      "SHORT COVERING",
      "NEUTRAL",
    ]);
    expect(regimeTone("short_covering")).toBe(palette.POSITIVE);
    expect(regimeTone("short_buildup")).toBe(palette.NEGATIVE);
    expect(regimeTone("neutral")).toBe(palette.TEXT_MUTED);
  });

  test("a single bordered surface — no nested card wrapper", () => {
    r(() => <NiftyFuturesPanel futures={futures()} />);

    const panel = screen.getByTestId("nifty-futures-panel");
    expect(panel).toHaveAttribute("data-compact");
    expect(panel.querySelectorAll("[data-compact]")).toHaveLength(0);
  });

  test("an identical futures frame on a poll does not rebuild the chart option", () => {
    const [frame, setFrame] = createSignal(futures());
    r(() => <NiftyFuturesPanel futures={frame()} />);
    expect(setChartOption).toHaveBeenCalledTimes(1);

    // The live poll delivers a fresh object with the same plotted series.
    setFrame(futures());
    expect(setChartOption).toHaveBeenCalledTimes(1);
  });

  test("a genuinely new bar still rebuilds the chart option", () => {
    const [frame, setFrame] = createSignal(futures());
    r(() => <NiftyFuturesPanel futures={frame()} />);
    expect(setChartOption).toHaveBeenCalledTimes(1);

    setFrame(
      futures({
        series: [
          ...futures().series,
          { t: "2026-11-17T09:45:00+05:30", close: 26_000, oi: 11_500_000, volume: 800 },
        ],
      }),
    );
    expect(setChartOption).toHaveBeenCalledTimes(2);
  });
});
