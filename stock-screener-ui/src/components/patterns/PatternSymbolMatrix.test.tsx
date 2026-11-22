// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, within, fireEvent } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import type { PatternHitDTO } from "@/types/chartPatterns";

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/test-utils/solidUiMock");
  return mockSolidUi();
});
import {
  matrixRenderStats,
  matrixRenderStatsReset,
  PatternSymbolMatrix,
} from "./PatternSymbolMatrix";
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

  test("active-row tint is derived from the primary token, not a hardcoded blue", () => {
    const { rowA, rowB } = fixtureRows();
    render(() => <PatternSymbolMatrix
        rows={[rowA, rowB]}
        timeframes={["1D", "1W"]}
        onSelect={vi.fn()}
        activeSymbol={rowB.symbol}
      />);
    const style = screen.getByTestId(`patterns-matrix-row-${rowB.symbol}`).getAttribute("style") ?? "";
    expect(style).not.toContain("88, 166, 255");
    expect(style).toContain("217, 144, 42");
  });

  test("a clipped symbol name keeps its full text in the title", () => {
    const { rowA } = fixtureRows();
    render(() => <PatternSymbolMatrix rows={[rowA]} timeframes={["1D"]} onSelect={vi.fn()} />);
    expect(
      within(screen.getByTestId("patterns-matrix-row-AAA")).getByTitle("Alpha Industries Ltd."),
    ).toBeInTheDocument();
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

  test("orders multi-hit rows by best conviction and selects that best hit", () => {
    const onSelect = vi.fn();
    const strong5m = makeHit({
      id: 1,
      symbol: "STR",
      timeframe: "5m",
      pattern_name: "Strong 5m",
      confidence: 90,
      bars_ago: 4,
      range_pos: 90,
    });
    const strong1d = makeHit({
      id: 2,
      symbol: "STR",
      timeframe: "1D",
      pattern_name: "Strong 1D",
      confidence: 40,
      bars_ago: 1,
    });
    const mid5m = makeHit({ id: 3, symbol: "MID", timeframe: "5m", pattern_name: "Mid 5m", confidence: 80 });
    const tie5m = makeHit({ id: 4, symbol: "TIE", timeframe: "5m", pattern_name: "Tie Alpha", confidence: 70, bars_ago: 1 });
    const tie1d = makeHit({ id: 5, symbol: "TIE", timeframe: "1D", pattern_name: "Tie Beta", confidence: 70, bars_ago: 1 });
    const rows = [
      makeRow({ symbol: "STR", hits: [strong5m, strong1d] }),
      makeRow({ symbol: "MID", hits: [mid5m] }),
      makeRow({ symbol: "TIE", hits: [tie5m, tie1d] }),
    ];

    render(() => <PatternSymbolMatrix rows={rows} timeframes={["5m", "1D"]} onSelect={onSelect} />);

    expect(screen.getAllByTestId(/patterns-matrix-row-/).map((el) => el.getAttribute("data-testid"))).toEqual([
      "patterns-matrix-row-STR",
      "patterns-matrix-row-MID",
      "patterns-matrix-row-TIE",
    ]);
    fireEvent.click(screen.getByTestId("patterns-matrix-row-STR"));
    expect(onSelect).toHaveBeenCalledWith(strong5m);
    const cells = within(screen.getByTestId("patterns-matrix-row-STR")).getAllByRole("cell");
    expect(cells[5]).toHaveTextContent("90.0");
    expect(cells[6]).toHaveTextContent("90%");
  });

  test("equal conviction keeps the first hit as best while chips still sort by status", () => {
    const onSelect = vi.fn();
    const forming = makeHit({
      id: 1,
      symbol: "TIE",
      timeframe: "5m",
      pattern_name: "Tie Alpha",
      status: "forming",
      confidence: 70,
      bars_ago: 1,
    });
    const confirmed = makeHit({
      id: 2,
      symbol: "TIE",
      timeframe: "1D",
      pattern_name: "Tie Beta",
      status: "confirmed",
      confidence: 70,
      bars_ago: 1,
    });
    const row = makeRow({ symbol: "TIE", hits: [forming, confirmed] });

    render(() => <PatternSymbolMatrix rows={[row]} timeframes={["5m", "1D"]} onSelect={onSelect} />);

    fireEvent.click(screen.getByTestId("patterns-matrix-row-TIE"));
    expect(onSelect).toHaveBeenCalledWith(forming);
    const cells = within(screen.getByTestId("patterns-matrix-row-TIE")).getAllByRole("cell");
    const chips = Array.from(cells[7].querySelectorAll("button")).map((el) => el.textContent);
    expect(chips).toEqual(["Tie Beta 1D", "Tie Alpha 5m"]);
  });

  test("omits rows with no hits in the selected timeframes", () => {
    const otherTf = makeHit({ id: 1, symbol: "OUT", timeframe: "1W", confidence: 99 });
    const rows = [
      makeRow({ symbol: "OUT", hits: [otherTf] }),
      makeRow({ symbol: "EMPTY", hits: [] }),
    ];

    render(() => <PatternSymbolMatrix rows={rows} timeframes={["5m", "1D"]} onSelect={vi.fn()} />);

    expect(screen.queryByTestId("patterns-matrix-row-OUT")).not.toBeInTheDocument();
    expect(screen.queryByTestId("patterns-matrix-row-EMPTY")).not.toBeInTheDocument();
    expect(screen.getByText("No symbols match the current filters.")).toBeInTheDocument();
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
    expect(table.style.minWidth).toBe(`${Math.max(560, 9 * 72)}px`);
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
    expect(header("5m").style.textAlign).toBe("center");
  });
});

