// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";

const chartStub = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
vi.mock("@/utils/loadEcharts", () => ({
  loadEcharts: vi.fn(async () => ({ init: vi.fn(() => chartStub) })),
}));

import { normalizeDashboard } from "@/api/optionsDashboard";
import { VolatilityPillar } from "@/components/options-dashboard/VolatilityPillar";
import type { OptionsDashboardData } from "@/types/optionsDashboard";

const STRIKES = [100, 101, 102];

/** A wire payload whose RV block is a live cone (no rv5/rv30 scalars). */
function wire(withTenors: boolean): Record<string, unknown> {
  const tenors = withTenors
    ? [
        { days: 7, current: 17.2, p10: 12, p25: 14, p50: 16, p75: 19, p90: 22, rank_pct: 55 },
        { days: 30, current: 18.4, p10: 13, p25: 15, p50: 17, p75: 20, p90: 24, rank_pct: 68 },
      ]
    : [
        { days: 7, current: null, p10: null, p25: null, p50: null, p75: null, p90: null, rank_pct: null },
      ];
  return {
    symbol: "AAPL",
    spot: 101,
    quotesLive: true,
    expiries: [{
      date: "2026-11-26",
      dteDays: 9,
      atmIv: 22.4,
      iv: STRIKES.map((strike, index) => ({
        strike,
        ceIv: 22 + index,
        peIv: 23 + index,
        ceDelta: 0.5 - index * 0.2,
        peDelta: -0.5 + index * 0.2,
        ceOi: 100 + index,
        peOi: 90 + index,
      })),
      rnd: { density: STRIKES.map((spot, index) => ({ spot, prob: 0.2 + index * 0.1 })) },
    }],
    term: [{ dte: 9, atmIv: 22.4, rr25: 0.8, bf25: 0.6 }],
    rv: {
      cone: { symbol: "AAPL", as_of: "2026-11-17", tenors, warnings: [] },
      ivVsRv: { rows: [], warnings: [] },
    },
  };
}

function view(data: OptionsDashboardData) {
  return render(() => (
    <UIProvider>
      <VolatilityPillar data={data} selectedExpiry={null} onExpiry={() => {}} />
    </UIProvider>
  ));
}

const chartOptions = () => chartStub.setOption.mock.calls.map((call) => call[0] as any);
const optionWith = (name: string) =>
  chartOptions().find((option) => option.series?.some((series: any) => series.name === name));
const seriesNamed = (name: string) =>
  optionWith(name)?.series?.find((series: any) => series.name === name);

afterEach(() => {
  cleanup();
  chartStub.setOption.mockClear();
  chartStub.dispose.mockClear();
});

describe("RV cone → volatility panel", () => {
  test("a cone with tenors renders the RV series with no 'RV unavailable' reason", async () => {
    const data = normalizeDashboard(wire(true));
    expect(data.realisedVol).toEqual([{ dte: 7, value: 17.2 }, { dte: 30, value: 18.4 }]);

    view(data);
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());

    expect(screen.getByTestId("vol-metric-rv-value")).toHaveTextContent("2");
    expect(screen.queryByTestId("volatility-caption-note-reason")).toBeNull();
    expect(seriesNamed("RV")?.data).toEqual([[7, 17.2], [30, 18.4]]);
    expect(seriesNamed("RV p05")).toBeDefined();
    expect(seriesNamed("RV p95")).toBeDefined();
  });

  test("a null/empty cone fails soft with the 'RV unavailable' reason", async () => {
    const data = normalizeDashboard(wire(false));
    expect(data.realisedVol).toEqual([]);

    view(data);
    await waitFor(() =>
      expect(screen.getByTestId("volatility-caption-note-reason")).toBeInTheDocument(),
    );

    expect(screen.getByTestId("volatility-caption-note-reason")).toHaveTextContent("RV unavailable");
    expect(screen.getByTestId("vol-metric-rv-value")).toHaveTextContent("n/a");
    expect(seriesNamed("RV")).toBeUndefined();
    expect(seriesNamed("ATM IV")).toBeDefined();
  });
});
