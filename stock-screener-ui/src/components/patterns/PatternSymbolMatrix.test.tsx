// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, within, fireEvent } from "@solidjs/testing-library";
import type { PatternHitDTO } from "@/types/chartPatterns";

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/patterns/solidUiMock");
  return mockSolidUi();
});
import { PatternSymbolMatrix } from "./PatternSymbolMatrix";
import type { MatrixCell, PatternMatrixRow } from "./symbolMatrix";

function makeHit(overrides: Partial<PatternHitDTO> = {}): PatternHitDTO {
  return {
    id: 1,
    symbol: "AAA",
    name: null,
    timeframe: "1D",
    pattern_id: "double_bottom",
    pattern_name: "Double Bottom",
    family: "reversal",
    direction: "bullish",
    status: "confirmed",
    quality: "strong",
    confidence: 80,
    start_date: "2026-01-01",
    end_date: "2026-02-01",
    start_price: 100,
    end_price: 110,
    breakout_level: 110,
    target: 125,
    stop: 98,
    rr: 2,
    bars_ago: 3,
    volume_confirmed: true,
    trendlines: [],
    notes: "",
    ...overrides,
  };
}

function makeCell(overrides: Partial<MatrixCell> = {}): MatrixCell {
  return {
    direction: "bullish",
    status: "confirmed",
    count: 1,
    confidence: 80,
    patterns: ["Double Bottom"],
    best_id: 1,
    ...overrides,
  };
}

function makeRow(overrides: Partial<PatternMatrixRow> = {}): PatternMatrixRow {
  return {
    symbol: "AAA",
    name: null,
    ltp: 100,
    day_change_pct: 1,
    timeframes: { "1D": makeCell() },
    hits: [],
    best: null,
    hit_count: 0,
    ...overrides,
  };
}

function fixtureRows() {
  const hit5m = makeHit({
    id: 11,
    symbol: "AAA",
    timeframe: "5m",
    pattern_id: "double_bottom",
    pattern_name: "Double Bottom",
    direction: "bullish",
    status: "confirmed",
    confidence: 82.5,
    breakout_score: 73.4,
    range_pos: 88,
  });
  const hit1d = makeHit({
    id: 12,
    symbol: "AAA",
    timeframe: "1D",
    pattern_id: "head_shoulders",
    pattern_name: "Head and Shoulders",
    direction: "bearish",
    status: "forming",
    confidence: 55,
    breakout_score: null,
  });
  const hit1w = makeHit({
    id: 21,
    symbol: "BBB",
    timeframe: "1W",
    pattern_id: "ascending_triangle",
    pattern_name: "Ascending Triangle",
    direction: "bullish",
    status: "confirmed",
    confidence: 66.4,
    breakout_score: 41.6,
    range_pos: 61.7,
  });

  const rowA = makeRow({
    symbol: "AAA",
    name: "Alpha Industries Ltd.",
    ltp: 1234.5,
    day_change_pct: 2.5,
    hits: [hit1d, hit5m],
    best: hit5m,
    hit_count: 2,
    timeframes: {
      "5m": makeCell({
        confidence: 82.5,
        patterns: ["Double Bottom"],
        best_id: 11,
      }),
      "1D": makeCell({
        direction: "bearish",
        status: "forming",
        confidence: 55,
        patterns: ["Head and Shoulders"],
        best_id: 12,
      }),
    },
  });

  const rowB = makeRow({
    symbol: "BBB",
    name: null,
    ltp: null,
    day_change_pct: null,
    hits: [hit1w],
    best: hit1w,
    hit_count: 1,
    timeframes: {
      "1W": makeCell({
        confidence: 66.4,
        patterns: ["Ascending Triangle"],
        best_id: 21,
      }),
    },
  });

  return { hit5m, hit1d, hit1w, rowA, rowB };
}


