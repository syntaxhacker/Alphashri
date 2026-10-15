// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { UIProvider } from "@/ui";
import * as palette from "@/ui/palette";

import {
  IV_DASH,
  NiftyIvStraddle,
  buildIvSeries,
  buildIvStraddleChart,
  buildStraddleSeries,
  formatIvTime,
  realizedVolPct,
} from "./NiftyIvStraddle";
import type { NiftyRegimeBlock, NiftyTapeRow } from "@/types/niftyReport";
import type { ReplayCandle } from "@/types/replay";

afterEach(cleanup);

function TestWrapper({ children }: { children: React.ReactNode }) {
  return <UIProvider>{children}</UIProvider>;
}

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: TestWrapper });
}

function row(overrides: Partial<NiftyTapeRow> = {}): NiftyTapeRow {
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
    flip: 25700,
    walls: { call: 25800, put: 25700 },
    atm_strike: 25750,
    atm_ce_ltp: 120,
    atm_pe_ltp: 110,
    net_gex: 0,
    atm_ce_iv: 13,
    atm_pe_iv: 14,
    ...overrides,
  };
}

function candle(time: string, close: number): ReplayCandle {
  return { time, open: close, high: close, low: close, close, volume: 0 };
}

const regime: NiftyRegimeBlock = {
  verdict: "range_sell_premium",
  range_pts: 180,
  range_baseline_pts: 210,
  range_pct: 85,
  rv: 11.2,
  iv: 15.5,
  straddle_open: 200,
  straddle_now: 240,
  straddle_pct: -20,
};

describe("buildStraddleSeries", () => {
  test("sums both legs and keeps only usable positive pairs", () => {
    const series = buildStraddleSeries([
      row({ t: "09:15", atm_ce_ltp: 100, atm_pe_ltp: 100 }),
      row({ t: "09:16", atm_pe_ltp: null }),
      row({ t: "09:17", atm_ce_ltp: 0 }),
      row({ t: "09:18", atm_ce_ltp: 120, atm_pe_ltp: 30 }),
    ]);
    expect(series.map((p) => p.t)).toEqual(["09:15", "09:18"]);
    expect(series.map((p) => p.straddle)).toEqual([200, 150]);
  });

  test("empty / absent rows yield an empty series", () => {
    expect(buildStraddleSeries([])).toEqual([]);
    expect(buildStraddleSeries(undefined as unknown as NiftyTapeRow[])).toEqual([]);
  });
});

describe("buildIvSeries", () => {
  test("averages the two ATM IVs and skips rows where both are null", () => {
    const series = buildIvSeries([
      row({ t: "09:15", atm_ce_iv: 13, atm_pe_iv: 14 }),
      row({ t: "09:16", atm_ce_iv: null, atm_pe_iv: null }),
      row({ t: "09:17", atm_ce_iv: 12, atm_pe_iv: null }),
      row({ t: "09:18", atm_ce_iv: 10, atm_pe_iv: 20 }),
    ]);
    expect(series.map((p) => p.t)).toEqual(["09:15", "09:17", "09:18"]);
    expect(series[0].iv).toBeCloseTo(13.5, 10);
    // single live leg → that leg's value
    expect(series[1].iv).toBeCloseTo(12, 10);
    expect(series[2].iv).toBeCloseTo(15, 10);
  });
});

describe("realizedVolPct", () => {
  test("null until at least three closes", () => {
    expect(realizedVolPct([])).toBeNull();
    expect(realizedVolPct(undefined)).toBeNull();
    expect(realizedVolPct([candle("09:15", 100), candle("09:16", 101)])).toBeNull();
  });

  test("flat series is zero", () => {
    const flat = Array.from({ length: 5 }, (_, i) =>
      candle(`09:${15 + i}`, 100),
    );
    expect(realizedVolPct(flat)).toBe(0);
  });

  test("known alternating series matches the annualised closed form", () => {
    const closes = [100, 101, 100, 101, 100];
    const candles = closes.map((c, i) => candle(`09:${15 + i}`, c));
    // rets = +a, -a, +a, -a with a = ln(1.01); mean 0; var = 4a²/3
    const a = Math.log(1.01);
    const variance = (4 * a * a) / 3;
    const expected =
      Math.sqrt(variance) * Math.sqrt(252 * 375) * 100;
    const rounded = Math.round(expected * 100) / 100;
    const got = realizedVolPct(candles);
    expect(got).not.toBeNull();
    expect(got).toBeCloseTo(rounded, 2);
    expect(got).toBeGreaterThan(0);
  });

  test("infers 15-minute bars and scales the vol by 1/sqrt(15)", () => {
    const closes = [100, 101, 100, 101, 100];
    const oneMin = closes.map((c, i) => candle(`09:${15 + i}`, c));
    const fifteenMin = closes.map((c, i) =>
      candle(`${String(9 + Math.floor((15 + i * 15) / 60)).padStart(2, "0")}:${String(
        (15 + i * 15) % 60,
      ).padStart(2, "0")}`, c),
    );
    const vol1 = realizedVolPct(oneMin)!;
    const vol15 = realizedVolPct(fifteenMin)!;
    expect(vol1).toBeGreaterThan(0);
    expect(vol15).toBeCloseTo(vol1 / Math.sqrt(15), 1);
  });
});