describe("PatternSymbolMatrix identity and filtering", () => {
  afterEach(() => {
    cleanup();
    matrixRenderStatsReset();
  });

  test("a fresh rows array with the same row objects rebuilds no cells or chips", () => {
    const { rowA, rowB } = fixtureRows();
    const [rows, setRows] = createSignal<PatternMatrixRow[]>([rowA, rowB]);
    matrixRenderStatsReset();
    render(() => <PatternSymbolMatrix rows={rows()} timeframes={["5m", "1D", "1W"]} onSelect={vi.fn()} />);

    expect(matrixRenderStats().visibleRowsBuilds).toBe(1);
    expect(matrixRenderStats().patternChipRenders).toBe(3);

    matrixRenderStatsReset();
    setRows([rowA, rowB]);
    const after = matrixRenderStats();
    expect(after.visibleRowsBuilds).toBe(1);
    expect(after.columnsBuilds).toBe(0);
    expect(after.symbolCellRenders).toBe(0);
    expect(after.tfGlyphRenders).toBe(0);
    expect(after.patternChipRenders).toBe(0);
    expect(after.numTextRenders).toBe(0);
    expect(screen.getAllByTestId(/patterns-matrix-row-/)).toHaveLength(2);
  });

  test("one changed row object rebuilds only that row's cells", () => {
    const { rowA, rowB } = fixtureRows();
    const [rows, setRows] = createSignal<PatternMatrixRow[]>([rowA, rowB]);
    render(() => <PatternSymbolMatrix rows={rows()} timeframes={["5m", "1D", "1W"]} onSelect={vi.fn()} />);

    matrixRenderStatsReset();
    setRows([rowA, { ...rowB, ltp: 999 }]);
    const after = matrixRenderStats();
    expect(after.columnsBuilds).toBe(0);
    expect(after.visibleRowsBuilds).toBe(1);
    expect(after.symbolCellRenders).toBe(1);
    expect(after.tfGlyphRenders).toBe(3);
    expect(after.numTextRenders).toBe(4);
    expect(after.patternChipRenders).toBe(1);
    const bCells = within(screen.getByTestId("patterns-matrix-row-BBB")).getAllByRole("cell");
    expect(bCells[1]).toHaveTextContent("₹999.00");
  });

  test("changing the timeframe filter refilters rows, columns and chips", () => {
    const { rowA, rowB } = fixtureRows();
    const [timeframes, setTimeframes] = createSignal(["5m", "1D", "1W"]);
    render(() => <PatternSymbolMatrix rows={[rowA, rowB]} timeframes={timeframes()} onSelect={vi.fn()} />);
    expect(screen.getByTestId("patterns-matrix-row-BBB")).toBeInTheDocument();

    matrixRenderStatsReset();
    setTimeframes(["1D"]);
    const after = matrixRenderStats();
    expect(after.columnsBuilds).toBe(1);
    expect(after.visibleRowsBuilds).toBe(1);
    expect(screen.queryByTestId("patterns-matrix-row-BBB")).not.toBeInTheDocument();
    const cells = within(screen.getByTestId("patterns-matrix-row-AAA")).getAllByRole("cell");
    expect(cells).toHaveLength(7);
    const chips = Array.from(cells[6].querySelectorAll("button")).map((el) => el.textContent);
    expect(chips).toEqual(["Head and Shoulders 1D"]);
  });

  test("post-sort rows keep their object identity across a rows-array swap", () => {
    const { rowA, rowB } = fixtureRows();
    const [rows, setRows] = createSignal<PatternMatrixRow[]>([rowA, rowB]);
    let emitted: PatternMatrixRow[] = [];
    render(() => <PatternSymbolMatrix
        rows={rows()}
        timeframes={["5m", "1D", "1W"]}
        onSelect={vi.fn()}
        onRowsChange={(next) => { emitted = next; }}
      />);
    const first = emitted;
    expect(first.map((row) => row.symbol)).toEqual(["AAA", "BBB"]);

    setRows([rowA, rowB]);
    expect(emitted).not.toBe(first);
    expect(emitted[0]).toBe(first[0]);
    expect(emitted[1]).toBe(first[1]);
  });
});
