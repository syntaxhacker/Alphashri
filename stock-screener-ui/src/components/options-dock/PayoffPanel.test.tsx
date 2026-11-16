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

import { PayoffPanel, buildPayoff } from "./PayoffPanel";
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

afterEach(() => {
  cleanup();
  chartStub.setOption.mockClear();
});

describe("buildPayoff", () => {
  test("matches the §4.1 analytic case to the rupee", () => {
    const snapshot = buildPayoff(condor(), 24031.5, 0.138, 2 / 365);

    expect(snapshot).not.toBeNull();
    expect(snapshot!.points).toHaveLength(241);
    // The plan's fixture asserts ±0.5 pt; 23745.6 is within it.
    expect(snapshot!.breakevens[0]).toBeGreaterThan(23744);
    expect(snapshot!.breakevens[0]).toBeLessThan(23746);
    expect(snapshot!.breakevens[1]).toBeGreaterThan(24253);
    expect(snapshot!.breakevens[1]).toBeLessThan(24255);
    expect(snapshot!.maxProfit).toBeCloseTo(3536, 0);
    expect(snapshot!.maxLoss).toBeCloseTo(-15964, 0);
    expect(snapshot!.pop).toBeCloseTo(0.697, 2);
    expect(Math.abs(snapshot!.expectedPnl)).toBeLessThan(50);
  });

  test("returns null for an empty basket and for a non-positive spot", () => {
    expect(buildPayoff([], 24000, 0.14, 0.01)).toBeNull();
    expect(buildPayoff(condor(), 0, 0.14, 0.01)).toBeNull();
  });

  test("missing IV yields no POP number rather than 0 %", () => {
    const snapshot = buildPayoff(condor(), 24031.5, Number.NaN, 2 / 365);
    expect(Number.isNaN(snapshot!.pop)).toBe(true);
    expect(Number.isNaN(snapshot!.expectedPnl)).toBe(true);
    // The payoff curve itself is IV-free, so it still exists.
    expect(snapshot!.points).toHaveLength(241);
  });
});

describe("PayoffPanel recompute gate", () => {
  test("a spot move below 0.05 % does not rebuild the chart option", async () => {
    const [spot, setSpot] = createSignal(24031.5);
    render(() => (
      <UIProvider>
        <PayoffPanel legs={condor()} spot={spot()} iv={13.8} dteYears={2 / 365} />
      </UIProvider>
    ));
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());
    const drawsAfterMount = chartStub.setOption.mock.calls.length;

    // +₹5 on 24 031 = 0.02 %: inside the gate, so no redraw.
    setSpot(24036.5);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(chartStub.setOption.mock.calls.length).toBe(drawsAfterMount);

    // +₹50 = 0.21 %: outside the gate, so one redraw.
    setSpot(24081.5);
    await waitFor(() =>
      expect(chartStub.setOption.mock.calls.length).toBeGreaterThan(drawsAfterMount),
    );
  });

  test("renders the empty state with no legs", async () => {
    render(() => (
      <UIProvider>
        <PayoffPanel legs={[]} spot={24031.5} iv={13.8} dteYears={2 / 365} />
      </UIProvider>
    ));
    expect(screen.getByTestId("options-payoff-empty")).toBeInTheDocument();
    expect(screen.getByTestId("options-pop")).toHaveTextContent("—");
    // The footer survives the empty state: four cells, every value a dash.
    expect(screen.getByTestId("options-payoff-footer")).toBeInTheDocument();
    for (const id of [
      "options-breakevens",
      "options-max-pnl",
      "options-expected-pnl",
      "options-expected-move",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.getByTestId("options-breakevens")).toHaveTextContent("BE");
    expect(screen.getByTestId("options-max-pnl")).toHaveTextContent("MAX P/L");
    expect(screen.getByTestId("options-expected-pnl")).toHaveTextContent("MODEL E[P&L]");
    expect(screen.getByTestId("options-expected-move")).toHaveTextContent("±1σ");
  });
});

type Series = {
  name?: string;
  data?: (number | null)[];
  connectNulls?: boolean;
  lineStyle?: { color?: string };
  areaStyle?: { color?: string };
  z?: number;
};

/** The most recent option option the panel pushed to the chart stub. */
function lastSeries(): Series[] {
  const call = chartStub.setOption.mock.calls.at(-1)?.[0] as { series?: Series[] } | undefined;
  return call?.series ?? [];
}

