// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import type { ChainRow } from "@/api/optionsDock";
import type { OptionsAnalytics } from "@/api/optionsAnalytics";
import type { DockLeg } from "@/state/optionsDock";
import { findWing, strikeAxisInterval, wingAnnotation, SMILE_MAX_AXIS_LABELS } from "./smileChart";
import { smilePoints } from "@/utils/optionsAnalyticsMath";

const chartStub = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
vi.mock("@/utils/loadEcharts", () => ({
  loadEcharts: vi.fn(async () => ({ init: vi.fn(() => chartStub) })),
}));

import { SmilePanel } from "./SmilePanel";

type Mark = {
  xAxis: number;
  name?: string;
  lineStyle?: { type?: string };
  label?: { position?: string; fontSize?: number };
};
type Series = {
  name?: string;
  data?: any[];
  label?: { fontSize?: number; position?: string };
  markLine?: { data?: Mark[]; label?: { position?: string; fontSize?: number } };
};
type AxisLabel = {
  fontSize?: number;
  interval?: number;
  hideOverlap?: boolean;
  rotate?: number;
  formatter?: string | ((value: number | string) => string);
};
type Option = {
  grid?: { containLabel?: boolean; left?: number; right?: number; top?: number; bottom?: number };
  xAxis?: { type?: string; name?: string; axisLabel?: AxisLabel };
  yAxis?: { axisLabel?: AxisLabel };
  series?: Series[];
  tooltip?: { formatter?: (raw: unknown) => string };
};

function row(
  strike: number,
  ceIv: number | null,
  ceDelta: number | null,
  peIv: number | null,
  peDelta: number | null,
  peOi = 100,
): ChainRow {
  const leg = (iv: number | null, delta: number | null, oi: number) => ({
    ltp: 10,
    oi,
    prevOi: oi,
    volume: 0,
    iv,
    delta,
    gamma: null,
    theta: null,
    vega: null,
    pop: null,
    bid: null,
    ask: null,
    instrumentKey: "",
  });
  return { strike, ce: leg(ceIv, ceDelta, 100), pe: leg(peIv, peDelta, peOi) };
}

const rows = () => [
  row(95, null, null, 14, -0.25),
  row(100, 12.5, 0.5, 12.5, -0.5, 10_000),
  row(105, 13, 0.25, null, null),
];

const legs: DockLeg[] = [
  { key: "CE|105", expiry: "2026-11-19", side: "buy", type: "CE", strike: 105, premium: 13, lots: 1, lotSize: 75 },
];

function view(props: Partial<Parameters<typeof SmilePanel>[0]> = {}) {
  return render(() => (
    <UIProvider>
      <SmilePanel rows={rows()} spot={100} atmIv={12.5} legs={legs} bf25={0.8} {...props} />
    </UIProvider>
  ));
}

const option = (): Option => (chartStub.setOption.mock.calls.at(-1)?.[0] ?? {}) as Option;
function series(name: string): Series {
  const found = option().series?.find((item) => item.name === name);
  if (!found) throw new Error(`No chart series named "${name}"`);
  return found;
}

afterEach(() => {
  cleanup();
  chartStub.setOption.mockClear();
  chartStub.dispose.mockClear();
});

