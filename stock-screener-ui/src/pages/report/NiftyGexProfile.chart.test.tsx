// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import * as palette from "@/ui/palette";
import {
  NiftyGexProfile,
  buildGexChart,
  buildGexProfile,
  gexProfileStats,
} from "./NiftyGexProfile";
import { TestWrapper, gex } from "./NiftyGexProfile.fixtures";

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

  test("trims the dead strike wings so labels span only the gamma band", () => {
    const padded = gex({
      strikes: [
        { strike: 20050, callGex: 0, putGex: 0, netGex: 0 },
        { strike: 22600, callGex: 1, putGex: 2, netGex: 12 },
        { strike: 22700, callGex: 5, putGex: -3, netGex: -2 },
        { strike: 25200, callGex: 0, putGex: 0, netGex: 0 },
      ],
    });
    const profile = buildGexProfile(padded);
    const chart = buildGexChart(profile, gexProfileStats(padded, 22650), 22650);
    expect(chart.labels).toEqual(["22,600", "22,700"]);
    expect(chart.series[0].points).toEqual([12, -2]);
  });

  test("SPOT snaps to the strike nearest a continuous spot", () => {
    // 22,690 is not on the strike grid; without snapping the marker never drew.
    const profile = buildGexProfile(gex());
    const chart = buildGexChart(profile, gexProfileStats(gex(), 22690), 22690);
    const spot = chart.markers.find((m) => m.label === "SPOT");
    expect(spot?.index).toBe(1);
  });

  test("ZERO is skipped when it would stack on the SPOT strike", () => {
    const same = gex({ zeroCross: 22700 });
    const profile = buildGexProfile(same);
    const chart = buildGexChart(profile, gexProfileStats(same, 22700), 22700);
    expect(chart.markers.map((m) => m.label)).toEqual(["SPOT"]);
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
    const withZero = gex({
      strikes: [
        { strike: 22600, callGex: 0, putGex: 0, netGex: -6 },
        { strike: 22700, callGex: 0, putGex: 0, netGex: -4 },
        { strike: 22800, callGex: 0, putGex: 0, netGex: 20 },
      ],
      zeroCross: 22800,
    });
    const profile = buildGexProfile(withZero);
    const chart = buildGexChart(profile, gexProfileStats(withZero, 22700), 22700);
    const zero = chart.markers.find((m) => m.label === "ZERO");
    expect(zero?.index).toBe(2);
    expect(zero?.color).toBe(palette.TERM_FLIP);
  });

  test("default fixture zeroCross (off-profile) yields no ZERO marker", () => {
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

describe("NiftyGexProfile render", () => {
  test("renders the panel, stat row and SVG chart", () => {
    render(() => <NiftyGexProfile gex={gex()} spot={22700} />, { wrapper: TestWrapper });

    expect(screen.getByTestId("nifty-gex-profile-panel")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-gex-profile-net")).toHaveTextContent("+7.50 Cr/pt");
    expect(screen.getByTestId("nifty-gex-profile-zero")).toHaveTextContent("22,650");
    expect(screen.getByTestId("nifty-gex-profile-regime")).toHaveTextContent("LONG GAMMA");

    const chart = screen.getByTestId("nifty-gex-profile-chart");
    expect(chart).toBeInTheDocument();
    expect(chart.querySelector("svg")).not.toBeNull();
    expect(screen.queryByText("No per-strike GEX profile")).not.toBeInTheDocument();
  });

  test("renders the SUP / RES level legend with level-token dots", () => {
    render(() => <NiftyGexProfile gex={gex()} spot={22700} />, { wrapper: TestWrapper });
    const legend = screen.getByTestId("nifty-gex-profile-levels-legend");
    expect(legend).toHaveTextContent("SUP 22,600");
    expect(legend).toHaveTextContent("RES");

    const sup = screen.getByTestId("nifty-gex-profile-level-legend-sup");
    const res = screen.getByTestId("nifty-gex-profile-level-legend-res");
    expect((sup.firstElementChild as HTMLElement)).toHaveStyle({
      backgroundColor: palette.LEVEL_SUPPORT,
    });
    expect((res.firstElementChild as HTMLElement)).toHaveStyle({
      backgroundColor: palette.LEVEL_RESISTANCE,
    });
    expect(sup.getAttribute("title")).toContain("support");
    expect(res.getAttribute("title")).toContain("resistance");
  });

  test("labels a positive-gamma strike above spot with the RES code", () => {
    const bothSides = gex({
      strikes: [
        { strike: 22600, callGex: 1, putGex: 0, netGex: 12 },
        { strike: 22700, callGex: 5, putGex: -3, netGex: -2 },
        { strike: 22800, callGex: 9, putGex: -2, netGex: 8 },
      ],
      zeroCross: 22650,
    });
    render(() => <NiftyGexProfile gex={bothSides} spot={22700} />, { wrapper: TestWrapper });
    expect(screen.getByTestId("nifty-gex-profile-level-legend-res")).toHaveTextContent("RES 22,800");
  });

  test("names the gamma support/resistance strikes and explains the profile", () => {
    render(() => <NiftyGexProfile gex={gex()} spot={22700} />, { wrapper: TestWrapper });
    expect(screen.getByTestId("nifty-gex-profile-support")).toHaveTextContent("22,600");
    expect(screen.getByTestId("nifty-gex-profile-resist")).toHaveTextContent("22,800");
    const regime = screen.getByTestId("nifty-gex-profile-regime");
    expect(regime).toHaveTextContent("magnet");
    // Flip is owned by the stat row once; the regime row keeps only the verdict.
    expect(screen.getByTestId("nifty-gex-profile-zero")).toHaveTextContent("22,650");
    const caption = screen.getByTestId("nifty-gex-profile-caption");
    expect(caption).toHaveTextContent("above 0 = dampening");
    const explain = caption.getAttribute("title") ?? "";
    expect(explain).toContain("SPOT / ZERO mark today's spot");
    expect(explain).toContain("pin magnets below/above spot");
  });

  test("a negative-gamma strike above spot is fuel, never resistance", () => {
    const inverted = gex({
      strikes: [
        { strike: 22600, callGex: 0, putGex: -6, netGex: -6 },
        { strike: 22700, callGex: 0, putGex: -10, netGex: -10 },
        { strike: 22800, callGex: 0, putGex: -8, netGex: -8 },
      ],
      zeroCross: null,
    });
    render(() => <NiftyGexProfile gex={inverted} spot={22650} />, { wrapper: TestWrapper });
    const resist = screen.getByTestId("nifty-gex-profile-resist");
    expect(resist).toHaveTextContent("γ fuel ↑");
    expect(resist).toHaveTextContent("22,700");
    const support = screen.getByTestId("nifty-gex-profile-support");
    expect(support).toHaveTextContent("γ fuel ↓");
    expect(support).toHaveTextContent("22,600");
  });

  test("a near-zero fuel wing renders an em dash, not a fake level", () => {
    const wing = gex({
      strikes: [
        { strike: 22700, callGex: 0, putGex: 0, netGex: 2 },
        { strike: 24700, callGex: 0, putGex: 0, netGex: -0.04 },
      ],
      zeroCross: null,
    });
    render(() => <NiftyGexProfile gex={wing} spot={22962.6} />, { wrapper: TestWrapper });
    expect(screen.getByTestId("nifty-gex-profile-support")).toHaveTextContent("22,700");
    expect(screen.getByTestId("nifty-gex-profile-resist")).toHaveTextContent("—");
  });

  test("positive gamma below/above spot keeps the support/resistance labels", () => {
    render(() => <NiftyGexProfile gex={gex()} spot={22700} />, { wrapper: TestWrapper });
    expect(screen.getByTestId("nifty-gex-profile-support")).toHaveTextContent("γ support");
    expect(screen.getByTestId("nifty-gex-profile-resist")).toHaveTextContent("γ fuel ↑");
  });

  test("states how many strikes actually carry gamma and the plotted band", () => {
    const padded = gex({
      strikes: [
        { strike: 20050, callGex: 0, putGex: 0, netGex: 0 },
        { strike: 22600, callGex: 1, putGex: 2, netGex: 12 },
        { strike: 22700, callGex: 5, putGex: -3, netGex: -2 },
        { strike: 22800, callGex: 9, putGex: -9, netGex: 0 },
        { strike: 25200, callGex: 0, putGex: 0, netGex: 0 },
      ],
    });
    render(() => <NiftyGexProfile gex={padded} spot={22690} />, { wrapper: TestWrapper });
    const coverage = screen.getByTestId("nifty-gex-profile-coverage");
    expect(coverage).toHaveTextContent("band 22,600–22,700");
    expect(coverage).toHaveTextContent("2 of 5 strikes carry ≥1% of peak γ");
  });
});
