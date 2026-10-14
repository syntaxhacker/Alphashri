// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { UIProvider } from "@/ui";
import * as palette from "@/ui/palette";
import type { NiftyGex, NiftyTape, NiftyTapeRow } from "@/types/niftyReport";
import {
  NiftyGammaTime,
  buildGammaChart,
  buildGammaSeries,
  formatGammaCr,
  gammaSignColor,
  gammaStats,
} from "./NiftyGammaTime";

afterEach(cleanup);

function TestWrapper({ children }: { children: React.ReactNode }) {
  return <UIProvider>{children}</UIProvider>;
}

function row(overrides?: Partial<NiftyTapeRow>): NiftyTapeRow {
  return {
    t: "2026-10-14T09:15:00+05:30",
    spot: 25750,
    call_doi: 0,
    put_doi: 0,
    net: 0,
    net_pct: 0,
    call_tick: 0,
    put_tick: 0,
    pcr_vol: 1,
    pcr_oi: 1,
    pcr_doi: 1,
    spot_flip: null,
    max_pain: 25700,
    flip: 25650,
    walls: { call: 26000, put: 25500 },
    net_gex: 5.5,
    ...overrides,
  };
}

function tape(rows: NiftyTapeRow[], overrides?: Partial<NiftyTape>): NiftyTape {
  return {
    date: "2026-10-14",
    interval_sec: 60,
    rows,
    ...overrides,
  };
}

function gex(overrides?: Partial<NiftyGex>): NiftyGex {
  return {
    strikes: [],
    netTotal: 42.123,
    regime: "long",
    topPositive: [{ strike: 26100, netGex: 12 }],
    topNegative: [{ strike: 25400, netGex: -9 }],
    zeroCross: 25680,
    ...overrides,
  };
}

describe("buildGammaSeries", () => {
  test("skips null / undefined / non-finite net_gex and preserves tape order", () => {
    const series = buildGammaSeries([
      row({ t: "09:15", net_gex: 1 }),
      row({ t: "09:16", net_gex: null }),
      row({ t: "09:17", net_gex: undefined }),
      row({ t: "09:18", net_gex: NaN }),
      row({ t: "09:19", net_gex: -2.5 }),
    ]);
    expect(series).toEqual([
      { t: "09:15", netGex: 1 },
      { t: "09:19", netGex: -2.5 },
    ]);
  });

  test("keeps the raw timestamp string untouched", () => {
    const iso = "2026-10-14T13:06:00+05:30";
    expect(buildGammaSeries([row({ t: iso, net_gex: 0 })])).toEqual([
      { t: iso, netGex: 0 },
    ]);
  });

  test("empty / absent rows yield an empty series", () => {
    expect(buildGammaSeries([])).toEqual([]);
    expect(buildGammaSeries(undefined as unknown as NiftyTapeRow[])).toEqual([]);
  });
});

describe("gammaStats fallbacks", () => {
  test("tape-only: uses the last row's gamma, flip and walls", () => {
    const rows = [
      row({
        t: "09:15",
        net_gex: 1,
        flip: 111,
        walls: { call: 1111, put: 2222 },
      }),
      row({
        t: "09:40",
        net_gex: 8.25,
        flip: 25670,
        walls: { call: 26100, put: 25400 },
      }),
    ];
    expect(gammaStats(rows, undefined, 25750)).toEqual({
      now: 8.25,
      flip: 25670,
      callWall: 26100,
      putWall: 25400,
    });
  });

  test("gex-only: falls back to the GEX snapshot when the tape is empty", () => {
    expect(gammaStats([], gex(), 25750)).toEqual({
      now: 42.123,
      flip: 25680,
      callWall: 26100,
      putWall: 25400,
    });
  });

  test("tape gamma / gex flip take precedence when both exist", () => {
    const rows = [
      row({ net_gex: 3.5, flip: 999, walls: { call: 1, put: 2 } }),
    ];
    const stats = gammaStats(rows, gex(), 25750);
    expect(stats.now).toBe(3.5); // tape gamma wins over gex.netTotal
    expect(stats.flip).toBe(25680); // gex.zeroCross wins over tape flip
    expect(stats.callWall).toBe(26100); // gex wall wins over tape wall
    expect(stats.putWall).toBe(25400);
  });

  test("neither source: every stat is null (never NaN)", () => {
    expect(gammaStats([], undefined, 25750)).toEqual({
      now: null,
      flip: null,
      callWall: null,
      putWall: null,
    });
  });

  test("a row without net_gex still contributes flip / walls", () => {
    const rows = [
      row({ net_gex: null, flip: 25400, walls: { call: 26000, put: 25100 } }),
    ];
    expect(gammaStats(rows, undefined, 25750)).toEqual({
      now: null,
      flip: 25400,
      callWall: 26000,
      putWall: 25100,
    });
  });
});

