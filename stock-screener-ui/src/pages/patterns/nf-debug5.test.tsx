// @vitest-environment jsdom
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

it("rail DOM stats", () => {
  render(() => <PatternFilterRail {...railProps} layout="panel" />);
  const html = document.body.innerHTML;
  console.log("htmlLength:", html.length);
  console.log("tagCount:", (html.match(/</g) || []).length);
  console.log("divCount:", (html.match(/<div/g) || []).length);
});
