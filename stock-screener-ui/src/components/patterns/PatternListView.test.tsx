// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import type { PatternHitDTO } from "@/types/chartPatterns";
import { PatternListView } from "./PatternListView";

function makeHit(overrides: Partial<PatternHitDTO> = {}): PatternHitDTO {
  return {
    id: 1,
    symbol: "IRCON",
    name: "IRCON International Ltd.",
    timeframe: "1D",
    pattern_id: "falling_wedge",
    pattern_name: "Falling Wedge",
    family: "reversal",
    direction: "bullish",
    status: "confirmed",
    quality: "strong",
    confidence: 78.4,
    start_date: "2026-04-26",
    end_date: "2026-09-26",
    start_price: 100,
    end_price: 112.6,
    breakout_level: 112.6,
    target: 129.6,
    stop: 102.5,
    rr: 1.7,
    bars_ago: 2,
    last_close: 115.2,
    day_change_pct: 2.5,
    to_52w_high: 13.36,
    volume_confirmed: true,
    trendlines: [],
    notes: "",
    ...overrides,
  };
}

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> });
}

describe("PatternListView", () => {
  afterEach(() => cleanup());

  test("renders the dense table with one row per hit and all columns", () => {
    const hits = [makeHit({ id: 1, symbol: "AAA" }), makeHit({ id: 2, symbol: "BBB" })];
    r(<PatternListView hits={hits} onSelect={vi.fn()} />);
    const table = screen.getByTestId("patterns-list");
    expect(table).toBeInTheDocument();
    for (const header of ["Symbol", "Pattern", "Dir", "Status", "Q", "52W gap %", "Pos %", "Breakout", "Bars ago", "Price", "Chg %"]) {
      // A sticky header may clone a cell, so assert presence (>=1), not uniqueness.
      expect(within(table).getAllByText(header).length).toBeGreaterThanOrEqual(1);
    }
    // "Score" (pattern-fit confidence) carries the sort indicator (text split) → match loosely.
    expect(within(table).getAllByText(/Score/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId("patterns-list-row-AAA-falling_wedge-1")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-list-row-BBB-falling_wedge-2")).toBeInTheDocument();
  });

  test("Score header clarifies it is pattern-fit, not breakout conviction", () => {
    r(<PatternListView hits={[makeHit()]} onSelect={vi.fn()} />);
    const header = screen.getByText("Score");
    expect(header.getAttribute("title")).toBe(
      "Pattern-fit confidence (geometry fit, R², volume) — not breakout conviction.",
    );
  });

  test("Breakout column renders the 0-dp score or — when missing", () => {
    const hits = [
      makeHit({ id: 1, symbol: "AAA", breakout_score: 73.4 }),
      makeHit({ id: 2, symbol: "BBB", breakout_score: null }),
    ];
    r(<PatternListView hits={hits} onSelect={vi.fn()} sort="breakout" />);
    const rowA = screen.getByTestId("patterns-list-row-AAA-falling_wedge-1");
    const rowB = screen.getByTestId("patterns-list-row-BBB-falling_wedge-2");
    expect(within(rowA).getByText("73")).toBeInTheDocument();
    // BBB lacks both range_pos and breakout_score → at least the Breakout "—".
    expect(within(rowB).getAllByText("—").length).toBeGreaterThanOrEqual(1);
  });

  test("seeds its sort from the rail sort (breakout → Breakout desc)", () => {
    const hits = [
      makeHit({ id: 1, symbol: "AAA", breakout_score: 41.2, confidence: 99 }),
      makeHit({ id: 2, symbol: "BBB", breakout_score: 73.0, confidence: 10 }),
    ];
    r(<PatternListView hits={hits} onSelect={vi.fn()} sort="breakout" />);
    const rows = within(screen.getByTestId("patterns-list")).getAllByTestId(/^patterns-list-row-/);
    expect(rows.map((el) => el.getAttribute("data-testid"))).toEqual([
      "patterns-list-row-BBB-falling_wedge-2",
      "patterns-list-row-AAA-falling_wedge-1",
    ]);
  });
  test("seeds its sort from the rail sort (range_pos → Pos % desc)", () => {
    const hits = [
      makeHit({ id: 1, symbol: "AAA", range_pos: 10, confidence: 99 }),
      makeHit({ id: 2, symbol: "BBB", range_pos: 90, confidence: 50 }),
    ];
    r(<PatternListView hits={hits} onSelect={vi.fn()} sort="range_pos" />);
    const rows = within(screen.getByTestId("patterns-list")).getAllByTestId(/^patterns-list-row-/);
    expect(rows.map((el) => el.getAttribute("data-testid"))).toEqual([
      "patterns-list-row-BBB-falling_wedge-2",
      "patterns-list-row-AAA-falling_wedge-1",
    ]);
  });

  test("defaults to confidence desc (highest first)", () => {
    const hits = [
      makeHit({ id: 1, symbol: "AAA", confidence: 40 }),
      makeHit({ id: 2, symbol: "BBB", confidence: 95 }),
    ];
    r(<PatternListView hits={hits} onSelect={vi.fn()} />);
    const rows = within(screen.getByTestId("patterns-list")).getAllByTestId(/^patterns-list-row-/);
    expect(rows.map((el) => el.getAttribute("data-testid"))).toEqual([
      "patterns-list-row-BBB-falling_wedge-2",
      "patterns-list-row-AAA-falling_wedge-1",
    ]);
  });

  test("formats price, change, gap and badges", () => {
    r(<PatternListView hits={[makeHit()]} onSelect={vi.fn()} />);
    const row = screen.getByTestId("patterns-list-row-IRCON-falling_wedge-1");
    expect(within(row).getByText("Falling Wedge")).toBeInTheDocument();
    expect(within(row).getByText("₹115.20")).toBeInTheDocument();
    expect(within(row).getByText("+2.50%")).toBeInTheDocument();
    expect(within(row).getByText("13.4%")).toBeInTheDocument();
    expect(within(row).getByText("Confirmed")).toBeInTheDocument();
    // Direction is a glyph (value in title/aria); quality is a letter (tier in title).
    const dir = within(row).getByText("▲");
    expect(dir.getAttribute("title")).toBe("bullish");
    expect(dir.getAttribute("aria-label")).toBe("bullish");
    const quality = within(row).getByTestId("patterns-quality-strong");
    expect(quality).toHaveTextContent("S");
    expect(quality.getAttribute("title")).toMatch(/Strong/);
    expect(quality.getAttribute("aria-label")).toBe("Strong");
  });

  test("renders bearish and neutral direction glyphs with the value in title/aria", () => {
    const hits = [
      makeHit({ id: 1, symbol: "AAA", direction: "bearish" }),
      makeHit({ id: 2, symbol: "BBB", direction: "neutral" }),
    ];
    r(<PatternListView hits={hits} onSelect={vi.fn()} />);
    const bear = within(screen.getByTestId("patterns-list-row-AAA-falling_wedge-1")).getByText("▼");
    expect(bear.getAttribute("title")).toBe("bearish");
    expect(bear.getAttribute("aria-label")).toBe("bearish");
    const neutral = within(screen.getByTestId("patterns-list-row-BBB-falling_wedge-2")).getByText("◆");
    expect(neutral.getAttribute("title")).toBe("neutral");
    expect(neutral.getAttribute("aria-label")).toBe("neutral");
  });

  test("renders quality letters for every tier with the tier in the title", () => {
    const hits = (["textbook", "strong", "fair", "marginal"] as const).map((q, i) =>
      makeHit({ id: i + 1, symbol: `S${i}`, quality: q }),
    );
    r(<PatternListView hits={hits} onSelect={vi.fn()} />);
    const expected: Array<[string, string]> = [
      ["textbook", "T"],
      ["strong", "S"],
      ["fair", "F"],
      ["marginal", "M"],
    ];
    for (const [tier, letter] of expected) {
      const el = screen.getByTestId(`patterns-quality-${tier}`);
      expect(el).toHaveTextContent(letter);
      expect(el.getAttribute("title")).toMatch(new RegExp(tier.charAt(0).toUpperCase() + tier.slice(1)));
    }
  });

  test("falls back to the pattern-window move and shows — for a missing 52W gap", () => {
    r(
      <PatternListView
        hits={[makeHit({ day_change_pct: null, last_close: null, to_52w_high: null })]}
        onSelect={vi.fn()}
      />,
    );
    const row = screen.getByTestId("patterns-list-row-IRCON-falling_wedge-1");
    // (112.6 - 100) / 100 = +12.60%; price falls back to end_price.
    expect(within(row).getByText("+12.60%")).toBeInTheDocument();
    expect(within(row).getByText("₹112.60")).toBeInTheDocument();
    // Missing 52W gap and missing base position both render "—".
    expect(within(row).getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  test("clicking a row selects that hit", async () => {
    const onSelect = vi.fn();
    const hits = [makeHit({ id: 1, symbol: "AAA" }), makeHit({ id: 2, symbol: "BBB" })];
    r(<PatternListView hits={hits} onSelect={onSelect} />);
    await userEvent.click(screen.getByTestId("patterns-list-row-BBB-falling_wedge-2"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(hits[1]);
  });
});
