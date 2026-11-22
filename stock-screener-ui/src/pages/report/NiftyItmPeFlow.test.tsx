// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import type { JSX } from "solid-js";
import { UIProvider } from "@/ui";
import type { NiftyItmPeFlow, NiftyItmPeFlowPoint } from "@/types/niftyReport";
import {
  NiftyItmPeFlowPanel,
  itmShareOf,
  sessionShare,
} from "./NiftyItmPeFlow";

const setChartOption = vi.hoisted(() => vi.fn());

vi.mock("./echartsSolid", () => ({
  createECharts: () => ({ ref: () => {}, setChartOption }),
}));

function r(node: () => JSX.Element) {
  return render(node, { wrapper: UIProvider });
}

function point(overrides: Partial<NiftyItmPeFlowPoint> = {}): NiftyItmPeFlowPoint {
  return {
    t: "2026-11-17T10:05:00+05:30",
    itm_pe_vol: 25_000,
    total_pe_vol: 100_000,
    share_pct: 25,
    spot: 25_980,
    ...overrides,
  };
}

function flow(overrides: Partial<NiftyItmPeFlow> = {}): NiftyItmPeFlow {
  return {
    series: [
      point(),
      point({
        t: "2026-11-17T10:06:00+05:30",
        itm_pe_vol: 40_000,
        total_pe_vol: 100_000,
        share_pct: 40,
      }),
    ],
    top: [
      { strike: 26_200, volume: 30_000, oi: 120_000 },
      { strike: 26_100, volume: 50_000, oi: 210_000 },
      { strike: 26_000, volume: 10_000, oi: 90_000 },
      { strike: 26_300, volume: 20_000, oi: 70_000 },
      { strike: 26_400, volume: 5_000, oi: 40_000 },
      { strike: 26_500, volume: 1_000, oi: 30_000 },
    ],
    as_of: "2026-11-17T10:06:00+05:30",
    ...overrides,
  };
}

beforeEach(() => setChartOption.mockClear());

describe("itm share math", () => {
  test("derives share when the backend omits the field", () => {
    const p = point({ share_pct: Number.NaN });
    expect(itmShareOf(p)).toBeCloseTo(25, 6);
  });

  test("a zero put book never divides by zero", () => {
    expect(itmShareOf(point({ itm_pe_vol: 0, total_pe_vol: 0, share_pct: Number.NaN }))).toBe(0);
  });

  test("session share sums legs instead of averaging ratios", () => {
    expect(sessionShare(flow().series)).toBeCloseTo(32.5, 6);
    expect(
      sessionShare([
        point({ itm_pe_vol: 10, total_pe_vol: 10, share_pct: 100 }),
        point({ itm_pe_vol: 10, total_pe_vol: 990, share_pct: (10 / 990) * 100 }),
      ]),
    ).toBeCloseTo(2, 6);
  });
});

describe("NiftyItmPeFlowPanel", () => {
  test("shows the latest ITM volume, put book and share", () => {
    r(() => <NiftyItmPeFlowPanel flow={flow()} spot={25_980} />);

    expect(screen.getByTestId("nifty-itm-pe-vol")).toHaveTextContent("40.00K");
    expect(screen.getByTestId("nifty-itm-pe-total")).toHaveTextContent("100.00K");
    expect(screen.getByTestId("nifty-itm-pe-share")).toHaveTextContent("40.0% ITM");
    expect(screen.getByTestId("nifty-itm-pe-share-stat")).toHaveTextContent("40.0%");
    expect(screen.getByTestId("nifty-itm-pe-share-stat")).toHaveTextContent("session 32.5%");
  });

  test("bars are per-minute ITM puts and the line is the share", () => {
    r(() => <NiftyItmPeFlowPanel flow={flow()} spot={25_980} />);

    const option = setChartOption.mock.calls.at(-1)?.[0] as {
      xAxis: { data: string[] };
      series: { name: string; data: number[]; yAxisIndex?: number }[];
    };
    expect(option.xAxis.data).toEqual(["10:05", "10:06"]);
    expect(option.series[0]).toMatchObject({ name: "itm-pe-vol", data: [25_000, 40_000] });
    expect(option.series[1]).toMatchObject({ name: "share", data: [25, 40] });
    expect(option.series[1].yAxisIndex).toBe(1);
  });

  test("top strikes are volume-ranked and capped at five", () => {
    r(() => <NiftyItmPeFlowPanel flow={flow()} spot={25_980} />);

    const rows = screen.getByTestId("nifty-itm-pe-top").children;
    expect(rows).toHaveLength(6);
    const strikes = Array.from(screen.getByTestId("nifty-itm-pe-top").querySelectorAll("[data-testid^='nifty-itm-pe-top-']"));
    expect(strikes.map((row) => row.getAttribute("data-testid"))).toEqual([
      "nifty-itm-pe-top-26100",
      "nifty-itm-pe-top-26200",
      "nifty-itm-pe-top-26300",
      "nifty-itm-pe-top-26000",
      "nifty-itm-pe-top-26400",
    ]);
  });

  test("an absent block says unavailable and paints no chart", () => {
    r(() => <NiftyItmPeFlowPanel flow={null} spot={25_980} />);

    expect(screen.getByTestId("nifty-itm-pe-empty")).toHaveTextContent(
      "ITM put flow unavailable",
    );
    expect(screen.queryByTestId("nifty-itm-pe-chart")).not.toBeInTheDocument();
    expect(setChartOption).not.toHaveBeenCalled();
  });

  test("top strikes still render when the per-minute series is empty", () => {
    r(() => <NiftyItmPeFlowPanel flow={flow({ series: [] })} spot={25_980} />);

    expect(screen.queryByTestId("nifty-itm-pe-empty")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nifty-itm-pe-chart")).not.toBeInTheDocument();
    expect(screen.getByTestId("nifty-itm-pe-top-26100")).toBeInTheDocument();
  });

  test("a single bordered surface — no nested card wrapper", () => {
    r(() => <NiftyItmPeFlowPanel flow={flow()} spot={25_980} />);

    const panel = screen.getByTestId("nifty-itm-pe-panel");
    expect(panel).toHaveAttribute("data-compact");
    expect(panel.querySelectorAll("[data-compact]")).toHaveLength(0);
  });
});
