// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { createSignal } from "solid-js";
import { render, screen, fireEvent, waitFor } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import { FnoRowDetail } from "./FnoScreenerTab";
import type { FnoScreenerRow } from "../../api/fnoScreener";

// Mock PayoffChart so happy-dom never loads ECharts. Captures the props it is
// called with so the test can assert which row's legs were rendered.
let capturedProps: any = null;
vi.mock("@/components/options/PremiumTracker/PayoffChart", () => ({
  PayoffChart: (props: any) => {
    capturedProps = props;
    return <div data-testid="mock-payoff-chart">{props.legs?.[0]?.strike ?? "-"}</div>;
  },
}));

const rowA: FnoScreenerRow = {
  symbol: "RELIANCE", spot: 2946, d1: 1.25, d5: 4.6, vol_ratio: 1.4, above20: 1,
  setup: "BREAKOUT", call: "CE", strike: 3000, otm_pct: 1.83, premium: 45.5,
  cost_lot: 9100, breakeven: 3045.5, pop: 62, delta: 0.55, gamma: 0.012, theta: -18.5,
  vega: 0.42, iv: 22.5, oi: 125000, volume: 45000, spread_pct: 0.8, move_2pct_est: 3.4,
};
const rowB: FnoScreenerRow = {
  ...rowA,
  symbol: "TCS", spot: 4150, setup: "BASE", call: "PE", strike: 4200, premium: 32,
  cost_lot: 6400, breakeven: 4168, pop: 48, move_2pct_est: 1.2,
};

describe("FnoRowDetail", () => {
  it("rebuilds payoff legs when the row prop changes instead of pinning the first row", async () => {
    function TestHost() {
      const [row, setRow] = createSignal<FnoScreenerRow>(rowA);
      return (
        <>
          <FnoRowDetail row={row()} />
          <button data-testid="switch-row" onClick={() => setRow(rowB)}>
            switch
          </button>
        </>
      );
    }
    render(() => <UIProvider><TestHost /></UIProvider>);

    // Initial render: legs built from rowA (strike 3000).
    await waitFor(() => expect(screen.getByTestId("mock-payoff-chart")).toHaveTextContent("3000"));
    expect(capturedProps.legs[0].strike).toBe(3000);

    fireEvent.click(screen.getByTestId("switch-row"));

    // Same `FnoRowDetail` instance, new `props.row`: legs must be rebuilt from
    // rowB (strike 4200). When `legs` is read at body level it stays pinned to
    // rowA forever and this assertion times out.
    await waitFor(() => expect(screen.getByTestId("mock-payoff-chart")).toHaveTextContent("4200"));
    expect(capturedProps.legs[0].strike).toBe(4200);
  });
});