describe("buildGammaChart", () => {
  test("builds a single area series carrying the plotted values", () => {
    const series = buildGammaSeries([
      row({ t: "2026-10-14T09:15:00+05:30", net_gex: 1 }),
      row({ t: "2026-10-14T09:16:00+05:30", net_gex: -2 }),
    ]);
    const chart = buildGammaChart(series);
    expect(chart.series).toHaveLength(1);
    expect(chart.series[0].name).toBe("Net γ");
    expect(chart.series[0].points).toEqual([1, -2]);
    expect(chart.series[0].axis).toBe(0);
    expect(chart.series[0].area).toBe(true);
    expect(chart.series[0].color).toBe(palette.TERM_GAMMA);
    expect(chart.labels).toEqual(["09:15", "09:16"]);
    expect(chart.zeroLine).toBe(true);
  });

  test("empty series still produces a valid chart with one series and zeroLine", () => {
    const chart = buildGammaChart([]);
    expect(chart.series).toHaveLength(1);
    expect(chart.labels).toEqual([]);
    expect(chart.zeroLine).toBe(true);
  });

  test("sign helper still classifies the current value", () => {
    expect(gammaSignColor(-4)).toBe(palette.TERM_GAMMA_NEG);
    expect(gammaSignColor(0)).toBe(palette.TERM_GAMMA);
    expect(gammaSignColor(null)).toBe(palette.TERM_GAMMA);
  });
});

describe("formatGammaCr", () => {
  test("signs and rounds to 2 dp, dashes the absent values", () => {
    expect(formatGammaCr(5.5)).toBe("+5.50 Cr");
    expect(formatGammaCr(-2.5)).toBe("-2.50 Cr");
    expect(formatGammaCr(0)).toBe("+0.00 Cr");
    expect(formatGammaCr(null)).toBe("—");
    expect(formatGammaCr(undefined)).toBe("—");
    expect(formatGammaCr(NaN)).toBe("—");
  });
});

describe("NiftyGammaTime render", () => {
  test("renders the four stats and the chart from tape + gex", () => {
    render(
      <NiftyGammaTime
        tape={tape([row({ t: "2026-10-14T09:15:00+05:30", net_gex: 2 }), row({ t: "2026-10-14T09:16:00+05:30", net_gex: 5.5 })])}
        gex={gex()}
        spot={25750}
      />,
      { wrapper: TestWrapper },
    );

    expect(screen.getByTestId("nifty-gamma-time-panel")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-gamma-now")).toHaveTextContent("+5.50 Cr");
    expect(screen.getByTestId("nifty-gamma-flip")).toHaveTextContent("25,680");
    expect(screen.getByTestId("nifty-gamma-callwall")).toHaveTextContent("26,100");
    expect(screen.getByTestId("nifty-gamma-putwall")).toHaveTextContent("25,400");

    expect(screen.getByTestId("nifty-gamma-time-chart")).toBeInTheDocument();
    const chart = screen.getByTestId("nifty-gamma-time-chart");
    expect(chart.querySelector("svg")).toBeInTheDocument();
    expect(screen.queryByTestId("nifty-gamma-time-empty")).not.toBeInTheDocument();
  });

  test("tape-only (no gex) still resolves stats from the last row", () => {
    render(
      <NiftyGammaTime
        tape={tape([row({ net_gex: -3.25, flip: 25500, walls: { call: 25900, put: 25200 } })])}
        spot={25750}
      />,
      { wrapper: TestWrapper },
    );
    expect(screen.getByTestId("nifty-gamma-now")).toHaveTextContent("-3.25 Cr");
    expect(screen.getByTestId("nifty-gamma-flip")).toHaveTextContent("25,500");
    expect(screen.getByTestId("nifty-gamma-callwall")).toHaveTextContent("25,900");
    expect(screen.getByTestId("nifty-gamma-putwall")).toHaveTextContent("25,200");
  });

  test("shows the empty state and dashes when no row carries net_gex", () => {
    render(
      <NiftyGammaTime tape={tape([row({ net_gex: null })])} spot={25750} />,
      { wrapper: TestWrapper },
    );
    expect(screen.getByTestId("nifty-gamma-time-panel")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-gamma-time-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("nifty-gamma-time-chart")).not.toBeInTheDocument();
    expect(screen.getByTestId("nifty-gamma-now")).toHaveTextContent("—");
  });

  test("renders without a tape or gex without crashing", () => {
    render(<NiftyGammaTime spot={25750} />, { wrapper: TestWrapper });
    expect(screen.getByTestId("nifty-gamma-time-empty")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-gamma-flip")).toHaveTextContent("—");
    expect(screen.getByTestId("nifty-gamma-callwall")).toHaveTextContent("—");
    expect(screen.getByTestId("nifty-gamma-putwall")).toHaveTextContent("—");
  });
});
