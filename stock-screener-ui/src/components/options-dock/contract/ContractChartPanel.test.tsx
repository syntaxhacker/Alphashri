// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import * as palette from "@/ui/palette";

const chartStub = {
  setOption: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
};
const echartsInit = vi.fn(() => chartStub);
vi.mock("@/utils/loadEcharts", () => ({
  loadEcharts: vi.fn(async () => ({ init: echartsInit })),
}));
vi.mock("@/api/optionsContractChart", () => ({
  fetchContractCandles: vi.fn(),
}));

import { fetchContractCandles } from "@/api/optionsContractChart";
import type { ContractCandles, ContractInterval } from "@/api/optionsContractChart";
import {
  ContractChartPanel,
  buildContractChartOption,
  type ContractChartSelection,
} from "./ContractChartPanel";

const mockedFetch = vi.mocked(fetchContractCandles);

const SELECTION: ContractChartSelection = {
  instrumentKey: "NSE_FO|123",
  symbol: "IRFC",
  expiry: "2026-11-23",
  strike: 90,
  side: "CE",
  ltp: 3.45,
  spot: 89.2,
};

function frame(interval: ContractInterval = "1m"): ContractCandles {
  return {
    instrumentKey: SELECTION.instrumentKey,
    interval,
    candles: [
      { timestamp: "2026-11-17T09:15:00+05:30", open: 3.2, high: 3.5, low: 3.1, close: 3.4, volume: 1200, oi: 4500 },
      { timestamp: "2026-11-17T09:16:00+05:30", open: 3.4, high: 3.7, low: 3.3, close: 3.6, volume: 900, oi: 4700 },
      { timestamp: "2026-11-17T09:18:00+05:30", open: 3.6, high: 3.8, low: 3.5, close: 3.7, volume: 1500, oi: 4900 },
    ],
    source: "upstox",
    cached: false,
    emptyReason: null,
  };
}

function renderPanel(onBack = vi.fn()) {
  return {
    onBack,
    ...render(() => (
      <UIProvider>
        <ContractChartPanel selection={SELECTION} onBack={onBack} />
      </UIProvider>
    )),
  };
}

beforeEach(() => {
  mockedFetch.mockReset();
  echartsInit.mockClear();
  chartStub.setOption.mockClear();
  chartStub.dispose.mockClear();
  mockedFetch.mockImplementation(async (params) => frame(params.interval));
});

afterEach(() => {
  cleanup();
});

