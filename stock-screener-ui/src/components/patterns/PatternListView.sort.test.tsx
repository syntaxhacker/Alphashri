import { describe, expect, test } from "vitest";
import { render, screen, within } from "@solidjs/testing-library";
import { PatternListView } from "./PatternListView";
import type { PatternHitDTO } from "@/types/chartPatterns";

/**
 * Every rail sort key must resolve to a real column. `sortingFor("breakout")`
 * used to seed `{ id: "breakout_score" }` with no such column, so the table
 * silently ignored the sort and kept insertion order — a user-visible bug that
 * no other test could see, because "sorted" and "unsorted" both render rows.
 */

function hit(overrides: Partial<PatternHitDTO> & { id: number }): PatternHitDTO {
  return {
    symbol: `SYM${overrides.id}`,
    pattern_id: "falling_wedge",
    pattern_name: "Falling Wedge",
    timeframe: "1D",
    status: "confirmed",
    direction: "bearish",
    quality: "strong",
    confidence: 70,
    bars_ago: 3,
    start_date: "2026-01-01",
    end_date: "2026-01-10",
    start_price: 100,
    end_price: 110,
    last_close: 110,
    range_pos: 50,
    to_52w_high: 5,
    ...overrides,
  } as PatternHitDTO;
}

const HITS = [hit({ id: 1, confidence: 60, breakout_score: 10 }), hit({ id: 2, confidence: 90, breakout_score: 80 })];

function renderedSymbols(): string[] {
  const table = screen.getByTestId("patterns-list");
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((row) => row.textContent ?? "")
    .filter(Boolean);
}

describe("PatternListView sort keys", () => {
  test("a seeded sort always targets a column that exists", () => {
    for (const key of ["confidence", "newest", "range_pos", "breakout", "distance"]) {
      const { unmount } = render(() => <PatternListView hits={HITS} sort={key} onSelect={() => {}} />);
      // The header for the seeded column must carry an active sort indicator.
      const headers = within(screen.getByTestId("patterns-list")).getAllByRole("columnheader");
      const sorted = headers.filter((h) => /[▲▼]/.test(h.textContent ?? ""));
      if (key === "distance") {
        // `distance` is ordered client-side, so it seeds no header indicator.
        expect(sorted).toHaveLength(0);
      } else {
        expect(sorted.length, `sort=${key} seeded no visible indicator`).toBe(1);
      }
      unmount();
    }
  });

  test("breakout sort orders by breakout score, not insertion order", () => {
    render(() => <PatternListView hits={HITS} sort="breakout" onSelect={() => {}} />);
    const rows = renderedSymbols();
    // HITS[1] has the higher breakout_score (80 vs 10) and sorts first.
    expect(rows[0]).toContain("SYM2");
    expect(rows[1]).toContain("SYM1");
  });

  test("confidence sort orders by confidence descending", () => {
    render(() => <PatternListView hits={HITS} sort="confidence" onSelect={() => {}} />);
    const rows = renderedSymbols();
    expect(rows[0]).toContain("SYM2");
  });

  test("the breakout score column is rendered and sortable", () => {
    render(() => <PatternListView hits={HITS} sort="breakout" onSelect={() => {}} />);
    const headers = within(screen.getByTestId("patterns-list")).getAllByRole("columnheader");
    expect(headers.some((h) => (h.textContent ?? "").includes("BO"))).toBe(true);
  });
});
