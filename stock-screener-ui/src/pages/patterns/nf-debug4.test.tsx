// @vitest-environment happy-dom
import { it, vi, expect } from "vitest";
import { render } from "@solidjs/testing-library";
import { PatternFilterRail } from "@/components/patterns/PatternFilterRail";

vi.mock("@/ui", async (importOriginal) => {
  const { uiLayoutStub } = await import("@/pages/solidTestStubs");
  return uiLayoutStub(await importOriginal<Record<string, unknown>>());
});

const railProps = {
  patterns: [] as never[],
  results: [] as never[],
  summary: null,
  filters: {
    family: [], pattern_id: [], direction: [], status: [], quality: null,
    formed_within_bars: null, volume_confirmed: null, min_rr: null, symbol: null,
    symbols: [], q: "", min_base_days: null, max_range_pct: null, sort: "confidence",
    trendlines: "both",
  },
  setFilter: () => {},
  resetFilters: () => {},
  applyFilters: () => {},
  computeTrendlines: true,
  setComputeTrendlines: () => {},
  images: {},
};

it("debug stub stats", async () => {
  const { __getStubStats, __resetStubStats } = await import("@/pages/solidTestStubs");
  __resetStubStats();
  const t = Date.now();
  render(() => <PatternFilterRail {...railProps} />);
  const ms = Date.now() - t;
  const { stubCalls, stubTime } = __getStubStats();
  console.log(`mount=${ms}ms stubCalls=${stubCalls} stubTime=${stubTime.toFixed(1)}ms`);
  expect(true).toBe(true);
});
