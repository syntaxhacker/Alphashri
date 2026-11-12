// @vitest-environment happy-dom
import { it, vi, expect } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import { PatternFilterRail } from "@/components/patterns/PatternFilterRail";

vi.mock("@/ui", async (importOriginal) => {
  const { uiLayoutStub } = await import("@/pages/solidTestStubs");
  return uiLayoutStub(await importOriginal<Record<string, unknown>>());
});

const mockPresets = vi.hoisted(() => vi.fn(() => null));
const mockImage = vi.hoisted(() => vi.fn(() => null));
const mockFilterNumber = vi.hoisted(() => vi.fn(() => null));
const mockReplay = vi.hoisted(() => vi.fn(() => null));

vi.mock("./PatternPresets", () => ({ PatternPresets: mockPresets }));
vi.mock("./PatternImage", () => ({ PatternImage: mockImage }));
vi.mock("./FilterNumber", () => ({ FilterNumber: mockFilterNumber }));
vi.mock("./ReplayScanControl", () => ({ ReplayScanControl: mockReplay }));

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

it("rail with children stubbed twice", () => {
  const t = Date.now();
  render(() => <PatternFilterRail {...railProps} />);
  console.log("stubbed rail A:", Date.now() - t, "ms");
  console.log("stubbed rail B:", Date.now() - t, "ms (cumulative)");
});

it("rail with children stubbed", () => {
  const t = Date.now();
  render(() => <PatternFilterRail {...railProps} />);
  console.log("stubbed rail:", Date.now() - t, "ms");
  expect(screen.getByTestId("patterns-filter-rail")).toBeInTheDocument();
});
