// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { UIProvider } from "@/ui";
import * as palette from "@/ui/palette";
import type { NiftyGex } from "@/types/niftyReport";
import {
  NiftyGexProfile,
  buildGexChart,
  buildGexProfile,
  formatGexCr,
  formatGexStrike,
  gexProfileStats,
  gexTone,
} from "./NiftyGexProfile";

afterEach(cleanup);

function TestWrapper({ children }: { children: React.ReactNode }) {
  return <UIProvider>{children}</UIProvider>;
}

function gex(overrides?: Partial<NiftyGex>): NiftyGex {
  return {
    strikes: [
      // deliberately unsorted to prove buildGexProfile sorts ascending
      { strike: 22700, callGex: 5, putGex: -3, netGex: -2 },
      { strike: 22600, callGex: 1, putGex: 2, netGex: 12 },
      { strike: 22800, callGex: 9, putGex: -9, netGex: -8 },
    ],
    netTotal: 7.5,
    regime: "long",
    topPositive: [{ strike: 22600, netGex: 12 }],
    topNegative: [{ strike: 22800, netGex: -8 }],
    zeroCross: 22650,
    ...overrides,
  };
}

describe("buildGexProfile", () => {
  test("sorts strikes ascending from an unsorted payload", () => {
    expect(buildGexProfile(gex()).map((p) => p.strike)).toEqual([22600, 22700, 22800]);
  });

  test("undefined / empty / malformed input yields []", () => {
    expect(buildGexProfile(undefined)).toEqual([]);
    expect(buildGexProfile(gex({ strikes: [] }))).toEqual([]);
  });

  test("drops rows with non-finite strike or netGex", () => {
    const profile = buildGexProfile(
      gex({
        strikes: [
          { strike: 22600, callGex: 0, putGex: 0, netGex: 3 },
          { strike: Number.NaN, callGex: 0, putGex: 0, netGex: 4 },
          { strike: 22700, callGex: 0, putGex: 0, netGex: Number.NaN },
        ],
      }),
    );
    expect(profile).toEqual([{ strike: 22600, netGex: 3 }]);
  });
});

describe("gexProfileStats", () => {
  test("passes through netTotal / zeroCross and finds peak / trough strikes", () => {
    const s = gexProfileStats(gex(), 22700);
    expect(s.netTotal).toBe(7.5);
    expect(s.zeroCross).toBe(22650);
    expect(s.regime).toBe("LONG");
    expect(s.peakStrike).toBe(22600);
    expect(s.troughStrike).toBe(22800);
  });

  test("absent gex -> nulls and empty regime", () => {
    expect(gexProfileStats(undefined, 22700)).toEqual({
      netTotal: null,
      zeroCross: null,
      regime: "",
      peakStrike: null,
      troughStrike: null,
    });
  });

  test("null zeroCross stays null; regime is normalised to uppercase", () => {
    const s = gexProfileStats(gex({ zeroCross: null, regime: "short" }), 22700);
    expect(s.zeroCross).toBeNull();
    expect(s.regime).toBe("SHORT");
  });

  test("ties on peak/trough break toward the strike nearest spot", () => {
    const s = gexProfileStats(
      gex({
        strikes: [
          { strike: 22600, callGex: 0, putGex: 0, netGex: 5 },
          { strike: 22800, callGex: 0, putGex: 0, netGex: 5 },
        ],
        zeroCross: null,
      }),
      22750,
    );
    // 22,800 is 50pts from spot vs 150pts for 22,600 -> 22,800 wins the tie.
    expect(s.peakStrike).toBe(22800);
    expect(s.troughStrike).toBe(22800);
  });
});