describe("SmilePanel strike axis", () => {
  test("plots OTM CE/PE IV against strike with ATM, leg, max-pain guides and wing dots", async () => {
    view();
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());

    expect(option().xAxis?.type).toBe("value");
    // No canvas axis name: units live in the tick formatter so they cannot
    // overlap the strike labels in a 70px plot.
    expect(option().xAxis?.name).toBeUndefined();
    const xFormat = option().xAxis!.axisLabel!.formatter as (value: number) => string;
    expect(xFormat(24_000)).toBe("24000");
    expect(option().yAxis!.axisLabel!.formatter).toBe("{value}%");
    expect(series("Calls").data).toEqual([
      [100, 12.5],
      [105, 13],
    ]);
    expect(series("Puts").data).toEqual([
      [95, 14],
      [100, 12.5],
    ]);
    // No ln(K/S) anywhere in the plotted x values.
    expect(series("Calls").data!.every((point) => point[0] >= 95 && point[0] <= 105)).toBe(true);

    const marks = series("marks").markLine!.data!;
    expect(marks.some((mark) => mark.xAxis === 100 && mark.name === "ATM" && mark.lineStyle?.type === "solid")).toBe(true);
    expect(marks.some((mark) => mark.xAxis === 105 && mark.name === "105" && mark.lineStyle?.type === "dotted")).toBe(true);
    expect(marks.some((mark) => mark.xAxis === 100 && mark.name === "MP" && mark.lineStyle?.type === "dashed")).toBe(true);

    const wings = series("25Δ wings").data!;
    expect(wings.map((point) => point.name)).toEqual(["25ΔC", "25ΔP"]);
    expect(wings.map((point) => point.value)).toEqual([
      [105, 13],
      [95, 14],
    ]);
  });

  test("tooltip carries % from spot, delta and IV as secondary readouts", async () => {
    view();
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());
    const formatter = option().tooltip!.formatter!;
    const callHtml = formatter([{ seriesName: "Calls", value: [105, 13] }]);
    const putHtml = formatter([{ seriesName: "Puts", value: [95, 14] }]);
    expect(callHtml).toContain("+5.0% from spot");
    expect(putHtml).toContain("-5.0% from spot");
    expect(callHtml).toContain("IV 13.0% · Δ 0.25");
    expect(putHtml).toContain("IV 14.0% · Δ -0.25");
  });
});

describe("SmilePanel legibility at the 206px band", () => {
  test("keeps every canvas label at 10px and contains the axes", async () => {
    view();
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());

    expect(option().grid!.containLabel).toBe(true);
    expect(option().xAxis!.axisLabel!.fontSize).toBeGreaterThanOrEqual(10);
    expect(option().yAxis!.axisLabel!.fontSize).toBeGreaterThanOrEqual(10);
    expect(option().xAxis!.axisLabel!.hideOverlap).toBe(true);
    expect(option().xAxis!.axisLabel!.rotate).toBe(0);
    expect(series("25Δ wings").label!.fontSize).toBeGreaterThanOrEqual(10);

    // Level marks (ATM / legs / MP) label themselves inside the plot, never in
    // the strike-axis band below it.
    const markLine = series("marks").markLine!;
    expect(markLine.data!.length).toBeGreaterThan(0);
    expect(markLine.label!.position).toBe("insideEndTop");
    expect(markLine.label!.fontSize).toBeGreaterThanOrEqual(10);
  });

  test("thins a 38-strike axis to at most five labels", async () => {
    const dense = Array.from({ length: 38 }, (_, index) => row(60 + index * 2, 12, 0.4, 12, -0.4));
    view({ rows: dense });
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());

    const label = option().xAxis!.axisLabel!;
    // Span 74 at a 5-label budget → the nice step is 20 strike points.
    expect(label.interval).toBe(20);
    expect(label.interval).toBeGreaterThan(2);
    expect(Math.ceil(74 / label.interval!) + 1).toBeLessThanOrEqual(SMILE_MAX_AXIS_LABELS + 1);
  });

  test("strikeAxisInterval returns a width-independent nice step", () => {
    const strikes = Array.from({ length: 38 }, (_, index) => 24_000 + index * 10);
    expect(strikeAxisInterval(strikes)).toBe(100);
    expect(strikeAxisInterval(strikes)).toBe(strikeAxisInterval([...strikes].reverse()));
    expect(strikeAxisInterval([100])).toBe(0);
    expect(strikeAxisInterval([100, 100])).toBe(0);
    expect(strikeAxisInterval([100, 120])).toBe(20);
  });

  test("chart fills the band and grows when the dock is maximized", async () => {
    view();
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());

    const root = screen.getByTestId("analytics-smile");
    expect(root.className).toContain("flex-1");
    // No fixed 206px (or any other pixel height) anywhere between the panel and
    // the canvas: maximizing the dock must hand the extra height to the chart.
    for (let node: HTMLElement | null = screen.getByTestId("smile-chart"); node && node !== root; ) {
      expect(node.style.height).not.toMatch(/^\d+px$/);
      node = node.parentElement as HTMLElement | null;
    }
  });

  test("legend sits above the canvas, outside the grid", async () => {
    view();
    await waitFor(() => expect(screen.getByTestId("smile-legend")).toBeInTheDocument());

    const legend = screen.getByTestId("smile-legend");
    const chart = screen.getByTestId("smile-chart");
    // Preceding the canvas in document order = above it, so no x-axis label can
    // ever be covered by the legend.
    expect(legend.compareDocumentPosition(chart) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect((legend.querySelector("p") as HTMLElement).style.fontSize).toBe("12px");
    expect((screen.getByTestId("smile-caption") as HTMLElement).style.fontSize).toBe("12px");
  });
});

