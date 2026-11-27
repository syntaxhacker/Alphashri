// @vitest-environment happy-dom
// Harness first: its vi.mock registrations must run before PatternsPage loads.
import {
  fetchSymbolChart,
  makeHit,
  makeProps,
  r,
  resetHarness,
  testHooks,
} from "./PatternsPage.mainHarness";
import { PatternsPage } from "./PatternsPage";

const { afterEach, beforeEach, describe, expect, test, cleanup, fireEvent, screen, waitFor, vi } = testHooks;

const dockMatchMedia = (query: string) => ({
  matches: query.includes("1200px"),
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
});

describe("PatternsPage symbol hover", () => {
  beforeEach(resetHarness);
  afterEach(() => cleanup());

  test("hovering a symbol previews its chart in the dock before pinning", async () => {
    vi.stubGlobal("matchMedia", dockMatchMedia);
    try {
      const first = makeHit({
        id: 11,
        symbol: "IRCON",
        pattern_id: "falling_wedge",
        pattern_name: "Falling Wedge",
        start_date: "2026-04-26",
      });
      const second = makeHit({
        id: 22,
        symbol: "RELIANCE",
        pattern_id: "rising_wedge",
        pattern_name: "Rising Wedge",
        start_date: "2026-07-01",
      });
      r(() => <PatternsPage {...makeProps({ results: [first, second], total: 2 })} />);

      fireEvent.mouseEnter(screen.getByTestId(/^patterns-list-tv-IRCON-wrap/));
      expect(
        await screen.findByTestId("patterns-chart-dock", {}, { timeout: 3000 }),
      ).toBeInTheDocument();
      expect(fetchSymbolChart).toHaveBeenCalledWith(
        "IRCON",
        "1D",
        expect.objectContaining({ detectPatterns: true }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("hover does not override a pinned chart", async () => {
    vi.stubGlobal("matchMedia", dockMatchMedia);
    try {
      const first = makeHit({
        id: 11,
        symbol: "IRCON",
        pattern_id: "falling_wedge",
        pattern_name: "Falling Wedge",
        start_date: "2026-04-26",
      });
      const second = makeHit({
        id: 22,
        symbol: "RELIANCE",
        pattern_id: "rising_wedge",
        pattern_name: "Rising Wedge",
        start_date: "2026-07-01",
      });
      r(() => <PatternsPage {...makeProps({ results: [first, second], total: 2 })} />);

      fireEvent.click(screen.getByTestId("patterns-list-chart-IRCON"));
      await waitFor(() => expect(fetchSymbolChart.mock.calls.length).toBeGreaterThanOrEqual(2));
      const before = fetchSymbolChart.mock.calls.length;
      fireEvent.mouseEnter(screen.getByTestId(/^patterns-list-tv-RELIANCE-wrap/));
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(fetchSymbolChart.mock.calls.length).toBe(before);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
