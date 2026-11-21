// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import type { AnalyticsExpiry, OptionsAnalytics } from "@/api/optionsAnalytics";

const chartStub = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
vi.mock("@/utils/loadEcharts", () => ({
  loadEcharts: vi.fn(async () => ({ init: vi.fn(() => chartStub) })),
}));

import { TermPanel } from "./TermPanel";
import * as palette from "@/ui/palette";

function expiry(date: string, dte: number, atmIv: number | null): AnalyticsExpiry {
  return { date, dte, atmIv, rr25: null, bf25: null, slope: null, fitR2: null, points: [] };
}

function analytics(expiries: AnalyticsExpiry[]): OptionsAnalytics {
  return {
    symbol: "NIFTY",
    spot: 100,
    asOf: null,
    quotesLive: true,
    expiries,
    term: [],
    surface: { strikes: [], expiries: [], iv: [], missing: [] },
    levels: {
      callWall: null,
      putWall: null,
      maxPain: null,
      gex: { support: null, resistance: null, fuelUp: null, fuelDown: null },
    },
    probability: {
      model: null,
      flatPop: null,
      skewPop: null,
      expectedPnl: null,
      sigma: null,
      density: [],
      quantiles: { p05: null, p25: null, p50: null, p75: null, p95: null },
      cone: [],
    },
    warnings: [],
  };
}

const FAR = expiry("2027-01-25", 69, 35.6);
const MID = expiry("2026-12-29", 42, 58.4);
const NEAR = expiry("2026-11-23", 6, 79.7);
const curve = (near: number, mid: number, far: number) =>
  analytics([
    expiry("2026-11-23", 6, near),
    expiry("2026-12-29", 42, mid),
    expiry("2027-01-25", 69, far),
  ]);

const two = () => analytics([expiry("2026-11-19", 3, 12.4), expiry("2026-11-26", 10, 11.9)]);

type Datum = (string | number)[];
type Series = {
  name?: string;
  data?: Datum[];
  areaStyle?: { color?: string };
  label?: {
    show?: boolean;
    position?: string;
    fontSize?: number;
    formatter?: string | ((param: { value?: unknown }) => string);
  };
  symbolSize?: number;
  itemStyle?: { color?: string };
  markArea?: { silent?: boolean; data?: any[] };
};
type AxisLabel = {
  fontSize?: number;
  interval?: number;
  hideOverlap?: boolean;
  rotate?: number;
  formatter?: string;
};
type Option = {
  grid?: { containLabel?: boolean; left?: number; right?: number; top?: number; bottom?: number };
  series?: Series[];
  xAxis?: { type?: string; data?: string[]; axisLabel?: AxisLabel };
  yAxis?: { axisLabel?: AxisLabel };
  tooltip?: { formatter?: (params: unknown) => string };
};
const option = (): Option => (chartStub.setOption.mock.calls.at(-1)?.[0] ?? {}) as Option;

function view(data: OptionsAnalytics, selectedExpiry: string | null = null) {
  render(() => (
    <UIProvider>
      <TermPanel data={data} selectedExpiry={selectedExpiry} />
    </UIProvider>
  ));
}

afterEach(() => {
  cleanup();
  chartStub.setOption.mockClear();
  chartStub.dispose.mockClear();
});