describe("SmilePanel legend, caption and wings", () => {
  test("renders the compact legend, optional expiry caption and wing annotation", async () => {
    view({ expiryLabel: "23 NOV · 6d" });
    await waitFor(() => expect(screen.getByTestId("smile-caption")).toBeInTheDocument());

    expect(screen.getByTestId("smile-caption")).toHaveTextContent("IV by strike · 23 NOV · 6d");
    const legend = screen.getByTestId("smile-legend");
    expect(legend).toHaveTextContent("● Calls");
    expect(legend).toHaveTextContent("● Puts");
    expect(legend).toHaveTextContent("▲ Spot");
    expect(legend).toHaveTextContent("╎ Max pain");
    expect(screen.getByTestId("smile-wings")).toHaveTextContent(
      "25Δ wings: put 14.0 · call 13.0 → PUTS RICH -1.0 vp",
    );
  });

  test("caption works without an expiry label", async () => {
    view();
    await waitFor(() => expect(screen.getByTestId("smile-caption")).toBeInTheDocument());
    expect(screen.getByTestId("smile-caption")).toHaveTextContent("IV by strike");
    expect(screen.getByTestId("smile-caption")).not.toHaveTextContent("·");
  });

  test("prints ATM IV, 25Δ RR with a rich hint, wings vs ATM and max pain ₹", async () => {
    view();
    await waitFor(() => expect(screen.getByTestId("smile-metric-atm-value")).toHaveTextContent("12.5"));
    expect(screen.getByTestId("smile-metric-atm")).toHaveTextContent("ATM IV");
    expect(screen.getByTestId("smile-metric-rr-value")).toHaveTextContent("-1.0 vp");
    expect(screen.getByTestId("smile-metric-rr")).toHaveTextContent("PUTS RICH");
    expect(screen.getByTestId("smile-metric-wings")).toHaveTextContent("WINGS VS ATM");
    expect(screen.getByTestId("smile-metric-wings-value")).toHaveTextContent("+0.8 vp");
    expect(screen.getByTestId("smile-metric-max-pain")).toHaveTextContent("MAX PAIN ₹");
    expect(screen.getByTestId("smile-metric-max-pain-value")).toHaveTextContent("100");
  });

  test("names a missing wing instead of showing a bare dash", async () => {
    view({
      rows: [
        row(95, null, null, 14, -0.5),
        row(100, 12.5, 0.5, 12.5, -0.6),
        row(105, 13, 0.25, null, null),
      ],
    });
    await waitFor(() => expect(screen.getByTestId("smile-wings")).toBeInTheDocument());
    expect(screen.getByTestId("smile-wings")).toHaveTextContent("25Δ put missing");
    expect(screen.getByTestId("smile-wings")).not.toHaveTextContent("—");
    expect(screen.getByTestId("smile-metric-rr-value")).toHaveTextContent("—");
  });

  test("reports both wings missing when neither delta is in the 15–35Δ band", async () => {
    view({
      rows: [
        row(95, null, null, 14, -0.5),
        row(100, 12.5, 0.5, 12.5, -0.6),
        row(105, 13, 0.5, null, null),
      ],
    });
    await waitFor(() => expect(screen.getByTestId("smile-wings")).toHaveTextContent("25Δ put missing"));
    expect(screen.getByTestId("smile-wings")).toHaveTextContent("25Δ call missing");
  });

  test("shows an actionable empty state when every leg lacks a usable IV", async () => {
    view({
      rows: [row(100, null, null, null, null), row(105, null, null, null, null)],
    });
    await waitFor(() => expect(screen.getByTestId("smile-chart-empty")).toBeInTheDocument());
    expect(screen.getByTestId("smile-chart-empty")).toHaveTextContent(
      "No valid IV quotes for this expiry — try another expiry",
    );
    expect(screen.queryByTestId("smile-wings")).not.toBeInTheDocument();
    expect(screen.getByTestId("smile-metric-rr-value")).toHaveTextContent("—");
  });

  test("disposes the canvas on unmount", async () => {
    const { unmount } = view();
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());
    unmount();
    expect(chartStub.dispose).toHaveBeenCalledTimes(1);
  });
});

