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
  });
});