describe("TermPanel", () => {
  test("uses expiry-date category labels and keeps DTE in the tooltip", async () => {
    view(analytics([NEAR, MID, FAR]));
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());

    const x = option().xAxis!;
    expect(x.type).toBe("category");
    expect(x.data).toEqual(["23 NOV", "29 DEC", "25 JAN"]);

    const line = option().series!.find((item) => item.name === "ATM IV")!;
    expect(line.data).toEqual([
      ["23 NOV", 79.7],
      ["29 DEC", 58.4],
      ["25 JAN", 35.6],
    ]);
    expect(line.areaStyle?.color).toBe(palette.alpha(palette.INFO, 0.18));
    expect(option().tooltip!.formatter!([{ dataIndex: 0 }])).toBe("23 NOV · 6 DTE · IV 79.7%");
    expect(option().tooltip!.formatter!([{ dataIndex: 2 }])).toBe("25 JAN · 69 DTE · IV 35.6%");
  });

  test("labels each point with its IV", async () => {
    view(analytics([NEAR, MID, FAR]));
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());

    const label = option().series!.find((item) => item.name === "ATM IV")!.label!;
    expect(label.show).toBe(true);
    expect(label.position).toBe("top");
    expect(label.fontSize).toBeGreaterThanOrEqual(10);
    const format = label.formatter as (param: { value?: unknown }) => string;
    expect(format({ value: ["23 NOV", 79.7] })).toBe("79.7");
    expect(format({ value: ["29 DEC", 58.4] })).toBe("58.4");
    expect(format({ value: ["25 JAN", 35.6] })).toBe("35.6");
  });

  test("keeps the axes at 10px inside a contained grid", async () => {
    view(analytics([NEAR, MID, FAR]));
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());

    expect(option().grid!.containLabel).toBe(true);
    expect(option().xAxis!.axisLabel!.fontSize).toBeGreaterThanOrEqual(10);
    expect(option().yAxis!.axisLabel!.fontSize).toBeGreaterThanOrEqual(10);
    expect(option().xAxis!.axisLabel!.hideOverlap).toBe(true);
    expect(option().xAxis!.axisLabel!.interval).toBe(0);
    expect(option().yAxis!.axisLabel!.formatter).toBe("{value}%");
  });

  test("highlights the selected expiry with a band, filled marker and SEL label", async () => {
    view(analytics([NEAR, MID, FAR]), "2026-11-23");
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());

    const selected = option().series!.find((item) => item.name === "selected")!;
    expect(selected.data).toEqual([["23 NOV", 79.7]]);
    expect(selected.symbolSize).toBeGreaterThanOrEqual(8);
    expect(selected.itemStyle?.color).toBe(palette.PRIMARY);
    expect(selected.label?.formatter).toBe("SEL 23 NOV");
    // The point's own IV label owns the top slot: the SEL label goes below the
    // marker, so two 10px labels can never stack on one expiry.
    expect(selected.label?.position).toBe("bottom");
    expect(selected.label?.fontSize).toBeGreaterThanOrEqual(10);

    const area = selected.markArea!.data!;
    expect(area).toHaveLength(1);
    expect(area[0][0].xAxis).toBe(-0.5);
    expect(area[0][1].xAxis).toBe(0.5);
    expect(area[0][0].name).toBe("SEL 23 NOV");
    expect(area[0][0].itemStyle.color).toBe(palette.alpha(palette.PRIMARY, 0.14));
  });

  test("badges a falling curve as BACKWARDATION with the near/far gap", async () => {
    view(curve(79.7, 58.4, 35.6));
    await waitFor(() => expect(screen.getByTestId("term-badge")).toBeInTheDocument());
    expect(screen.getByTestId("term-badge")).toHaveTextContent(
      "BACKWARDATION · near-term +44 vp over 25 JAN",
    );
  });

  test("badges a rising curve as CONTANGO with the near/far gap", async () => {
    view(curve(35.6, 58.4, 79.7));
    await waitFor(() => expect(screen.getByTestId("term-badge")).toBeInTheDocument());
    expect(screen.getByTestId("term-badge")).toHaveTextContent(
      "CONTANGO · later expiries +44 vp",
    );
  });

  test("badges a flat curve as FLAT", async () => {
    view(curve(30, 30.4, 30));
    await waitFor(() => expect(screen.getByTestId("term-badge")).toBeInTheDocument());
    expect(screen.getByTestId("term-badge")).toHaveTextContent("FLAT");
  });

  test("prints FRONT/BACK/SLOPE/SELECTED with date-qualified labels", async () => {
    view(two(), "2026-11-19");
    await waitFor(() => expect(screen.getByTestId("term-metric-front-value")).toHaveTextContent("12.4"));

    expect(screen.getByTestId("term-metric-front")).toHaveTextContent("FRONT (19 NOV)");
    expect(screen.getByTestId("term-metric-back")).toHaveTextContent("BACK (26 NOV)");
    expect(screen.getByTestId("term-metric-back-value")).toHaveTextContent("11.9");
    expect(screen.getByTestId("term-metric-slope")).toHaveTextContent("vp per expiry");
    // −0.5 vol points per expiry across two points.
    expect(screen.getByTestId("term-metric-slope-value")).toHaveTextContent("-0.5 vp");
    expect(screen.getByTestId("term-metric-selected")).toHaveTextContent("SELECTED (19 NOV)");
    expect(screen.getByTestId("term-metric-selected-value")).toHaveTextContent("12.4");
  });

  test("shows — with a reason when the front expiry has no ATM IV", async () => {
    view(
      analytics([expiry("2026-11-23", 6, null), expiry("2026-12-29", 42, 58.4), FAR]),
    );
    await waitFor(() => expect(screen.getByTestId("term-metric-front-value")).toHaveTextContent("—"));

    expect(screen.getByTestId("term-metric-front")).toHaveTextContent("FRONT (23 NOV)");
    expect(screen.getByTestId("term-front-reason")).toHaveTextContent("no IV quotes");
    expect(screen.getByTestId("term-front-reason")).toHaveTextContent("FRONT (23 NOV)");
    // The second expiry's IV is not silently promoted to FRONT.
    expect(screen.getByTestId("term-metric-front-value")).not.toHaveTextContent("58.4");
  });

  test("shows the selected-expiry explanation hint", async () => {
    view(two());
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());
    expect(screen.getByTestId("term-hint")).toHaveTextContent(
      "Curve = all expiries; the marker shows the selected expiry",
    );
  });

  test("needs two expiries with valid ATM IV and shows no badge", async () => {
    view(analytics([expiry("2026-11-19", 3, 12.4)]));
    await waitFor(() =>
      expect(screen.getByTestId("term-chart-empty")).toHaveTextContent(
        "Need at least two expiries with valid ATM IV",
      ),
    );
    expect(screen.queryByTestId("term-badge")).not.toBeInTheDocument();
    expect(screen.getByTestId("term-metric-slope-value")).toHaveTextContent("—");
    expect(screen.getByTestId("term-metric-selected-value")).toHaveTextContent("—");
  });

  test("disposes the canvas when the panel leaves", async () => {
    const { unmount } = render(() => (
      <UIProvider>
        <TermPanel data={two()} selectedExpiry={null} />
      </UIProvider>
    ));
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());
    unmount();
    expect(chartStub.dispose).toHaveBeenCalledTimes(1);
  });
});
