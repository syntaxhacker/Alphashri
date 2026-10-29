// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { UIProvider } from "@/ui";

import {
  COIL_MAX_PCT,
  EXPANDING_MIN_PCT,
  NiftyCoilGauge,
  coilRatio,
  coilState,
  coilStateFromRegime,
} from "./NiftyCoilGauge";
import type { NiftyRegimeBlock } from "@/types/niftyReport";

afterEach(cleanup);

function TestWrapper({ children }: { children: React.ReactNode }) {
  return <UIProvider>{children}</UIProvider>;
}

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: TestWrapper });
}

function regime(overrides: Partial<NiftyRegimeBlock> = {}): NiftyRegimeBlock {
  return {
    verdict: "range_sell_premium",
    range_pts: 50,
    range_baseline_pts: 100,
    range_pct: 50,
    rv: 13.1,
    iv: 14.8,
    straddle_open: 200,
    straddle_now: 180,
    straddle_pct: -10,
    ...overrides,
  };
}

describe("coil state mapping", () => {
  test("COIL at/below 70%, NORMAL in between, EXPANDING at/above 125%", () => {
    expect(COIL_MAX_PCT).toBe(70);
    expect(EXPANDING_MIN_PCT).toBe(125);

    expect(coilState(0)).toBe("COIL");
    expect(coilState(70)).toBe("COIL");
    expect(coilState(70.01)).toBe("NORMAL");
    expect(coilState(100)).toBe("NORMAL");
    expect(coilState(124.99)).toBe("NORMAL");
    expect(coilState(125)).toBe("EXPANDING");
    expect(coilState(210)).toBe("EXPANDING");
  });

  test("absent / non-finite range has no state", () => {
    expect(coilState(null)).toBeNull();
    expect(coilState(undefined)).toBeNull();
    expect(coilState(NaN)).toBeNull();
  });

  test("ratio prefers range_pts / baseline, falls back to range_pct", () => {
    expect(coilRatio(regime())).toBeCloseTo(0.5);
    expect(
      coilRatio(
        regime({ range_pts: null, range_baseline_pts: null, range_pct: 140 }),
      ),
    ).toBeCloseTo(1.4);
    expect(
      coilRatio(
        regime({ range_pts: null, range_baseline_pts: null, range_pct: null }),
      ),
    ).toBeNull();
    expect(coilStateFromRegime(regime({ range_pts: 150 }))).toBe("EXPANDING");
  });
});

describe("NiftyCoilGauge", () => {
  test("renders COIL with ratio, hint and RV/IV context", () => {
    r(<NiftyCoilGauge regime={regime()} />);

    const gauge = screen.getByTestId("nifty-coil-gauge");
    expect(gauge).toHaveTextContent("COIL");
    expect(gauge).toHaveTextContent("0.5x");
    expect(screen.getByTestId("nifty-coil-hint")).toHaveTextContent(
      "coil: range 0.5x baseline · breakout risk",
    );
    expect(screen.getByTestId("nifty-coil-rv-iv")).toHaveTextContent(
      "RV 13.1 / IV 14.8",
    );
  });

  test("renders NORMAL for a baseline-sized range", () => {
    r(<NiftyCoilGauge regime={regime({ range_pts: 100 })} />);
    expect(screen.getByTestId("nifty-coil-state")).toHaveTextContent("NORMAL");
    expect(screen.getByTestId("nifty-coil-ratio")).toHaveTextContent("1.0x");
    expect(screen.getByTestId("nifty-coil-hint")).toHaveTextContent(
      "normal: range 1.0x baseline · baseline range",
    );
  });

  test("renders EXPANDING for an expanded range", () => {
    r(<NiftyCoilGauge regime={regime({ range_pts: 150 })} />);
    expect(screen.getByTestId("nifty-coil-state")).toHaveTextContent("EXPANDING");
    expect(screen.getByTestId("nifty-coil-ratio")).toHaveTextContent("1.5x");
    expect(screen.getByTestId("nifty-coil-hint")).toHaveTextContent(
      "expanding: range 1.5x baseline · trend underway",
    );
  });

  test("dashes everything when the regime block is absent", () => {
    r(<NiftyCoilGauge regime={undefined} />);
    expect(screen.getByTestId("nifty-coil-state")).toHaveTextContent("—");
    expect(screen.getByTestId("nifty-coil-ratio")).toHaveTextContent("—");
    expect(screen.getByTestId("nifty-coil-hint")).toHaveTextContent(
      "no range baseline",
    );
    expect(screen.getByTestId("nifty-coil-rv-iv")).toHaveTextContent(
      "RV — / IV —",
    );
  });
});