describe("PatternSymbolMatrix", () => {
  afterEach(() => cleanup());

  test("marks the row whose symbol is docked in the chart", () => {
    const { rowA, rowB } = fixtureRows();
    render(() => <PatternSymbolMatrix
        rows={[rowA, rowB]}
        timeframes={["1D", "5m", "1W"]}
        onSelect={vi.fn()}
        activeSymbol={rowB.symbol}
      />);
    expect(screen.getByTestId(`patterns-matrix-row-${rowB.symbol}`)).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(screen.getByTestId(`patterns-matrix-row-${rowA.symbol}`)).not.toHaveAttribute(
      "data-active",
    );
  });

  test("renders one row per symbol with mapped timeframe headers", () => {
    const { rowA, rowB } = fixtureRows();
    render(() => <PatternSymbolMatrix rows={[rowA, rowB]} timeframes={["1D", "5m", "1W"]} onSelect={vi.fn()} />);

    const table = screen.getByTestId("patterns-symbol-matrix");
    const rows = screen.getAllByTestId(/patterns-matrix-row-/);
    expect(rows.map((el) => el.getAttribute("data-testid"))).toEqual([
      "patterns-matrix-row-AAA",
      "patterns-matrix-row-BBB",
    ]);
    for (const header of ["Symbol", "LTP", "Chg %", "5m", "1D", "1W", "Score", "Pos %", "Patterns"]) {
      expect(within(table).getAllByText(header).length).toBeGreaterThanOrEqual(1);
    }
  });

  test("renders glyphs for cells and an em dash for missing cells", () => {
    const { rowA, rowB } = fixtureRows();
    render(() => <PatternSymbolMatrix rows={[rowA, rowB]} timeframes={["5m", "1D", "1W"]} onSelect={vi.fn()} />);

    const rowAEl = screen.getByTestId("patterns-matrix-row-AAA");
    const cellsA = within(rowAEl).getAllByRole("cell");
    expect(cellsA[1]).toHaveTextContent("₹1,234.50");
    expect(cellsA[2]).toHaveTextContent("+2.50%");
    expect(cellsA[3]).toHaveTextContent("▲");
    expect(within(cellsA[3]).getByTitle("1 pattern: Double Bottom")).toBeInTheDocument();
    expect(cellsA[4]).toHaveTextContent("▼");
    expect(cellsA[5]).toHaveTextContent("—");
    expect(cellsA[6]).toHaveTextContent("82.5");
    expect(cellsA[7]).toHaveTextContent("88%");

    const rowBEl = screen.getByTestId("patterns-matrix-row-BBB");
    const cellsB = within(rowBEl).getAllByRole("cell");
    expect(cellsB[1]).toHaveTextContent("—");
    expect(cellsB[2]).toHaveTextContent("—");
    expect(cellsB[3]).toHaveTextContent("—");
    expect(cellsB[4]).toHaveTextContent("—");
    expect(cellsB[5]).toHaveTextContent("▲");
    expect(cellsB[6]).toHaveTextContent("66.4");
    expect(cellsB[7]).toHaveTextContent("62%");
  });

  test("orders chips actionable-first and selects the clicked chip, not the row best", async () => {
    const onSelect = vi.fn();
    const { rowA, rowB, hit1d } = fixtureRows();
    render(() => <PatternSymbolMatrix rows={[rowA, rowB]} timeframes={["5m", "1D", "1W"]} onSelect={onSelect} />);

    const rowAEl = screen.getByTestId("patterns-matrix-row-AAA");
    const patternsCell = within(rowAEl).getAllByRole("cell")[8];
    const chips = Array.from(patternsCell.querySelectorAll("button")).map((el) => el.textContent);
    expect(chips).toEqual(["Double Bottom 5m", "Head and Shoulders 1D"]);

    fireEvent.click(within(patternsCell).getByText("Head and Shoulders 1D"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(hit1d);
  });

  test("matrix chips are keyboard-activatable", async () => {
    const onSelect = vi.fn();
    const { rowA, rowB, hit1d } = fixtureRows();
    render(() => <PatternSymbolMatrix rows={[rowA, rowB]} timeframes={["5m", "1D", "1W"]} onSelect={onSelect} />);
    const rowAEl = screen.getByTestId("patterns-matrix-row-AAA");
    const chip = within(rowAEl).getByRole("button", {
      name: "Open Head and Shoulders 1D chart",
    });
    chip.focus();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(hit1d);
  });

  test("clicking a row selects its best hit", async () => {
    const onSelect = vi.fn();
    const { rowA, rowB } = fixtureRows();
    render(() => <PatternSymbolMatrix rows={[rowA, rowB]} timeframes={["5m", "1D", "1W"]} onSelect={onSelect} />);

    fireEvent.click(screen.getByTestId("patterns-matrix-row-BBB"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(rowB.best);
  });

  test("keeps only the latest pattern per timeframe", () => {
    const hits = [
      makeHit({ id: 100, symbol: "CCC", timeframe: "5m", pattern_name: "Older", bars_ago: 5 }),
      makeHit({ id: 101, symbol: "CCC", timeframe: "5m", pattern_name: "Latest", bars_ago: 1 }),
      makeHit({ id: 102, symbol: "CCC", timeframe: "1D", pattern_name: "Daily", bars_ago: 2 }),
    ];
    const row = makeRow({
      symbol: "CCC",
      hits,
      best: hits[1],
      hit_count: 3,
      timeframes: {
        "5m": makeCell({ count: 2, confidence: 70, patterns: ["Latest"], best_id: 101 }),
        "1D": makeCell({ count: 1, confidence: 60, patterns: ["Daily"], best_id: 102 }),
      },
    });
    render(() => <PatternSymbolMatrix rows={[row]} timeframes={["5m", "1D"]} onSelect={vi.fn()} />);

    const cells = within(screen.getByTestId("patterns-matrix-row-CCC")).getAllByRole("cell");
    expect(cells[3]).toHaveTextContent("▲2");
    expect(within(cells[3]).getByTitle("2 patterns · latest: Latest")).toBeInTheDocument();
    const chips = Array.from(cells[7].querySelectorAll("button")).map((el) => el.textContent);
    expect(chips).toEqual(["Latest 5m", "Daily 1D"]);
    expect(within(cells[7]).queryByText("+1")).not.toBeInTheDocument();
  });

  test("filters rows, scores and chips to the selected timeframes", () => {
    const { rowA, rowB } = fixtureRows();
    render(() => <PatternSymbolMatrix rows={[rowA, rowB]} timeframes={["1D"]} onSelect={vi.fn()} />);

    expect(screen.queryByTestId("patterns-matrix-row-BBB")).not.toBeInTheDocument();
    const cells = within(screen.getByTestId("patterns-matrix-row-AAA")).getAllByRole("cell");
    expect(cells[3]).toHaveTextContent("▼");
    expect(cells[4]).toHaveTextContent("55.0");
    expect(cells[5]).toHaveTextContent("—");
    const chips = Array.from(cells[6].querySelectorAll("button")).map((el) => el.textContent);
    expect(chips).toEqual(["Head and Shoulders 1D"]);
  });

  test("opens index members from a broad-index row", async () => {
    const onShowMembers = vi.fn();
    const { rowA } = fixtureRows();
    const row = { ...rowA, symbol: "NIFTY", name: "Nifty 50" };
    render(() => <PatternSymbolMatrix
        rows={[row]}
        timeframes={["5m", "1D"]}
        onSelect={vi.fn()}
        onShowMembers={onShowMembers}
      />);

    fireEvent.click(screen.getByTestId("patterns-matrix-members-NIFTY"));
    expect(onShowMembers).toHaveBeenCalledWith("NIFTY");
    expect(screen.queryByTestId("patterns-matrix-members-AAA")).not.toBeInTheDocument();
  });

  test("renders the empty message when there are no rows", () => {
    render(() => <PatternSymbolMatrix
        rows={[]}
        timeframes={["5m"]}
        onSelect={vi.fn()}
        emptyMessage="Nothing to show."
      />);
    expect(screen.getByText("Nothing to show.")).toBeInTheDocument();
  });

  test("derives the min table width from the column count and scrolls in its panel", () => {
    const { rowA, rowB } = fixtureRows();
    render(() => <PatternSymbolMatrix rows={[rowA, rowB]} timeframes={["5m", "1D", "1W"]} onSelect={vi.fn()} />);
    const table = screen.getByTestId("patterns-symbol-matrix");
    // Symbol + LTP + Chg + 3 timeframes + Score + Pos + Patterns = 9 columns.
    expect(table.style.minWidth).toBe(`${Math.max(560, 9 * 72)}px`);
    // fillContainer: the table scrolls inside the panel rather than widening the page.
    const panel = table.closest(".paper-tanstack-container") as HTMLElement;
    expect(panel.style.maxHeight).toBe("");
    expect(panel.style.flex).toContain("1 1 0%");
  });

  test("numeric cells are mono, tabular and right-aligned", () => {
    const { rowA } = fixtureRows();
    render(() => <PatternSymbolMatrix rows={[rowA]} timeframes={["5m", "1D", "1W"]} onSelect={vi.fn()} />);
    const cells = within(screen.getByTestId("patterns-matrix-row-AAA")).getAllByRole("cell");
    const numeric: Array<[number, string]> = [
      [1, "₹1,234.50"],
      [2, "+2.50%"],
      [6, "82.5"],
      [7, "88%"],
    ];
    for (const [index, text] of numeric) {
      const value = within(cells[index]).getByText(text);
      expect(value.className).toContain("font-mono");
      expect(value.className).toContain("tabular-nums");
      expect(value.className).toContain("text-right");
    }
  });

  test("header alignment matches the columns", () => {
    const { rowA } = fixtureRows();
    render(() => <PatternSymbolMatrix rows={[rowA]} timeframes={["5m", "1D"]} onSelect={vi.fn()} />);
    const table = screen.getByTestId("patterns-symbol-matrix");
    const header = (label: string) => within(table).getByText(label).closest("th") as HTMLElement;
    expect(header("Symbol").style.textAlign).toBe("left");
    expect(header("LTP").style.textAlign).toBe("right");
    expect(header("Score").style.textAlign).toBe("right");
    expect(header("Pos %").style.textAlign).toBe("right");
    // Timeframe glyph columns are centred.
    expect(header("5m").style.textAlign).toBe("center");
  });
});
