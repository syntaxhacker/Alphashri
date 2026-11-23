// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";

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

// Spy on the payoff integral so the "single published snapshot" contract is
// provable: recomputing in the host would call payoffCurve a second time.
const { payoffCurveSpy } = vi.hoisted(() => ({ payoffCurveSpy: vi.fn() }));
vi.mock("@/utils/optionsMath", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/optionsMath")>();
  return {
    ...actual,
    payoffCurve: (...args: Parameters<typeof actual.payoffCurve>) => {
      payoffCurveSpy(...args);
      return actual.payoffCurve(...args);
    },
  };
});

import { PayoffWorkbench, buildLegGuides, toDockLegs, type WorkbenchLeg } from "./PayoffWorkbench";
import { buildPayoff, formatPop } from "@/components/options-dock/PayoffChartCore";
import { dteYearsBetween } from "@/utils/optionsMath";
import { formatNumberIN } from "@/utils/ui-helpers";
import * as palette from "@/ui/palette";

const SPOT = 24031.5;
const ASOF = "2026-11-17T09:15:00+05:30";
const EXPIRY = "2026-11-23";

function legs(): WorkbenchLeg[] {
  return [
    { action: "SELL", opt: "CE", strike: 24200, qty: 65, entryPremium: 36.6 },
    { action: "BUY", opt: "CE", strike: 24500, qty: 65, entryPremium: 3.5 },
    { action: "SELL", opt: "PE", strike: 23800, qty: 65, entryPremium: 23.1 },
    { action: "BUY", opt: "PE", strike: 23500, qty: 65, entryPremium: 1.8 },
  ];
}

function inr(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}₹${formatNumberIN(value)}`;
}

function renderWorkbench(overrides: Partial<Parameters<typeof PayoffWorkbench>[0]> = {}) {
  return render(() => (
    <UIProvider>
      <PayoffWorkbench
        legs={legs()}
        spot={SPOT}
        ivVolPoints={13.8}
        asOf={ASOF}
        expiry={EXPIRY}
        {...overrides}
      />
    </UIProvider>
  ));
}

afterEach(() => {
  cleanup();
  chartStub.setOption.mockClear();
  payoffCurveSpy.mockClear();
});

describe("pure leg mapping", () => {
  test("toDockLegs maps action/opt/premium/qty onto the dock contract", () => {
    expect(toDockLegs(legs(), EXPIRY)).toEqual([
      { key: "CE-24200", expiry: EXPIRY, side: "sell", type: "CE", strike: 24200, premium: 36.6, lots: 1, lotSize: 65 },
      { key: "CE-24500", expiry: EXPIRY, side: "buy", type: "CE", strike: 24500, premium: 3.5, lots: 1, lotSize: 65 },
      { key: "PE-23800", expiry: EXPIRY, side: "sell", type: "PE", strike: 23800, premium: 23.1, lots: 1, lotSize: 65 },
      { key: "PE-23500", expiry: EXPIRY, side: "buy", type: "PE", strike: 23500, premium: 1.8, lots: 1, lotSize: 65 },
    ]);
  });

  test("buildLegGuides emits one labelled dotted strike line per leg", () => {
    const guides = buildLegGuides(legs());
    expect(guides).toHaveLength(4);
    expect(guides[0]).toMatchObject({ x: 24200, dash: "dotted", color: palette.INFO, label: "CE 24,200" });
    expect(guides.map((guide) => guide.x)).toEqual([24200, 24500, 23800, 23500]);
  });
});

describe("PayoffWorkbench structure", () => {
  test("renders the workbench root and payoff chart with no dock footer", async () => {
    renderWorkbench({ dataTestId: "custom-workbench" });
    await screen.findByTestId("replay-payoff-chart");

    expect(screen.getByTestId("custom-workbench")).toBeInTheDocument();
    expect(screen.queryByTestId("replay-payoff-workbench")).not.toBeInTheDocument();
    expect(screen.queryByTestId("options-payoff-footer")).not.toBeInTheDocument();
    expect(screen.getByTestId("replay-matrix-kpis")).toBeVisible();
    expect(document.body.textContent).not.toMatch(/undefined|NaN/);
  });

  test("defaults to the replay-payoff-workbench testid", async () => {
    renderWorkbench();
    await screen.findByTestId("replay-payoff-workbench");
    expect(screen.getByTestId("replay-payoff-workbench")).toBeInTheDocument();
  });

  test("forwards rangePct into the sampled x range", async () => {
    renderWorkbench({ rangePct: 20 });
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());
    const categories = ((chartStub.setOption.mock.calls.at(-1)?.[0] as any)?.xAxis?.data ?? []) as string[];
    expect(Number(categories[0])).toBeCloseTo(SPOT * 0.8, 0);
    expect(Number(categories.at(-1))).toBeCloseTo(SPOT * 1.2, 0);
  });
});

describe("PayoffWorkbench KPI strip", () => {
  test("renders every KPI from the single published snapshot", async () => {
    const onSnapshot = vi.fn();
    renderWorkbench({ onSnapshot });
    await waitFor(() => expect(onSnapshot).toHaveBeenCalled());

    const expected = buildPayoff(toDockLegs(legs(), EXPIRY), SPOT, 0.138, dteYearsBetween(ASOF, EXPIRY), {
      widthPct: 10,
    })!;

    expect(screen.getByTestId("replay-matrix-kpi-debit")).toHaveTextContent(inr(expected.netPremium));
    expect(screen.getByTestId("replay-matrix-kpi-max-profit")).toHaveTextContent(inr(expected.maxProfit));
    expect(screen.getByTestId("replay-matrix-kpi-max-loss")).toHaveTextContent(inr(expected.maxLoss));
    expect(screen.getByTestId("replay-matrix-kpi-pop")).toHaveTextContent(formatPop(expected.pop));
    expect(screen.getByTestId("replay-matrix-kpi-breakevens")).toHaveTextContent(
      expected.breakevens.map((be) => `₹${formatNumberIN(be)}`).join(" / "),
    );
    expect(document.body.textContent).not.toMatch(/undefined|NaN/);
  });

  test("no second payoff integral: the host publishes the core's single snapshot", async () => {
    payoffCurveSpy.mockClear();
    const onSnapshot = vi.fn();
    renderWorkbench({ onSnapshot });
    await waitFor(() => expect(onSnapshot).toHaveBeenCalledTimes(1));

    expect(payoffCurveSpy).toHaveBeenCalledTimes(1);
  });

  test("null IV shows an honest — POP with the intrinsic-only tooltip", async () => {
    renderWorkbench({ ivVolPoints: null });
    await screen.findByTestId("replay-matrix-kpis");

    expect(screen.getByTestId("replay-matrix-kpi-pop")).toHaveTextContent("—");
    expect(screen.getByTestId("replay-matrix-kpi-pop-tooltip-wrapper")).toHaveAttribute(
      "aria-label",
      "IV unavailable — intrinsic only",
    );
    expect(document.body.textContent).not.toMatch(/undefined|NaN/);
  });

  test("empty legs show placeholders rather than NaN or undefined", async () => {
    renderWorkbench({ legs: [] });
    await screen.findByTestId("replay-matrix-kpis");

    for (const id of [
      "replay-matrix-kpi-debit",
      "replay-matrix-kpi-max-loss",
      "replay-matrix-kpi-max-profit",
      "replay-matrix-kpi-pop",
      "replay-matrix-kpi-breakevens",
    ]) {
      expect(screen.getByTestId(id)).toHaveTextContent("—");
    }
    expect(document.body.textContent).not.toMatch(/undefined|NaN/);
  });
});