describe("buildGexChart", () => {
  test("labels track strikes in ascending order with Indian grouping", () => {
    const profile = buildGexProfile(gex());
    const chart = buildGexChart(profile, gexProfileStats(gex(), 22700), 22700);
    expect(chart.labels).toEqual(["22,600", "22,700", "22,800"]);
  });

  test("single Net GEX series carries netGex values in strike order", () => {
    const profile = buildGexProfile(gex());
    const chart = buildGexChart(profile, gexProfileStats(gex(), 22700), 22700);
    expect(chart.series).toHaveLength(1);
    expect(chart.series[0].name).toBe("Net GEX");
    expect(chart.series[0].points).toEqual([12, -2, -8]);
    expect(chart.series[0].area).toBe(true);
  });

  test("zeroLine is always true", () => {
    const profile = buildGexProfile(gex());
    const chart = buildGexChart(profile, gexProfileStats(gex(), 22700), 22700);
    expect(chart.zeroLine).toBe(true);
  });

  test("SPOT marker sits on the spot strike index", () => {
    const profile = buildGexProfile(gex());
    const chart = buildGexChart(profile, gexProfileStats(gex(), 22700), 22700);
    const spot = chart.markers.find((m) => m.label === "SPOT");
    expect(spot?.index).toBe(1);
    expect(spot?.color).toBe(palette.TERM_SPOT);
  });

  test("ZERO marker exists when zeroCross matches a profile strike", () => {
    const withZero = gex({ zeroCross: 22800 });
    const profile = buildGexProfile(withZero);
    const chart = buildGexChart(profile, gexProfileStats(withZero, 22700), 22700);
    const zero = chart.markers.find((m) => m.label === "ZERO");
    expect(zero?.index).toBe(2);
    expect(zero?.color).toBe(palette.TERM_FLIP);
  });

  test("default fixture zeroCross (off-profile) yields no ZERO marker", () => {
    // 22,650 is not one of the profile strikes, so it is skipped.
    const profile = buildGexProfile(gex());
    const chart = buildGexChart(profile, gexProfileStats(gex(), 22700), 22700);
    expect(chart.markers.map((m) => m.label)).not.toContain("ZERO");
  });

  test("ZERO omitted when zeroCross is null; SPOT omitted when off-profile", () => {
    const nullable = gex({ zeroCross: null });
    const profile = buildGexProfile(nullable);
    const stats = gexProfileStats(nullable, 22700);
    const chart = buildGexChart(profile, stats, 22700);
    const names = chart.markers.map((m) => m.label);
    expect(names).not.toContain("ZERO");
    expect(names).toContain("SPOT");

    const offProfile = buildGexChart(profile, stats, 22999);
    expect(offProfile.markers.map((m) => m.label)).not.toContain("SPOT");
  });
});

describe("format helpers", () => {
  test("formatGexCr signs and fixes to 2 dp, dashes absent values", () => {
    expect(formatGexCr(7.5)).toBe("+7.50 Cr");
    expect(formatGexCr(-8)).toBe("-8.00 Cr");
    expect(formatGexCr(0)).toBe("0.00 Cr");
    expect(formatGexCr(null)).toBe("—");
  });

  test("formatGexStrike groups Indian-style and dashes absent values", () => {
    expect(formatGexStrike(22650)).toBe("22,650");
    expect(formatGexStrike(null)).toBe("—");
  });

  test("gexTone maps sign to palette tokens", () => {
    expect(gexTone(3)).toBe(palette.TERM_GAMMA);
    expect(gexTone(-3)).toBe(palette.TERM_GAMMA_NEG);
    expect(gexTone(0)).toBe(palette.TEXT_MUTED);
    expect(gexTone(null)).toBe(palette.TEXT_MUTED);
  });
});

describe("NiftyGexProfile render", () => {
  test("renders the panel, stat row and SVG chart", () => {
    render(<NiftyGexProfile gex={gex()} spot={22700} />, { wrapper: TestWrapper });

    expect(screen.getByTestId("nifty-gex-profile-panel")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-gex-profile-net")).toHaveTextContent("+7.50 Cr");
    expect(screen.getByTestId("nifty-gex-profile-zero")).toHaveTextContent("22,650");
    expect(screen.getByTestId("nifty-gex-profile-regime")).toHaveTextContent("LONG GAMMA");

    const chart = screen.getByTestId("nifty-gex-profile-chart");
    expect(chart).toBeInTheDocument();
    expect(chart.querySelector("svg")).not.toBeNull();
    expect(screen.queryByText("No per-strike GEX profile")).not.toBeInTheDocument();
  });

  test("undefined gex shows the empty state and never crashes", () => {
    render(<NiftyGexProfile spot={22700} />, { wrapper: TestWrapper });

    expect(screen.getByTestId("nifty-gex-profile-panel")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-gex-profile-chart")).toBeInTheDocument();
    expect(screen.getByText("No per-strike GEX profile")).toBeInTheDocument();
    // stat row degrades to dashes
    expect(screen.getByTestId("nifty-gex-profile-net")).toHaveTextContent("—");
    expect(screen.getByTestId("nifty-gex-profile-regime")).toHaveTextContent("—");
  });

  test("empty strike list also renders the empty state", () => {
    render(<NiftyGexProfile gex={gex({ strikes: [] })} spot={22700} />, {
      wrapper: TestWrapper,
    });
    expect(screen.getByTestId("nifty-gex-profile-chart")).toBeInTheDocument();
    expect(screen.getByText("No per-strike GEX profile")).toBeInTheDocument();
  });
});
