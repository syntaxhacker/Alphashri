// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/patterns/solidUiMock");
  return mockSolidUi();
});
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, within, fireEvent } from "@solidjs/testing-library";
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


describe("PatternListView", () => {
  afterEach(() => cleanup());

  test("emits the rendered (header-sorted) order for prev/next navigation", async () => {
    const hits = [
      makeHit({ id: 1, symbol: "BBB", confidence: 90 }),
      makeHit({ id: 2, symbol: "AAA", confidence: 80 }),
    ];
    const onOrderChange = vi.fn();
    render(() => <PatternListView hits={hits} onSelect={vi.fn()} onOrderChange={onOrderChange} />);
    expect(onOrderChange).toHaveBeenLastCalledWith([hits[0], hits[1]]);

    fireEvent.click(within(screen.getByTestId("patterns-list")).getByText("Symbol"));
    expect(onOrderChange).toHaveBeenLastCalledWith([hits[1], hits[0]]);
  });

  test("marks the hit currently shown in the docked chart", () => {
    const hits = [makeHit({ id: 1, symbol: "AAA" }), makeHit({ id: 2, symbol: "BBB" })];
    render(() => <PatternListView hits={hits} onSelect={vi.fn()} activeHit={hits[1]} />);
    expect(screen.getByTestId("patterns-list-row-BBB-falling_wedge-2")).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(screen.getByTestId("patterns-list-row-AAA-falling_wedge-1")).not.toHaveAttribute(
      "data-active",
    );
  });

  test("renders the dense table with one row per hit and all columns", () => {
    const hits = [makeHit({ id: 1, symbol: "AAA" }), makeHit({ id: 2, symbol: "BBB" })];
    render(() => <PatternListView hits={hits} onSelect={vi.fn()} />);
    const table = screen.getByTestId("patterns-list");
    expect(table).toBeInTheDocument();
    for (const header of ["Symbol", "Pattern", "Dir", "Status", "Q", "52W gap %", "Pos %", "Bars ago", "Price", "Chg %"]) {
      // A sticky header may clone a cell, so assert presence (>=1), not uniqueness.
      expect(within(table).getAllByText(header).length).toBeGreaterThanOrEqual(1);
    }
    // "Score" (pattern-fit confidence) carries the sort indicator (text split) → match loosely.
    expect(within(table).getAllByText(/Score/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId("patterns-list-row-AAA-falling_wedge-1")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-list-row-BBB-falling_wedge-2")).toBeInTheDocument();
  });

  test("opens index members from a broad-index row", async () => {
    const onShowMembers = vi.fn();
    render(() =>       <PatternListView
        hits={[makeHit({ id: 9, symbol: "NIFTY" })]}
        onSelect={vi.fn()}
        onShowMembers={onShowMembers}
      />);

    fireEvent.click(screen.getByTestId("patterns-list-members-NIFTY"));
    expect(onShowMembers).toHaveBeenCalledWith("NIFTY");
  });

  test("Score header clarifies it is pattern-fit, not breakout conviction", () => {
    render(() => <PatternListView hits={[makeHit()]} onSelect={vi.fn()} />);
    const header = screen.getByText("Score");
    expect(header.getAttribute("title")).toBe(
      "Pattern-fit confidence (geometry fit, R², volume) — not breakout conviction.",
    );
  });

  test("seeds its sort from the rail sort (range_pos → Pos % desc)", () => {
    const hits = [
      makeHit({ id: 1, symbol: "AAA", range_pos: 10, confidence: 99 }),
      makeHit({ id: 2, symbol: "BBB", range_pos: 90, confidence: 50 }),
    ];
    render(() => <PatternListView hits={hits} onSelect={vi.fn()} sort="range_pos" />);
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
    render(() => <PatternListView hits={hits} onSelect={vi.fn()} />);
    const rows = within(screen.getByTestId("patterns-list")).getAllByTestId(/^patterns-list-row-/);
    expect(rows.map((el) => el.getAttribute("data-testid"))).toEqual([
      "patterns-list-row-BBB-falling_wedge-2",
      "patterns-list-row-AAA-falling_wedge-1",
    ]);
  });

  test("formats price, change, gap and badges", () => {
    render(() => <PatternListView hits={[makeHit()]} onSelect={vi.fn()} />);
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
    render(() => <PatternListView hits={hits} onSelect={vi.fn()} />);
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
    render(() => <PatternListView hits={hits} onSelect={vi.fn()} />);
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
    render(() =>       <PatternListView
        hits={[makeHit({ day_change_pct: null, last_close: null, to_52w_high: null })]}
        onSelect={vi.fn()}
      />);
    const row = screen.getByTestId("patterns-list-row-IRCON-falling_wedge-1");
    // (112.6 - 100) / 100 = +12.60%; price falls back to end_price.
    expect(within(row).getByText("+12.60%")).toBeInTheDocument();
    expect(within(row).getByText("₹112.60")).toBeInTheDocument();
    // Missing 52W gap and missing base position both render "—".
    expect(within(row).getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  test("renders the To trigger column with a signed percentage", () => {
    const box = [
      [{ t: "2026-01-01", price: 110 }],
      [{ t: "2026-01-01", price: 100 }],
    ];
    const base = { pattern_id: "consolidation", base_days: 80 } as const;
    render(() =>       <PatternListView
        hits={[
          makeHit({ ...base, id: 1, symbol: "AAA", last_close: 115, trendlines: box, to_52w_high: 5, range_pos: 50 }),
          makeHit({ ...base, id: 2, symbol: "BBB", last_close: 105, trendlines: box, to_52w_high: 5, range_pos: 50 }),
          makeHit({
            ...base,
            id: 3,
            symbol: "CCC",
            last_close: null,
            end_price: 110,
            trendlines: [],
            to_52w_high: 5,
            range_pos: 50,
          }),
          // Non-base patterns have no horizontal trigger box → no distance.
          makeHit({ id: 4, symbol: "DDD", last_close: 115, trendlines: box, to_52w_high: 5, range_pos: 50 }),
        ]}
        onSelect={vi.fn()}
      />);
    const table = screen.getByTestId("patterns-list");
    expect(within(table).getByText("To trigger")).toBeInTheDocument();
    const aaa = screen.getByTestId("patterns-list-row-AAA-consolidation-1");
    expect(within(aaa).getByText("+4.5%")).toBeInTheDocument();
    const bbb = screen.getByTestId("patterns-list-row-BBB-consolidation-2");
    expect(within(bbb).getByText("−4.5%")).toBeInTheDocument();
    const ccc = screen.getByTestId("patterns-list-row-CCC-consolidation-3");
    expect(within(ccc).getByText("—")).toBeInTheDocument();
    const ddd = screen.getByTestId("patterns-list-row-DDD-falling_wedge-4");
    expect(within(ddd).getByText("—")).toBeInTheDocument();
  });

  test("clicking a row selects that hit", async () => {
    const onSelect = vi.fn();
    const hits = [makeHit({ id: 1, symbol: "AAA" }), makeHit({ id: 2, symbol: "BBB" })];
    render(() => <PatternListView hits={hits} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId("patterns-list-row-BBB-falling_wedge-2"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(hits[1]);
  });

  test("shows the F&O badge for tagged rows only; an ETF tag is tolerated without a badge", () => {
    const hits = [
      makeHit({ id: 1, symbol: "AAA", tags: ["F&O"] } as unknown as Partial<PatternHitDTO>),
      makeHit({ id: 2, symbol: "BBB" }),
      makeHit({ id: 3, symbol: "CCC", tags: ["ETF"] } as unknown as Partial<PatternHitDTO>),
    ];
    render(() => <PatternListView hits={hits} onSelect={vi.fn()} />);

    expect(screen.getByTestId("patterns-list-tag-fno-AAA")).toHaveTextContent("F&O");
    expect(screen.queryByTestId("patterns-list-tag-fno-BBB")).not.toBeInTheDocument();
    // Results are equities: no F&O badge for the ETF-tagged row either, and no crash.
    expect(screen.queryByTestId("patterns-list-tag-fno-CCC")).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("patterns-list-row-CCC-falling_wedge-3")).queryByText("ETF"),
    ).not.toBeInTheDocument();
  });
});
