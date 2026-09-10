// Deterministic mock bars for tick-replay stories/tests (from SmcPoc genCleanBars).
// Seeded LCG — same output every run, no Date.now dependence.
import type { Bar } from "./types";

export function genMockBars(count = 260, seed = 1337, startTime?: number): Bar[] {
  const out: Bar[] = [];
  let p = 100;
  const start = startTime ?? 1_750_000_000 - count * 60;
  let s = seed;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    const time = start + i * 60;
    const open = p;
    const close = open + (rnd() - 0.5) * 0.25;
    let high = Math.max(open, close) + 0.35 + rnd() * 0.15;
    let low = Math.min(open, close) - 0.35 - rnd() * 0.15;
    // enforce no gaps vs i-2 so the chart is clean
    if (i >= 2) {
      const aHigh = out[i - 2].high;
      const aLow = out[i - 2].low;
      if (low > aHigh) low = aHigh - 0.05;
      if (high < aLow) high = aLow + 0.05;
      high = Math.max(high, open, close);
      low = Math.min(low, open, close);
    }
    out.push({
      time, open: +open.toFixed(2), high: +high.toFixed(2),
      low: +low.toFixed(2), close: +close.toFixed(2),
      volume: 100000 + Math.floor(rnd() * 200000),
    });
    p = out[out.length - 1].close;
  }
  return out;
}

/** Fixed iFVG long scenario: bull FVG forms, closes back below, longs to +1R. */
export function mockIfvgLong() {
  const t0 = 1_750_000_000;
  const bars: Bar[] = [
    { time: t0, open: 100, high: 102, low: 99, close: 101 },
    { time: t0 + 60, open: 101, high: 103, low: 100.5, close: 102.5 },
    { time: t0 + 120, open: 104, high: 106, low: 103.8, close: 105.5 }, // bull FVG [102,103.8]
    { time: t0 + 180, open: 105.5, high: 105.8, low: 101.5, close: 101.8 }, // close < bot => inv SHORT? (bear flip)
    { time: t0 + 240, open: 101.8, high: 102, low: 99.5, close: 100 },
    { time: t0 + 300, open: 100, high: 100.5, low: 98, close: 98.5 },
  ];
  return {
    bars,
    trade: {
      time: t0 + 240, exit_time: t0 + 300, side: "SHORT" as const, kind: "inv" as const,
      entry: 101.5, sl: 106, tp: 97, exit: 97, result: "TP" as const, pnl: 4.5, rr: 1,
    },
  };
}
