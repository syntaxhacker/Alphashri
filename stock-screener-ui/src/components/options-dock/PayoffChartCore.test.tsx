// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import { createSignal } from "solid-js";

const chartStub = {
  setOption: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
};
vi.mock("../../utils/loadEcharts", () => ({
  loadEcharts: vi.fn(async () => ({ init: vi.fn(() => chartStub) })),
}));

import { PayoffChartCore, buildPayoff, type PayoffSnapshot } from "./PayoffChartCore";
import type { DockLeg } from "@/state/optionsDock";
import * as palette from "@/ui/palette";

function condor(): DockLeg[] {
  return [
    { key: "CE|24200", expiry: "2026-03-26", side: "sell", type: "CE", strike: 24200, premium: 36.6, lots: 1, lotSize: 65 },
    { key: "CE|24500", expiry: "2026-03-26", side: "buy", type: "CE", strike: 24500, premium: 3.5, lots: 1, lotSize: 65 },
    { key: "PE|23800", expiry: "2026-03-26", side: "sell", type: "PE", strike: 23800, premium: 23.1, lots: 1, lotSize: 65 },
    { key: "PE|23500", expiry: "2026-03-26", side: "buy", type: "PE", strike: 23500, premium: 1.8, lots: 1, lotSize: 65 },
  ];
}

type Area = { color?: string; origin?: number };
type Series = {
  name?: string;
  data?: (number | null)[];
  connectNulls?: boolean;
  lineStyle?: { color?: string };
  areaStyle?: Area;
  z?: number;
  markLine?: {
    data?: MarkLineDatum[];
  };
  markArea?: {
    data?: MarkAreaDatum[][];
  };
};
type MarkLineDatum = {
  yAxis?: number;
  xAxis?: string;
  lineStyle?: { color?: string; type?: string };
  label?: { formatter?: string; fontSize?: number };
};
type MarkAreaDatum = {
  itemStyle?: { color?: string };
  label?: { formatter?: string; fontSize?: number };
  xAxis?: string;
};
type ChartOption = {
  grid?: { containLabel?: boolean };
  xAxis?: { axisLabel?: { fontSize?: number } };
  yAxis?: { axisLabel?: { fontSize?: number } };
  series?: Series[];
  graphic?: { style?: { text?: string; fontSize?: number } }[];
};

function lastOption(): ChartOption {
  return (chartStub.setOption.mock.calls.at(-1)?.[0] ?? {}) as ChartOption;
}

afterEach(() => {
  cleanup();
  chartStub.setOption.mockClear();
});