describe("PayoffPanel series split", () => {
  async function renderCondor() {
    render(() => (
      <UIProvider>
        <PayoffPanel legs={condor()} spot={24031.5} iv={13.8} dteYears={2 / 365} />
      </UIProvider>
    ));
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());
  }

  test("profit and loss are two series over the same 241-point grid", async () => {
    await renderCondor();
    const series = lastSeries();
    const profit = series.find((s) => s.name === "P&L at expiry" && s.lineStyle?.color === palette.POSITIVE);
    const loss = series.find((s) => s.name === "P&L at expiry" && s.lineStyle?.color === palette.NEGATIVE);

    expect(profit).toBeDefined();
    expect(loss).toBeDefined();
    expect(profit!.data).toHaveLength(241);
    expect(loss!.data).toHaveLength(241);
    expect(profit!.connectNulls).toBe(false);
    expect(loss!.connectNulls).toBe(false);
  });

  test("the profit series nulls every losing point, the loss series every winning one", async () => {
    await renderCondor();
    const snapshot = buildPayoff(condor(), 24031.5, 0.138, 2 / 365)!;
    const series = lastSeries();
    const profit = series.find((s) => s.lineStyle?.color === palette.POSITIVE)!.data!;
    const loss = series.find((s) => s.lineStyle?.color === palette.NEGATIVE)!.data!;

    let winners = 0;
    let losers = 0;
    snapshot.points.forEach((point, i) => {
      if (point.pnl >= 0) {
        winners += 1;
        expect(profit[i]).not.toBeNull();
        expect(loss[i]).toBeNull();
      } else {
        losers += 1;
        expect(loss[i]).not.toBeNull();
        expect(profit[i]).toBeNull();
      }
    });
    // A condor is profitable in the middle and losing on both wings: the fixture
    // is only meaningful if both halves actually carry points.
    expect(winners).toBeGreaterThan(0);
    expect(losers).toBeGreaterThan(0);
  });

  test("no PRIMARY payoff line is left and the probability band sits behind", async () => {
    await renderCondor();
    const series = lastSeries();
    expect(series.some((s) => s.lineStyle?.color === palette.PRIMARY)).toBe(false);

    const probability = series.find((s) => s.name === "P(S)")!;
    expect(probability.z).toBeLessThan(
      series.find((s) => s.lineStyle?.color === palette.POSITIVE)!.z!,
    );
    // areaStyle colour is an rgba() tint of INFO at an alpha ≤ 0.12.
    expect(probability.areaStyle?.color).toBe(palette.alpha(palette.INFO, 0.1));
    const alphaOf = Number(/,\s*([\d.]+)\)$/.exec(probability.areaStyle!.color!)?.[1]);
    expect(alphaOf).toBeLessThanOrEqual(0.12);
  });

  test("guides ride their own series so a one-sided basket still shows the axis lines", async () => {
    await renderCondor();
    const guides = lastSeries().find((s) => s.name === "guides");
    expect(guides).toBeDefined();
    expect(guides!.data).toEqual([]);
  });
});

describe("PayoffPanel footer", () => {
  async function renderCondor() {
    render(() => (
      <UIProvider>
        <PayoffPanel legs={condor()} spot={24031.5} iv={13.8} dteYears={2 / 365} />
      </UIProvider>
    ));
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());
  }

  test("the four metrics read as labelled cells, not one run-on line", async () => {
    await renderCondor();
    const footer = screen.getByTestId("options-payoff-footer");
    expect(footer.children).toHaveLength(4);

    expect(screen.getByTestId("options-breakevens")).toHaveTextContent("BE");
    expect(screen.getByTestId("options-breakevens-value")).toHaveTextContent("23,7");
    expect(screen.getByTestId("options-max-pnl")).toHaveTextContent("MAX P/L");
    expect(screen.getByTestId("options-max-pnl-value")).toHaveTextContent("+3.5K");
    expect(screen.getByTestId("options-max-pnl-value")).toHaveTextContent("−16.0K");
    expect(screen.getByTestId("options-expected-move-value")).toHaveTextContent(/\d/);
  });

  test("every cell but the first is divided by a left hairline", async () => {
    await renderCondor();
    const cells = screen.getByTestId("options-payoff-footer").children;
    expect(cells[0].className).not.toContain("border-l");
    for (const cell of Array.from(cells).slice(1)) {
      expect(cell.className).toContain("border-l");
    }
  });

  test("MODEL E[P&L] is signed and coloured by its sign", async () => {
    await renderCondor();
    const value = screen.getByTestId("options-expected-pnl-value");
    const pnl = buildPayoff(condor(), 24031.5, 0.138, 2 / 365)!.expectedPnl;
    // Fair-value condor: the model edge is within a few rupees of zero, so assert
    // the colour against the computed sign rather than a hardcoded direction.
    expect(value.style.color).toBe(pnl > 0 ? palette.POSITIVE : pnl < 0 ? palette.NEGATIVE : "");
  });

  test("the chart keeps room under the plot for the axis labels", async () => {
    await renderCondor();
    const call = chartStub.setOption.mock.calls.at(-1)?.[0] as { grid?: { bottom?: number } };
    expect(call.grid?.bottom).toBeGreaterThanOrEqual(18);
  });
});
