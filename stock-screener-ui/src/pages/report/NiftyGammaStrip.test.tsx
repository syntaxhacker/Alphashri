// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test } from "vitest";
import { render, screen, within, fireEvent } from "@solidjs/testing-library";
import type { JSX } from "solid-js";
import { UIProvider } from "@/ui";
import { NiftyGammaStrip } from "./NiftyGammaStrip";
import type { NiftyGex, NiftyPositioningBlock } from "@/types/niftyReport";

function positioning(): NiftyPositioningBlock {
  return {
    verdict: "bearish",
    state: -1200,
    flow: -80,
    initiated: -45,
    bullCr: 35,
    bearCr: 65,
    splitPct: 65,
    ceDoi: 1_200,
    peDoi: 400,
    lotSize: 75,
    deltaFlip: 25_700,
    strikes: [],
  };
}

/** Short-gamma book: cumulative gamma at spot is negative, flip above spot. */
function shortGex(overrides: Partial<NiftyGex> = {}): NiftyGex {
  return {
    strikes: [
      { strike: 25_100, callGex: -18, putGex: -2, netGex: -20 },
      { strike: 25_600, callGex: -4, putGex: -1, netGex: -5 },
      { strike: 25_700, callGex: 1, putGex: 0, netGex: 1 },
      { strike: 25_760, callGex: 2, putGex: 0, netGex: 2 },
      { strike: 25_900, callGex: 6, putGex: 0, netGex: 6 },
    ],
    netTotal: -12.4,
    regime: "short",
    topPositive: [],
    topNegative: [],
    zeroCross: 25_760,
    levels: {
      support: null,
      resistance: { strike: 25_900, netGex: 6 },
      fuelDown: { strike: 25_100, netGex: -20 },
      fuelUp: null,
    },
    ...overrides,
  };
}

function r(node: () => JSX.Element) {
  return render(node, { wrapper: UIProvider });
}

/** Long-gamma book: cumulative gamma at spot is positive, flip below spot. */
function longGex(overrides: Partial<NiftyGex> = {}): NiftyGex {
  return shortGex({
    strikes: [
      { strike: 25_100, callGex: 18, putGex: 2, netGex: 20 },
      { strike: 25_600, callGex: 4, putGex: 1, netGex: 5 },
      { strike: 25_700, callGex: 1, putGex: 0, netGex: 1 },
    ],
    netTotal: 8.25,
    regime: "long",
    zeroCross: 25_100,
    levels: { support: null, resistance: null, fuelDown: null, fuelUp: null },
    ...overrides,
  });
}


describe("NiftyGammaStrip — regime line", () => {
  test("renders net gamma, regime, flip, fuel and resistance", () => {
    r(() =>
    <NiftyGammaStrip gex={shortGex()} positioning={positioning()} spot={25_750} />);

    const strip = screen.getByTestId("nifty-gamma-strip");
    expect(strip).toHaveStyle({ height: "24px" });
    expect(strip).toHaveAttribute("data-tone", "short");
    expect(strip).toHaveTextContent("Γ -12.40 Cr");
    expect(strip).toHaveTextContent("SHORT Γ");
    expect(strip).toHaveTextContent("flip");
    expect(strip).toHaveTextContent("25,760");
    expect(strip).toHaveTextContent("fuel↓");
    expect(strip).toHaveTextContent("25,100");
    expect(strip).toHaveTextContent("resist");
    expect(strip).toHaveTextContent("25,900");
    expect(strip.getAttribute("title")).toContain("Dealers are SHORT gamma");
    expect(strip.getAttribute("title")).toContain("Click for the gamma profile");
  });

  test("long gamma reads positive and a missing level falls back to a dash", () => {
    r(() =>
    <NiftyGammaStrip gex={longGex()} spot={25_750} />);

    const strip = screen.getByTestId("nifty-gamma-strip");
    expect(strip).toHaveAttribute("data-tone", "long");
    expect(strip).toHaveTextContent("Γ +8.25 Cr");
    expect(strip).toHaveTextContent("LONG Γ");
    expect(screen.getByTestId("nifty-gamma-resist")).toHaveTextContent("—");
  });

  test("degrades to dashes without a gamma block", () => {
    r(() =>
    <NiftyGammaStrip spot={25_750} />);
    const strip = screen.getByTestId("nifty-gamma-strip");
    expect(strip).toHaveAttribute("data-tone", "flat");
    expect(strip).toHaveTextContent("Γ —");
    expect(strip).toHaveTextContent("FLAT Γ");
  });
});

describe("NiftyGammaStrip — drawer", () => {
  test("click opens the gamma & positioning drawer with both live panels", async () => {
    
    r(() =>
    <NiftyGammaStrip gex={shortGex()} positioning={positioning()} spot={25_750} />);

    await fireEvent.click(screen.getByTestId("nifty-gamma-strip"));

    const modal = await screen.findByTestId("nifty-gamma-modal");
    expect(screen.getByTestId("panel-modal")).toHaveAttribute("data-variant", "drawer");
    expect(screen.getByTestId("panel-modal-title")).toHaveTextContent("Gamma & positioning");
    expect(within(modal).getByTestId("nifty-gex-profile-panel")).toBeInTheDocument();
    expect(within(modal).getByTestId("nifty-positioning-panel")).toBeInTheDocument();
    // The profile shows the payload's net gamma (same live data, no refetch).
    expect(within(modal).getByTestId("nifty-gex-profile-net")).toHaveTextContent("-12.40 Cr");
  });

  test("keyboard Enter opens the drawer", async () => {
    
    r(() =>
    <NiftyGammaStrip gex={shortGex()} positioning={positioning()} spot={25_750} />);

    const strip = screen.getByTestId("nifty-gamma-strip");
    strip.focus();
    fireEvent.keyDown(strip, { key: "Enter" });

    expect(await screen.findByTestId("nifty-gamma-modal")).toBeInTheDocument();
  });
});