describe("PayoffChartCore series", () => {
  async function renderCondor() {
    render(() => (
      <UIProvider>
        <PayoffChartCore legs={condor()} spot={24031.5} iv={0.138} dteYears={2 / 365} />
      </UIProvider>
    ));
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());
  }

  test("profit nulls every losing index and loss nulls every winning one", async () => {
    await renderCondor();
    const snapshot = buildPayoff(condor(), 24031.5, 0.138, 2 / 365)!;
    const series = lastOption().series ?? [];
    const profit = series.find((s) => s.lineStyle?.color === palette.POSITIVE)!;
    const loss = series.find((s) => s.lineStyle?.color === palette.NEGATIVE)!;

    expect(profit.data).toHaveLength(241);
    expect(loss.data).toHaveLength(241);
    expect(profit.connectNulls).toBe(false);
    expect(loss.connectNulls).toBe(false);
    expect(profit.areaStyle?.origin).toBe(0);
    expect(loss.areaStyle?.origin).toBe(0);

    let winners = 0;
    let losers = 0;
    snapshot.points.forEach((point, i) => {
      if (point.pnl >= 0) {
        winners += 1;
        expect(profit.data![i]).not.toBeNull();
        expect(loss.data![i]).toBeNull();
      } else {
        losers += 1;
        expect(loss.data![i]).not.toBeNull();
        expect(profit.data![i]).toBeNull();
      }
    });
    expect(winners).toBeGreaterThan(0);
    expect(losers).toBeGreaterThan(0);
  });

  test("fills are solid tints of POSITIVE / NEGATIVE and probability sits behind", async () => {
    await renderCondor();
    const series = lastOption().series ?? [];
    const profit = series.find((s) => s.lineStyle?.color === palette.POSITIVE)!;
    const loss = series.find((s) => s.lineStyle?.color === palette.NEGATIVE)!;
    expect(profit.areaStyle?.color).toBe(palette.alpha(palette.POSITIVE, 0.22));
    expect(loss.areaStyle?.color).toBe(palette.alpha(palette.NEGATIVE, 0.22));

    const probability = series.find((s) => s.name === "P(S)")!;
    expect(probability.z).toBeLessThan(profit.z!);
    expect(probability.areaStyle?.color).toBe(palette.alpha(palette.INFO, 0.1));
  });

  test("the flat-vol disclosure is printed with the host's decimal IV", async () => {
    await renderCondor();
    expect(lastOption().graphic?.[0]?.style?.text).toBe("flat vol 13.8%");
  });

  test("axis ticks are 10px and contained inside the grid box", async () => {
    await renderCondor();
    const option = lastOption();
    // 9px labels were clipped by the band edge on the POSITION ODDS tab.
    expect(option.grid?.containLabel).toBe(true);
    expect(option.xAxis?.axisLabel?.fontSize).toBeGreaterThanOrEqual(10);
    expect(option.yAxis?.axisLabel?.fontSize).toBeGreaterThanOrEqual(10);
    expect(option.graphic?.[0]?.style?.fontSize).toBeGreaterThanOrEqual(10);
  });

  test("zero, breakeven and spot guides ride their own empty series", async () => {
    await renderCondor();
    const snapshot = buildPayoff(condor(), 24031.5, 0.138, 2 / 365)!;
    const guides = lastOption().series!.find((s) => s.name === "guides")!;
    expect(guides.data).toEqual([]);

    const data = guides.markLine!.data!;
    expect(data[0]).toMatchObject({ yAxis: 0, lineStyle: { type: "dashed" } });
    expect(data[1]).toMatchObject({
      xAxis: Math.round(snapshot.breakevens[0]).toString(),
      lineStyle: { color: palette.WARNING, type: "dotted" },
    });
    expect(data.at(-1)).toMatchObject({
      xAxis: Math.round(24031.5).toString(),
      lineStyle: { color: palette.INFO, type: "solid" },
    });
  });

  test("host guides add labelled strike lines without replacing the model guides", async () => {
    render(() => (
      <UIProvider>
        <PayoffChartCore
          legs={condor()}
          spot={24031.5}
          iv={0.138}
          dteYears={2 / 365}
          guides={[
            { x: 24200, color: palette.INFO, dash: "dotted", label: "CE 24.2K" },
            { x: 24000, color: palette.PRIMARY, dash: "dashed", label: "MP" },
          ]}
        />
      </UIProvider>
    ));
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());

    const data = lastOption().series!.find((s) => s.name === "guides")!.markLine!.data! as any[];
    expect(data.find((item) => item.label?.formatter === "CE 24.2K")).toMatchObject({
      xAxis: "24200",
      lineStyle: { color: palette.INFO, type: "dotted" },
    });
    expect(data.find((item) => item.label?.formatter === "MP")).toMatchObject({
      xAxis: "24000",
      lineStyle: { color: palette.PRIMARY, type: "dashed" },
    });
    expect(data[0]).toMatchObject({ yAxis: 0 });
    for (const item of data.filter((entry) => entry.label?.formatter)) {
      expect(item.label.fontSize).toBeGreaterThanOrEqual(10);
    }
  });
});

describe("PayoffChartCore footer", () => {
  test("four labelled cells carry the shared testids", async () => {
    render(() => (
      <UIProvider>
        <PayoffChartCore legs={condor()} spot={24031.5} iv={0.138} dteYears={2 / 365} />
      </UIProvider>
    ));
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());

    const footer = screen.getByTestId("options-payoff-footer");
    expect(footer.children).toHaveLength(4);
    expect(screen.getByTestId("options-breakevens")).toHaveTextContent("BE");
    expect(screen.getByTestId("options-max-pnl")).toHaveTextContent("MAX P/L");
    expect(screen.getByTestId("options-expected-pnl")).toHaveTextContent("MODEL E[P&L]");
    expect(screen.getByTestId("options-expected-move")).toHaveTextContent("±1σ");
  });

  test("footer={false} drops the whole band", async () => {
    render(() => (
      <UIProvider>
        <PayoffChartCore legs={condor()} spot={24031.5} iv={0.138} footer={false} />
      </UIProvider>
    ));
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());
    expect(screen.queryByTestId("options-payoff-footer")).not.toBeInTheDocument();
  });

  test("a missing DTE uses the 7/365 model fallback but hides ±1σ", async () => {
    let published: PayoffSnapshot | null = null;
    render(() => (
      <UIProvider>
        <PayoffChartCore
          legs={condor()}
          spot={24031.5}
          iv={0.138}
          onSnapshot={(snapshot) => (published = snapshot)}
        />
      </UIProvider>
    ));
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());

    // The payoff and POP are computed, but the DTE-dependent move is not shown.
    expect(published).not.toBeNull();
    expect(published!.pop).toBe(buildPayoff(condor(), 24031.5, 0.138, 7 / 365)!.pop);
    expect(screen.queryByTestId("options-expected-move")).not.toBeInTheDocument();
    expect(screen.getByTestId("options-payoff-footer").children).toHaveLength(3);
  });
});

