// @vitest-environment happy-dom
// Harness first: its vi.mock registrations must run before PatternsPage loads.
import {
  makeHit,
  makeProps,
  r,
  resetHarness,
  testHooks,
} from "./PatternsPage.mainHarness";
import type { PatternHitDTO } from "@/types/chartPatterns";
import type { PatternsPageProps } from "./PatternsPage";
import { PatternsPage } from "./PatternsPage";

const { afterEach, beforeEach, describe, expect, test, cleanup, fireEvent, screen, createSignal } = testHooks;

describe("PatternsPage derivation-chain work", () => {
  beforeEach(resetHarness);
  afterEach(() => cleanup());

  test("reads each derivation source once per pass with 1000 hits", () => {
    const N = 1000;
    const hits: PatternHitDTO[] = Array.from({ length: N }, (_, i) =>
      makeHit({
        id: i + 1,
        symbol: `SYM${String(i % 200).padStart(4, "0")}`,
        pattern_id: i % 2 === 0 ? "falling_wedge" : "rising_wedge",
        pattern_name: i % 2 === 0 ? "Falling Wedge" : "Rising Wedge",
        end_date: `2026-09-${String((i % 28) + 1).padStart(2, "0")}`,
      }),
    );
    const base = makeProps({
      results: hits,
      total: N,
      defaultView: "list",
      filters: {
        ...makeProps().filters,
        sequence: true,
        pattern_id: ["falling_wedge", "rising_wedge"],
      },
    });
    const counts = { results: 0, summary: 0 };
    const counted: PatternsPageProps = {
      ...base,
      get results() { counts.results++; return hits; },
      get summary() { counts.summary++; return base.summary; },
    };
    const view = r(() => <PatternsPage {...counted} />);
    expect(screen.getByTestId("patterns-page")).toBeInTheDocument();
    // One read per memo pass instead of a read per loop iteration / length probe.
    expect(counts.results).toBe(2);
    expect(counts.summary).toBeLessThanOrEqual(5);
    view.unmount();
  });

  test("an unrelated filter change does not re-run result derivations", () => {
    const hits = [makeHit({ id: 1, symbol: "AAA" }), makeHit({ id: 2, symbol: "BBB" })];
    const base = makeProps({ results: hits, total: hits.length, defaultView: "list" });
    const counts = { results: 0 };

    function Harness() {
      const [filters, setFilters] = createSignal(base.filters);
      const counted: PatternsPageProps = {
        ...base,
        get filters() {
          return filters();
        },
        get results() {
          counts.results++;
          return hits;
        },
      };
      return (
        <>
          <button
            data-testid="bump-filter"
            onClick={() => setFilters((f) => ({ ...f, q: f.q === "x" ? "" : "x" }))}
          >
            bump
          </button>
          <PatternsPage {...counted} />
        </>
      );
    }

    const view = r(() => <Harness />);
    expect(screen.getByTestId("patterns-page")).toBeInTheDocument();
    const initial = counts.results;
    fireEvent.click(screen.getByTestId("bump-filter"));
    expect(screen.getByTestId("patterns-page")).toBeInTheDocument();
    // `q` is irrelevant to sequencing/history — no derivation may rescan results.
    expect(counts.results).toBe(initial);
    view.unmount();
  });
});
