// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test } from "vitest";
import type { JSX } from "solid-js";
import { render, screen } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import type { NiftyIvSurface, NiftyStrike } from "@/types/niftyReport";
import {
  IV_MAX_PCT,
  NiftyIvSkew,
  buildIvSkewPoints,
  ivSkewStats,
  legIvAtDelta,
} from "./NiftyIvSkew";
import { IV_DELTA_BAND, IV_DELTA_TARGET } from "./ivConventions";

function leg(iv: number | null, delta: number | null) {
  return {
    ltp: 100,
    close: 100,
    oi: 1000,
    prevOi: 900,
    oiChange: 100,
    priceChange: 1,
    sentiment: "Neutral",
    iv,
    delta,
  };
}

function strike(
  value: number,
  ceIv: number,
  peIv: number,
  ceDelta: number,
  peDelta: number,
): NiftyStrike {
  return { strike: value, ce: leg(ceIv, ceDelta), pe: leg(peIv, peDelta) };
}

/** The exact chain used by tests/api/test_iv_parity.py (strike → CE/PE). */
const CHAIN: NiftyStrike[] = [
  strike(22700, 17, 13, 0.85, -0.15),
  strike(22800, 16, 14, 0.75, -0.25),
  strike(22900, 15, 15, 0.65, -0.35),
  strike(23000, 14, 16, 0.5, -0.5),
  strike(23100, 13, 17, 0.35, -0.65),
  strike(23200, 12, 18, 0.25, -0.75),
  strike(23300, 11, 19, 0.15, -0.85),
];

const SURFACE: NiftyIvSurface = {
  atm: { strike: 23000, ce_iv: 14, pe_iv: 16, avg_iv: 15 },
  skew: {
    strike_ce25: 23200,
    ce_25d_iv: 12,
    strike_pe25: 22800,
    pe_25d_iv: 14,
    skew_25d: -2,
  },
  coverage: { rows: 7, with_ce_iv: 7, with_pe_iv: 7, with_delta: 7 },
  degraded: false,
  points: CHAIN.map((r) => ({
    strike: r.strike,
    ce_iv: r.ce.iv ?? null,
    pe_iv: r.pe.iv ?? null,
    ce_delta: r.ce.delta ?? null,
    pe_delta: r.pe.delta ?? null,
  })),
};

describe("IV parity with the backend (same chain, same numbers)", () => {
  test("shared constants match the backend conventions", () => {
    expect(IV_MAX_PCT).toBe(100);
    expect(IV_DELTA_TARGET).toBe(0.25);
    expect(IV_DELTA_BAND).toEqual([0.15, 0.35]);
  });

  test("derived ATM IV and 25Δ RR match the backend payload", () => {
    const stats = ivSkewStats(buildIvSkewPoints(CHAIN, 23000), CHAIN, 23000);
    expect(stats.atmStrike).toBe(23000);
    expect(stats.atmIv).toBeCloseTo(15, 10);
    expect(stats.call25).toBeCloseTo(12, 10);
    expect(stats.put25).toBeCloseTo(14, 10);
    expect(stats.rr25).toBeCloseTo(-2, 10);
  });

  test("preferring the backend surface yields the identical numbers", () => {
    const derived = ivSkewStats(buildIvSkewPoints(CHAIN, 23000), CHAIN, 23000);
    const fromBackend = ivSkewStats([], [], 23000, SURFACE);
    expect(fromBackend).toEqual(derived);
  });

  test("legIvAtDelta honours the band and the 100-point IV cap", () => {
    expect(legIvAtDelta(CHAIN, "ce")).toBe(12);
    expect(legIvAtDelta(CHAIN, "pe")).toBe(14);

    const artefact: NiftyStrike[] = [
      { ...CHAIN[0], ce: { ...CHAIN[0].ce, iv: 281.25, delta: 0.25 } },
    ];
    expect(legIvAtDelta(artefact, "ce")).toBeNull();

    const outsideBand: NiftyStrike[] = [
      { ...CHAIN[0], ce: { ...CHAIN[0].ce, iv: 14, delta: 0.14 } },
      { ...CHAIN[0], ce: { ...CHAIN[0].ce, iv: 15, delta: 0.36 } },
    ];
    expect(legIvAtDelta(outsideBand, "ce")).toBeNull();
  });

  test("rendered panel shows backend numbers even when the chain disagrees", () => {
    const staleChain = CHAIN.map((row) => ({
      ...row,
      ce: { ...row.ce, iv: 99 },
      pe: { ...row.pe, iv: 99 },
    }));
    render(
      () => (
        <NiftyIvSkew
          strikes={staleChain}
          spot={23000}
          ivSurface={SURFACE}
        />
      ),
      {
        wrapper: (props: { children?: JSX.Element }) => (
          <UIProvider>{props.children}</UIProvider>
        ),
      },
    );
    expect(screen.getByTestId("nifty-iv-skew-atm")).toHaveTextContent("15.0%");
    expect(screen.getByTestId("nifty-iv-skew-rr")).toHaveTextContent("-2.0 vp");
  });
});
