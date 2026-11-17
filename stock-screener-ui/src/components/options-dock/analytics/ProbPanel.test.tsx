// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import * as palette from "@/ui/palette";
import type { OptionsAnalytics } from "@/api/optionsAnalytics";
import type { DockLeg } from "@/state/optionsDock";

const chartStub = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(), on: vi.fn(), off: vi.fn() };
vi.mock("@/utils/loadEcharts", () => ({
  loadEcharts: vi.fn(async () => ({ init: vi.fn(() => chartStub) })),
}));

import { ProbPanel } from "./ProbPanel";

const legs: DockLeg[] = [
  { key: "CE|105", expiry: "2026-11-19", side: "buy", type: "CE", strike: 105, premium: 3, lots: 1, lotSize: 75 },
  { key: "PE|95", expiry: "2026-11-19", side: "buy", type: "PE", strike: 95, premium: 2, lots: 1, lotSize: 75 },
];

/** Long 100 put at ₹3: payoff = max(100−S, 0) − 3, so BE = 97. */
const longPut: DockLeg[] = [
  { key: "PE|100", expiry: "2026-11-19", side: "buy", type: "PE", strike: 100, premium: 3, lots: 1, lotSize: 1 },
];

function analytics(overrides: Partial<OptionsAnalytics["probability"]> = {}): OptionsAnalytics {
  return {
    symbol: "NIFTY",
    spot: 100,
    asOf: null,
    quotesLive: true,
    expiries: [],
    term: [],
    surface: { strikes: [], expiries: [], iv: [], missing: [] },
    levels: {
      callWall: null,
      putWall: null,
      maxPain: 100,
      gex: { support: null, resistance: null, fuelUp: null, fuelDown: null },
    },
    probability: {
      model: "rnd-svi",
      flatPop: 0.61,
      skewPop: 0.58,
      expectedPnl: -268,
      sigma: 39,
      density: [{ spot: 100, prob: 1 }],
      quantiles: { p05: null, p25: null, p50: null, p75: null, p95: null },
      cone: [],
      ...overrides,
    },
    warnings: [],
  };
}

type Option = {
  series?: { name?: string; markLine?: { data?: any[] }; markArea?: { data?: any[] } }[];
  graphic?: { style?: { text?: string } }[];
};
const option = (): Option => (chartStub.setOption.mock.calls.at(-1)?.[0] ?? {}) as Option;

function view(overrides: Partial<Parameters<typeof ProbPanel>[0]> = {}) {
  return render(() => (
    <UIProvider>
      <ProbPanel
        legs={legs}
        spot={100}
        iv={13.8}
        dteYears={7 / 365}
        data={analytics()}
        {...overrides}
      />
    </UIProvider>
  ));
}

afterEach(() => {
  cleanup();
  chartStub.setOption.mockClear();
  chartStub.dispose.mockClear();
});

describe("ProbPanel payoff canvas", () => {
  test("adds leg-strike and max-pain guides plus the probability visuals", async () => {
    view();
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());

    const guides = option().series!.find((series) => series.name === "guides")!.markLine!.data!;
    expect(guides.find((guide) => guide.label?.formatter === "CE 105")).toMatchObject({
      xAxis: "105",
      lineStyle: { color: palette.INFO, type: "dotted" },
    });
    expect(guides.find((guide) => guide.label?.formatter === "MP")).toMatchObject({
      xAxis: "100",
      lineStyle: { color: palette.PRIMARY, type: "dashed" },
    });

    const bands = option().series!.find((series) => series.name === "prob-bands");
    expect(bands?.markArea?.data).toHaveLength(3); // profit wash, loss wash, ±1σ band
    expect(bands!.markArea!.data![2][0].label?.formatter).toBe("±1σ");
  });

  test("keeps the flat-vol disclosure in the chart", async () => {
    view();
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());
    expect(option().graphic?.[0]?.style?.text).toBe("flat vol 13.8%");
  });

  test("labels a long put's breakeven at strike − premium", async () => {
    view({ legs: longPut });
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());

    const data = option().series!.find((series) => series.name === "guides")!.markLine!.data!;
    expect(data.find((item) => item.label?.formatter === "BE ₹97")).toMatchObject({
      xAxis: "97",
      lineStyle: { color: palette.WARNING, type: "dotted" },
    });
  });
});

describe("ProbPanel scenario row", () => {
  test("shows five spot shocks with profit/loss signs for a long put", async () => {
    view({ legs: longPut });
    await waitFor(() => expect(screen.getByTestId("prob-scenarios")).toBeInTheDocument());

    const row = screen.getByTestId("prob-scenarios");
    expect(row).toHaveTextContent("−10% +₹7");
    expect(row).toHaveTextContent("−5% +₹2");
    expect(row).toHaveTextContent("spot −₹3");
    expect(row).toHaveTextContent("+5% −₹3");
    expect(row).toHaveTextContent("+10% −₹3");
    expect(screen.getAllByTestId(/^prob-scenario-\d+$/)).toHaveLength(5);
    // The ladder is chart-adjacent text: 10px is the readability floor.
    expect((screen.getByTestId("prob-scenario-0") as HTMLElement).style.fontSize).toBe("10px");
  });
});

describe("ProbPanel metrics", () => {
  test("prints MODEL / POP / EXPECTED P&L / 1σ MOVE with a POP tooltip", async () => {
    view();
    await waitFor(() => expect(screen.getByTestId("prob-metric-density-value")).toHaveTextContent("skew-adjusted"));

    expect(screen.getByTestId("prob-metric-density")).toHaveTextContent("MODEL");
    expect(screen.getByTestId("prob-metric-pop")).toHaveTextContent("POP");
    expect(screen.getByTestId("prob-metric-pop-value")).toHaveTextContent("61.0% / 58.0%");
    expect(screen.getByTestId("prob-metric-pop").getAttribute("title")).toContain(
      "flat-vol POP / skew-adjusted POP",
    );
    expect(screen.getByTestId("prob-metric-pnl")).toHaveTextContent("EXPECTED P&L");
    expect(screen.getByTestId("prob-metric-pnl-value")).toHaveTextContent("₹268");
    expect(screen.getByTestId("prob-metric-sigma")).toHaveTextContent("1σ MOVE");
    expect(screen.getByTestId("prob-metric-sigma-value")).toHaveTextContent("₹39");
  });

  test("names a missing skew model instead of printing a bare slash", async () => {
    view({ data: analytics({ skewPop: null }) });
    await waitFor(() =>
      expect(screen.getByTestId("prob-metric-pop-value")).toHaveTextContent(
        "skew POP unavailable for stocks",
      ),
    );
    expect(screen.getByTestId("prob-metric-pop-value")).not.toHaveTextContent("/ —");
  });

  test("falls back to flat-vol wording without an analytics payload", async () => {
    view({ data: null });
    await waitFor(() => expect(screen.getByTestId("prob-metric-density-value")).toHaveTextContent("flat vol"));
    expect(screen.getByTestId("prob-metric-pop-value")).toHaveTextContent(
      "skew POP unavailable for stocks",
    );
  });
});

describe("ProbPanel empty state", () => {
  test("shows an empty state without legs and no chart or scenario row", async () => {
    view({ legs: [] });
    await waitFor(() => expect(screen.getByTestId("prob-empty")).toHaveTextContent("Add a leg to see probability"));
    expect(screen.queryByTestId("prob-chart")).not.toBeInTheDocument();
    expect(screen.queryByTestId("prob-scenarios")).not.toBeInTheDocument();
    expect(chartStub.setOption).not.toHaveBeenCalled();
  });
});
