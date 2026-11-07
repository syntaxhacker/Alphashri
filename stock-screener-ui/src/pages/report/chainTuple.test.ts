/**
 * Tests for the canonical chain-tuple accessors.
 */
import { describe, expect, test } from "vitest";
import {
  CHAIN_CE_LTP,
  CHAIN_PE_LTP,
  CHAIN_CE_OI,
  CHAIN_PE_OI,
  CHAIN_CE_VOL,
  CHAIN_PE_VOL,
  chainLeg,
  chainMetric,
  type ChainTuple,
} from "./chainTuple";

describe("chainTuple constants", () => {
  test("tuple order matches backend emission: [ce_ltp, pe_ltp, ce_oi, pe_oi, ce_vol, pe_vol]", () => {
    expect(CHAIN_CE_LTP).toBe(0);
    expect(CHAIN_PE_LTP).toBe(1);
    expect(CHAIN_CE_OI).toBe(2);
    expect(CHAIN_PE_OI).toBe(3);
    expect(CHAIN_CE_VOL).toBe(4);
    expect(CHAIN_PE_VOL).toBe(5);
  });

  test("ChainTuple type is the canonical NiftyTapeChainTuple (6 elements)", () => {
    // Type test: if this compiles, the type alias is correct
    const tuple: ChainTuple = [10, 12, 1000, 2000, 500, 400];
    expect(tuple).toHaveLength(6);
  });
});

describe("chainLeg", () => {
  const fullChain = {
    "25000": [100, 110, 5000, 6000, 1000, 1200] as ChainTuple,
    "25050": [90, 95, 4000, 4500, 800, 900] as ChainTuple,
  };

  test("returns all six fields for an exact strike key", () => {
    const leg = chainLeg(fullChain, 25000);
    expect(leg).toEqual({
      ceLtp: 100,
      peLtp: 110,
      ceOi: 5000,
      peOi: 6000,
      ceVol: 1000,
      peVol: 1200,
    });
  });

  test("falls back to rounded strike key when exact key is missing", () => {
    const leg = chainLeg(fullChain, 25050.3);
    expect(leg).toEqual({
      ceLtp: 90,
      peLtp: 95,
      ceOi: 4000,
      peOi: 4500,
      ceVol: 800,
      peVol: 900,
    });
  });

  test("returns all nulls for a completely missing strike", () => {
    const leg = chainLeg(fullChain, 26000);
    expect(leg).toEqual({
      ceLtp: null,
      peLtp: null,
      ceOi: null,
      peOi: null,
      ceVol: null,
      peVol: null,
    });
  });

  test("returns all nulls for null/undefined chain", () => {
    expect(chainLeg(null, 25000)).toEqual({
      ceLtp: null,
      peLtp: null,
      ceOi: null,
      peOi: null,
      ceVol: null,
      peVol: null,
    });
    expect(chainLeg(undefined, 25000)).toEqual({
      ceLtp: null,
      peLtp: null,
      ceOi: null,
      peOi: null,
      ceVol: null,
      peVol: null,
    });
  });

  test("coerces non-finite values to null", () => {
    const chain = {
      "25000": [NaN, Infinity, -Infinity, "", null, undefined] as unknown as ChainTuple,
    };
    const leg = chainLeg(chain, 25000);
    expect(leg).toEqual({
      ceLtp: null,
      peLtp: null,
      ceOi: null,
      peOi: null,
      ceVol: null,
      peVol: null,
    });
  });

  test("handles short tuples gracefully", () => {
    const chain = {
      "25000": [100, 110] as unknown as ChainTuple, // only 2 elements
    };
    const leg = chainLeg(chain, 25000);
    expect(leg).toEqual({
      ceLtp: 100,
      peLtp: 110,
      ceOi: null,
      peOi: null,
      ceVol: null,
      peVol: null,
    });
  });

  test("preserves finite zeros", () => {
    const chain = {
      "25000": [0, 0, 0, 0, 0, 0] as ChainTuple,
    };
    const leg = chainLeg(chain, 25000);
    expect(leg).toEqual({
      ceLtp: 0,
      peLtp: 0,
      ceOi: 0,
      peOi: 0,
      ceVol: 0,
      peVol: 0,
    });
  });
});

describe("chainMetric", () => {
  const leg = {
    ceLtp: 100,
    peLtp: 110,
    ceOi: 5000,
    peOi: 6000,
    ceVol: 1000,
    peVol: 1200,
  };

  test("metric 'oi' returns CE/PE OI", () => {
    expect(chainMetric(leg, "oi")).toEqual({ ce: 5000, pe: 6000 });
  });

  test("metric 'volume' returns CE/PE volume", () => {
    expect(chainMetric(leg, "volume")).toEqual({ ce: 1000, pe: 1200 });
  });

  test("metric 'premium' returns CE/PE LTP", () => {
    expect(chainMetric(leg, "premium")).toEqual({ ce: 100, pe: 110 });
  });

  test("defaults to 'oi' for unknown metric", () => {
    // @ts-expect-error testing fallback
    expect(chainMetric(leg, "unknown")).toEqual({ ce: 5000, pe: 6000 });
  });

  test("propagates nulls correctly", () => {
    const legWithNulls = {
      ceLtp: null,
      peLtp: 110,
      ceOi: 5000,
      peOi: null,
      ceVol: 1000,
      peVol: null,
    };
    expect(chainMetric(legWithNulls, "oi")).toEqual({ ce: 5000, pe: null });
    expect(chainMetric(legWithNulls, "volume")).toEqual({ ce: 1000, pe: null });
    expect(chainMetric(legWithNulls, "premium")).toEqual({ ce: null, pe: 110 });
  });
});