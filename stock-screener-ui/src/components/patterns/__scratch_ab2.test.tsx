// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/patterns/solidUiMock");
  return mockSolidUi();
});
vi.mock("@/utils/loadEcharts", () => ({
  loadEcharts: async () => ({ init: () => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }) }),
}));

import { describe, expect, test } from "vitest";
import { cleanup, render } from "@solidjs/testing-library";
import { For } from "solid-js";
import { SimpleGrid } from "@/ui";
import type { PatternHitDTO } from "@/types/chartPatterns";
import { PatternCard } from "./PatternCard";
import { PatternCardOrig } from "./__scratch_card_orig";

function makeHit(id: number, symbol: string): PatternHitDTO {
  return {
    id, symbol, name: `${symbol} Ltd.`, timeframe: "1D", pattern_id: "falling_wedge",
    pattern_name: "Falling Wedge", family: "reversal", direction: "bullish", status: "confirmed",
    quality: "strong", confidence: 78.4, start_date: "2026-04-26", end_date: "2026-09-26",
    start_price: 100, end_price: 112.6, breakout_level: 112.6, target: 129.6, stop: 102.5,
    rr: 1.7, bars_ago: 2, volume_confirmed: true, trendlines: [], notes: "",
  };
}
const hits = Array.from({ length: 60 }, (_, i) => makeHit(100 + i, `S${i}`));

function mount(Comp: any) {
  return () =>
    render(() => (
      <SimpleGrid cols={4} spacing={16}>
        <For each={hits}>{(h) => <Comp hit={h} />}</For>
      </SimpleGrid>
    ));
}
const timeIt = (fn: () => void) => {
  const t0 = performance.now();
  fn();
  cleanup();
  return performance.now() - t0;
};

describe("A/B card", () => {
  test("orig vs new interleaved", () => {
    const orig = mount(PatternCardOrig);
    const next = mount(PatternCard);
    timeIt(orig);
    timeIt(next);
    const a: number[] = [];
    const b: number[] = [];
    for (let r = 0; r < 9; r++) {
      a.push(timeIt(orig));
      b.push(timeIt(next));
    }
    const stat = (x: number[]) => {
      const s = x.slice().sort((p, q) => p - q);
      return { med: s[Math.floor(s.length / 2)], min: s[0], all: x.map((v) => v.toFixed(0)) };
    };
    const A = stat(a);
    const B = stat(b);
    // eslint-disable-next-line no-console
    console.log(`[PERF] ORIG median ${A.med.toFixed(1)} min ${A.min.toFixed(1)} :: ${A.all.join(",")}`);
    // eslint-disable-next-line no-console
    console.log(`[PERF] NEW  median ${B.med.toFixed(1)} min ${B.min.toFixed(1)} :: ${B.all.join(",")}`);
    // eslint-disable-next-line no-console
    console.log(`[PERF] delta median ${(B.med - A.med).toFixed(1)} ms (${(((B.med - A.med) / A.med) * 100).toFixed(1)}%)`);
    expect(a.length).toBe(9);
  }, 180000);
});