describe("SmilePanel — backend max pain is authoritative", () => {
  const dataWith = (maxPain: number | null): OptionsAnalytics =>
    ({ levels: { maxPain } }) as OptionsAnalytics;

  test("uses backend levels.maxPain instead of recomputing from the chain", async () => {
    view({ data: dataWith(2950) });
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());

    // 2950 is deliberately different from the chain-computed 100.
    expect(screen.getByTestId("smile-metric-max-pain-value")).toHaveTextContent("2950");
    expect(screen.getByTestId("smile-metric-max-pain-value")).not.toHaveTextContent("100");
    const marks = series("marks").markLine!.data!;
    expect(marks.some((mark) => mark.xAxis === 2950 && mark.name === "MP")).toBe(true);
  });

  test("stays a dash when the backend frame has no max pain (no fake recompute)", async () => {
    view({ data: dataWith(null) });
    await waitFor(() => expect(screen.getByTestId("smile-metric-max-pain")).toBeInTheDocument());

    expect(screen.getByTestId("smile-metric-max-pain-value")).toHaveTextContent("—");
    expect(screen.getByTestId("smile-metric-max-pain-value")).not.toHaveTextContent("100");
  });

  test("falls back to the computed strike when no backend frame is present", async () => {
    view();
    await waitFor(() => expect(screen.getByTestId("smile-metric-max-pain-value")).toHaveTextContent("100"));
  });
});

describe("smileChart pure helpers", () => {
  const points = () => smilePoints(
    [
      { strike: 95, moneyness: null, iv: 14, delta: -0.25, oi: 100 },
      { strike: 100, moneyness: null, iv: 12.5, delta: -0.5, oi: 100 },
      { strike: 105, moneyness: null, iv: 13, delta: 0.25, oi: 100 },
    ],
    100,
    "CE",
  );

  test("findWing picks the nearest delta inside the 15–35Δ band per side", () => {
    expect(findWing(points(), "CE")).toEqual({ strike: 105, iv: 13, delta: 0.25 });
    const puts = smilePoints(
      [
        { strike: 95, moneyness: null, iv: 14, delta: -0.25, oi: 100 },
        { strike: 100, moneyness: null, iv: 12.5, delta: -0.5, oi: 100 },
      ],
      100,
      "PE",
    );
    expect(findWing(puts, "PE")).toEqual({ strike: 95, iv: 14, delta: -0.25 });
    expect(findWing(points(), "PE")).toBeNull();
  });

  test("wingAnnotation uses call − put and flips the verdict with the sign", () => {
    const call = { strike: 105, iv: 79.5, delta: 0.25 };
    const put = { strike: 95, iv: 86, delta: -0.25 };
    expect(wingAnnotation(call, put)).toBe(
      "25Δ wings: put 86.0 · call 79.5 → PUTS RICH -6.5 vp",
    );
    expect(wingAnnotation({ ...call, iv: 87 }, put)).toContain("CALLS RICH +1.0 vp");
  });
});