describe("ContractChartPanel chrome", () => {
  test("paints the contract title, LTP and spot after the first frame", async () => {
    renderPanel();

    await screen.findByTestId("contract-chart");

    expect(screen.getByTestId("contract-chart-title")).toHaveTextContent("IRFC 90 CE · 23 Nov");
    expect(screen.getByTestId("contract-chart-ltp")).toHaveTextContent("₹3.45");
    expect(screen.getByTestId("contract-chart-spot")).toHaveTextContent("89.20");
    expect(screen.getByTestId("contract-chart")).toBeInTheDocument();
  });

  test("renders the three interval labels and both chart controls", async () => {
    renderPanel();
    await screen.findByTestId("contract-chart");

    expect(screen.getByTestId("contract-chart-interval-1m")).toHaveTextContent("1m");
    expect(screen.getByTestId("contract-chart-interval-5m")).toHaveTextContent("5m");
    expect(screen.getByTestId("contract-chart-interval-15m")).toHaveTextContent("15m");
    expect(screen.getByTestId("contract-chart-oi")).toHaveTextContent("OI");
    expect(screen.getByTestId("contract-chart-refresh")).toHaveAttribute("aria-label", "Refresh contract chart");
  });

  test("the panel exposes a region label built from the selection", async () => {
    renderPanel();
    await screen.findByTestId("contract-chart");

    expect(screen.getByTestId("contract-chart-panel")).toHaveAttribute(
      "aria-label",
      "IRFC 90 CE · 23 Nov contract chart",
    );
  });

  test("Back calls onBack exactly once", async () => {
    const onBack = vi.fn();
    renderPanel(onBack);
    await screen.findByTestId("contract-chart");

    fireEvent.click(screen.getByTestId("contract-chart-back"));

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe("ContractChartPanel states", () => {
  test("shows the loading skeleton only before any frame arrives", async () => {
    mockedFetch.mockImplementation(() => new Promise<never>(() => {}));
    renderPanel();

    expect(screen.getByTestId("contract-chart-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("contract-chart")).toBeNull();
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("contract-chart")).toBeNull();
  });

  test("renders the empty contract message when the candle list is empty", async () => {
    mockedFetch.mockResolvedValue({ ...frame(), candles: [], emptyReason: "market_closed" });
    renderPanel();

    const empty = await screen.findByTestId("contract-chart-empty");

    expect(empty).toHaveTextContent("No trades for this contract yet");
    expect(screen.getByTestId("contract-chart")).toBeInTheDocument();
  });

  test("renders the error state and Retry refetches", async () => {
    mockedFetch
      .mockRejectedValueOnce(new Error("Upstream down"))
      .mockImplementationOnce(async (params) => frame(params.interval));
    renderPanel();

    const error = await screen.findByTestId("contract-chart-error");
    expect(error).toHaveTextContent("Upstream down");
    expect(screen.queryByTestId("contract-chart")).toBeNull();

    fireEvent.click(screen.getByTestId("contract-chart-retry"));

    await screen.findByTestId("contract-chart");
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  test("keeps the previous chart dimmed while the next interval loads", async () => {
    mockedFetch.mockImplementationOnce(async () => frame("1m"));
    renderPanel();
    await screen.findByTestId("contract-chart");

    mockedFetch.mockImplementationOnce(() => new Promise<never>(() => {}));
    fireEvent.click(screen.getByTestId("contract-chart-interval-5m"));

    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("contract-chart")).toBeInTheDocument();
    expect(screen.queryByTestId("contract-chart-loading")).toBeNull();
    expect(screen.getByText("Loading 5m")).toBeInTheDocument();
  });
});

describe("ContractChartPanel fetching", () => {
  test("switching the interval issues exactly one request for that interval and aborts the old one", async () => {
    renderPanel();
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId("contract-chart-interval-5m"));

    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(2));
    expect(mockedFetch.mock.calls[1][0]).toMatchObject({
      instrumentKey: SELECTION.instrumentKey,
      interval: "5m",
      days: 1,
    });

    const firstInit = mockedFetch.mock.calls[0][1] as RequestInit;
    expect((firstInit.signal as AbortSignal).aborted).toBe(true);
  });

  test("the refresh control refetches the current interval", async () => {
    renderPanel();
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId("contract-chart-refresh"));

    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(2));
    expect((mockedFetch.mock.calls[1][0] as { interval: string }).interval).toBe("1m");
  });

  test("unmount aborts the in-flight request", async () => {
    mockedFetch.mockImplementation(() => new Promise<never>(() => {}));
    const view = renderPanel();
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(1));

    view.unmount();

    const init = mockedFetch.mock.calls[0][1] as RequestInit;
    expect((init.signal as AbortSignal).aborted).toBe(true);
  });
});

describe("buildContractChartOption", () => {
  test("uses two containLabel grids, 10px time labels and premium + volume series", () => {
    const option = buildContractChartOption({ candles: frame().candles, ink: palette.CHART_MUTED, showOi: false });
    const grid = option.grid as Array<Record<string, unknown>>;
    const xAxis = option.xAxis as Array<Record<string, unknown>>;
    const series = option.series as Array<Record<string, unknown>>;

    expect(grid).toHaveLength(2);
    expect(grid.every((item) => item.containLabel === true)).toBe(true);
    expect(xAxis).toHaveLength(2);
    expect((xAxis[1].axisLabel as Record<string, unknown>).fontSize).toBe(12);
    expect((xAxis[1].axisLabel as Record<string, unknown>).color).toBe(palette.CHART_MUTED);
    expect(series.map((item) => item.type)).toEqual(["line", "bar"]);
    expect(series[0].data).toEqual([
      [Date.parse("2026-11-17T09:15:00+05:30"), 3.4],
      [Date.parse("2026-11-17T09:16:00+05:30"), 3.6],
      [Date.parse("2026-11-17T09:18:00+05:30"), 3.7],
    ]);
  });

  test("adds the OI line on a secondary right-hand axis only when toggled on", () => {
    const off = buildContractChartOption({ candles: frame().candles, ink: palette.CHART_MUTED, showOi: false });
    expect((off.series as unknown[]).length).toBe(2);
    expect((off.yAxis as unknown[]).length).toBe(2);

    const on = buildContractChartOption({ candles: frame().candles, ink: palette.CHART_MUTED, showOi: true });
    const series = on.series as Array<Record<string, unknown>>;
    const yAxis = on.yAxis as Array<Record<string, unknown>>;

    expect(series).toHaveLength(3);
    expect(series[2]).toMatchObject({ name: "OI", type: "line", yAxisIndex: 2 });
    expect(yAxis).toHaveLength(3);
    expect(yAxis[2]).toMatchObject({ position: "right", gridIndex: 0 });
  });

  test("does not draw a flat OI line when the contract has no published open interest", () => {
    const noOi = frame().candles.map((candle) => ({ ...candle, oi: 0 }));
    const option = buildContractChartOption({ candles: noOi, ink: palette.CHART_MUTED, showOi: true });

    expect((option.series as unknown[]).length).toBe(2);
    expect((option.yAxis as unknown[]).length).toBe(2);
  });
});
