import type { NiftyReport, NiftyStrike } from "@/types/niftyReport";

export function strikeAt(strike: number): NiftyStrike {
  return { strike } as NiftyStrike;
}

export function chainRow(strike: number): NiftyStrike {
  return {
    strike,
    ce: {
      ltp: 150,
      close: 200,
      oi: 2000,
      prevOi: 1800,
      oiChange: 200,
      priceChange: -50,
      sentiment: "LB",
    },
    pe: {
      ltp: 260,
      close: 200,
      oi: 2500,
      prevOi: 2600,
      oiChange: -100,
      priceChange: 60,
      sentiment: "SB",
    },
  };
}

export function reportWith(over: Partial<NiftyReport>): NiftyReport {
  return {
    mode: "live",
    date: "2026-01-05",
    expiry: "2026-01-08",
    spot: 25000,
    pcrOi: 0.85,
    pcrVol: 0.9,
    maxPain: 25000,
    walls: { calls: [], puts: [] },
    strikes: [],
    timeline: [],
    ohlc: { open: 25000, high: 25000, low: 25000, close: 25000 },
    ...over,
  } as NiftyReport;
}