describe("buildIvStraddleChart", () => {
  test("two twin-axis series aligned to the sorted time union", () => {
    const straddle = [
      { t: "09:15", straddle: 200 },
      { t: "09:16", straddle: 210 },
      { t: "09:17", straddle: 220 },
    ];
    const iv = [
      { t: "09:16", iv: 13 },
      { t: "09:17", iv: 14 },
    ];
    const chart = buildIvStraddleChart(straddle, iv);
    expect(chart.series).toHaveLength(2);
    expect(chart.series.map((s) => s.axis)).toEqual([0, 1]);
    expect(chart.series.map((s) => s.name)).toEqual(["Straddle", "ATM IV"]);
    expect(chart.series[0].color).toBe(palette.TERM_SPOT);
    expect(chart.series[1].color).toBe(palette.TERM_GAMMA);
    // union of 09:15/09:16/09:17
    expect(chart.labels).toEqual(["09:15", "09:16", "09:17"]);
    expect(chart.series[0].points).toEqual([200, 210, 220]);
    // IV has no 09:15 sample → leading null keeps alignment
    expect(chart.series[1].points).toEqual([null, 13, 14]);
  });

  test("empty inputs produce empty labels and empty point arrays without throwing", () => {
    const chart = buildIvStraddleChart([], []);
    expect(chart.labels).toEqual([]);
    expect(chart.series[0].points).toEqual([]);
    expect(chart.series[1].points).toEqual([]);
  });
});

describe("formatIvTime", () => {
  test("ISO and bare clock strings → HH:MM", () => {
    expect(formatIvTime("2026-10-14T13:06:00+05:30")).toBe("13:06");
    expect(formatIvTime("13:06")).toBe("13:06");
    expect(formatIvTime("9:05")).toBe("09:05");
    expect(formatIvTime("")).toBe(IV_DASH);
  });
});

describe("NiftyIvStraddle render", () => {
  test("renders the four stats from the regime block plus the chart", () => {
    r(
      <NiftyIvStraddle
        regime={regime}
        tape={{
          date: "2026-10-14",
          interval_sec: 60,
          rows: [
            row({ t: "09:15", atm_ce_ltp: 100, atm_pe_ltp: 100, atm_ce_iv: 12, atm_pe_iv: 14 }),
            row({ t: "09:16", atm_ce_ltp: 110, atm_pe_ltp: 110, atm_ce_iv: 13, atm_pe_iv: 15 }),
            row({ t: "09:17", atm_ce_ltp: 120, atm_pe_ltp: 120, atm_ce_iv: 14, atm_pe_iv: 16 }),
          ],
        }}
      />,
    );
    expect(screen.getByTestId("nifty-iv-straddle-panel")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-iv-atm")).toHaveTextContent("15.50%");
    expect(screen.getByTestId("nifty-iv-straddle")).toHaveTextContent("240.00");
    expect(screen.getByTestId("nifty-iv-straddle-pct")).toHaveTextContent("-20.00%");
    expect(screen.getByTestId("nifty-iv-rv")).toHaveTextContent("11.20%");
    expect(screen.getByTestId("nifty-iv-straddle-chart")).toBeInTheDocument();
    expect(screen.queryByTestId("nifty-iv-straddle-empty")).not.toBeInTheDocument();
  });

  test("falls back to tape and candles when no regime block is present", () => {
    r(
      <NiftyIvStraddle
        tape={{
          date: "2026-10-14",
          interval_sec: 60,
          rows: [
            row({ t: "09:15", atm_ce_ltp: 100, atm_pe_ltp: 100, atm_ce_iv: 12, atm_pe_iv: 14 }),
            row({ t: "09:17", atm_ce_ltp: 120, atm_pe_ltp: 120, atm_ce_iv: 14, atm_pe_iv: 16 }),
          ],
        }}
        candles={[
          candle("09:15", 100),
          candle("09:16", 101),
          candle("09:17", 100),
          candle("09:18", 101),
          candle("09:19", 100),
        ]}
      />,
    );
    // last ATM IV avg = (14 + 16) / 2
    expect(screen.getByTestId("nifty-iv-atm")).toHaveTextContent("15.00%");
    expect(screen.getByTestId("nifty-iv-straddle")).toHaveTextContent("240.00");
    // straddle change derived from the series: 240 / 200 - 1
    expect(screen.getByTestId("nifty-iv-straddle-pct")).toHaveTextContent("+20.00%");
    // rv computed from candles is a finite percent (not a dash)
    expect(screen.getByTestId("nifty-iv-rv").textContent).not.toBe(IV_DASH);
    expect(screen.getByTestId("nifty-iv-straddle-chart")).toBeInTheDocument();
  });

  test("no tape renders the empty state and dashes every stat", () => {
    r(<NiftyIvStraddle />);
    expect(screen.getByTestId("nifty-iv-straddle-panel")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-iv-straddle-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("nifty-iv-straddle-chart")).not.toBeInTheDocument();
    expect(screen.getByTestId("nifty-iv-atm")).toHaveTextContent(IV_DASH);
    expect(screen.getByTestId("nifty-iv-straddle")).toHaveTextContent(IV_DASH);
    expect(screen.getByTestId("nifty-iv-straddle-pct")).toHaveTextContent(IV_DASH);
    expect(screen.getByTestId("nifty-iv-rv")).toHaveTextContent(IV_DASH);
  });

  test("tape rows with only dead legs fall back to the empty state", () => {
    r(
      <NiftyIvStraddle
        tape={{
          date: "2026-10-14",
          interval_sec: 60,
          rows: [row({ atm_ce_ltp: null, atm_pe_ltp: null, atm_ce_iv: null, atm_pe_iv: null })],
        }}
      />,
    );
    expect(screen.getByTestId("nifty-iv-straddle-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("nifty-iv-straddle-chart")).not.toBeInTheDocument();
  });
});