describe("PayoffChartCore recompute gate", () => {
  test("IV and DTE changes refresh POP; a sub-epsilon spot move does not", async () => {
    const [iv, setIv] = createSignal(0.138);
    const [dte, setDte] = createSignal(2 / 365);
    const [spot, setSpot] = createSignal(24031.5);
    const snapshots: PayoffSnapshot[] = [];
    render(() => (
      <UIProvider>
        <PayoffChartCore
          legs={condor()}
          spot={spot()}
          iv={iv()}
          dteYears={dte()}
          onSnapshot={(snapshot) => snapshot && snapshots.push(snapshot)}
        />
      </UIProvider>
    ));
    await waitFor(() => expect(snapshots.length).toBeGreaterThan(0));
    const initialPop = snapshots.at(-1)!.pop;

    setSpot(24036.5); // +₹5 on 24 031 = 0.02 % — inside the gate.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(snapshots).toHaveLength(1);

    setIv(0.25);
    await waitFor(() => expect(snapshots.at(-1)!.pop).not.toBe(initialPop));
    const afterIv = snapshots.at(-1)!.pop;
    // The in-gate nudge did not recompute, so the next real recompute uses the
    // current spot (24 036.5) even though the displayed curve has not moved yet.
    expect(afterIv).toBe(buildPayoff(condor(), 24036.5, 0.25, 2 / 365)!.pop);

    setDte(10 / 365);
    await waitFor(() => expect(snapshots.at(-1)!.pop).not.toBe(afterIv));
    expect(snapshots.at(-1)!.pop).toBe(buildPayoff(condor(), 24036.5, 0.25, 10 / 365)!.pop);
  });

  test("a fixed canvas height is applied to the chart container", async () => {
    render(() => (
      <UIProvider>
        <PayoffChartCore
          legs={condor()}
          spot={24031.5}
          iv={0.138}
          height={180}
          data-testid="core-fixed-height"
        />
      </UIProvider>
    ));
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());
    const chart = screen.getByTestId("core-fixed-height");
    expect(chart.parentElement?.style.height).toBe("180px");
  });
});

describe("PayoffChartCore optional probability visuals", () => {
  test("omitted props keep the PAYOFF canvas exactly as before", async () => {
    render(() => (
      <UIProvider>
        <PayoffChartCore legs={condor()} spot={24031.5} iv={0.138} dteYears={2 / 365} />
      </UIProvider>
    ));
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());

    const series = lastOption().series ?? [];
    expect(series.find((s) => s.name === "prob-bands")).toBeUndefined();
    const data = series.find((s) => s.name === "guides")!.markLine!.data!;
    const beLine = data.find((item) => item.lineStyle?.color === palette.WARNING)!;
    expect(beLine.label).toBeUndefined();
  });

  test("opt-in props add a wash/band series, labelled breakevens and a ±1σ band", async () => {
    render(() => (
      <UIProvider>
        <PayoffChartCore
          legs={condor()}
          spot={24031.5}
          iv={0.138}
          dteYears={2 / 365}
          shadeProfitLoss={true}
          breakevens={[24000, 24400]}
          sigmaBand={[23800, 24300]}
        />
      </UIProvider>
    ));
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());

    const bands = lastOption().series!.find((s) => s.name === "prob-bands")!;
    expect(bands.markArea!.data!).toHaveLength(3);
    const [profitWash, lossWash, sigma] = bands.markArea!.data! as any[];
    expect(profitWash[0].itemStyle.color).toBe(palette.alpha(palette.POSITIVE, 0.08));
    expect(lossWash[0].itemStyle.color).toBe(palette.alpha(palette.NEGATIVE, 0.08));
    expect(sigma[0].label.formatter).toBe("±1σ");
    expect(sigma[0].xAxis).toBe("23800");

    const data = lastOption().series!.find((s) => s.name === "guides")!.markLine!.data! as any[];
    expect(data.find((item) => item.label?.formatter === "BE ₹24,000")).toMatchObject({
      xAxis: "24000",
      lineStyle: { color: palette.WARNING, type: "dotted" },
    });

    // Strike-line marks carry the same readable 10px as the axis ticks.
    expect(sigma[0].label.fontSize).toBeGreaterThanOrEqual(10);
    expect(
      data.find((item) => item.label?.formatter === "BE ₹24,000")!.label.fontSize,
    ).toBeGreaterThanOrEqual(10);
  });
});
