// @vitest-environment happy-dom
// Harness first: its vi.mock registrations must run before PatternsPage loads.
import {
  fetchPatternHit,
  makeHit,
  makeProps,
  r,
  resetHarness,
  SUMMARY,
  testHooks,
} from "./PatternsPage.appliedHarness";
import { PatternsPage } from "./PatternsPage";

const { afterEach, beforeEach, describe, expect, test, cleanup, fireEvent, screen, waitFor, vi, createSignal } = testHooks;

describe("PatternsPage scope changes", () => {
  beforeEach(resetHarness);
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  test("switching universe closes the docked chart", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("1200px"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const props = makeProps({ results: [makeHit()], total: 1 });
    const [universe, setUniverse] = createSignal("nifty500");
    r(() => <PatternsPage {...props} universe={universe()} />);
    fireEvent.click(screen.getByTestId("patterns-list-row-IRCON-falling_wedge"));
    expect(await screen.findByTestId("patterns-chart-dock")).toBeInTheDocument();

    // Scope changed: the open hit belongs to the previous universe.
    setUniverse("nifty50");
    await waitFor(() =>
      expect(screen.queryByTestId("patterns-chart-dock")).not.toBeInTheDocument(),
    );
  });

  test("a completed scan re-resolves the open stored hit", async () => {
    const [lastScanAt, setLastScanAt] = createSignal("2026-10-01T00:00:00Z");
    const props = makeProps({
      results: [makeHit({ id: 11 })],
      total: 1,
    });
    r(() => <PatternsPage {...props} summary={{ ...SUMMARY, last_scan_at: lastScanAt() }} />);
    fireEvent.click(screen.getByTestId("patterns-list-row-IRCON-falling_wedge"));
    await screen.findByTestId("patterns-fullscreen-modal");
    await waitFor(() => expect(fetchPatternHit).toHaveBeenCalledWith(11));
    const callsAfterOpen = fetchPatternHit.mock.calls.length;

    // A scan completed: `last_scan_at` moves, so the stored hit is re-fetched.
    fetchPatternHit.mockResolvedValueOnce(makeHit({ id: 11, status: "failed" }));
    setLastScanAt("2026-10-02T00:00:00Z");
    await waitFor(() =>
      expect(fetchPatternHit.mock.calls.length).toBe(callsAfterOpen + 1),
    );
    expect(fetchPatternHit).toHaveBeenLastCalledWith(11);
    // The chart stays open with the re-resolved hit.
    expect(screen.getByTestId("patterns-fullscreen-modal")).toBeInTheDocument();
  });
});
