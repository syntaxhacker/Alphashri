// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { UIProvider } from "@/ui";
import type { RotationPeriod, RotationRow } from "../../types/rotation";
import { RotationBoard } from "./RotationBoard";

const BASE_RETURNS: Record<RotationPeriod, number> = {
  "1D": 0,
  "1W": 0,
  "1M": 0,
  "3M": 0,
  "6M": 0,
  YTD: 0,
  "1Y": 0,
};

function makeRow(
  id: string,
  name: string,
  periodReturns: Partial<Record<RotationPeriod, number>>,
  overrides: Partial<RotationRow> = {},
): RotationRow {
  return {
    id,
    name,
    kind: "sector",
    category: name,
    members: 10,
    covered: 10,
    returns: { ...BASE_RETURNS, ...periodReturns },
    rs_1m: 5,
    rs_1w: 2,
    rs_pct: 50,
    mom_pct: 50,
    rank: 1,
    rank_delta: 0,
    breadth: 50,
    rel_volume: 1,
    quadrant: "leading",
    status: "neutral",
    top_movers: [],
    ...overrides,
  };
}

function renderBoard(
  rows: RotationRow[],
  period: RotationPeriod,
  selectedId: string | null = null,
  onSelect: (id: string) => void = () => {},
) {
  return render(
    () => (
      <RotationBoard rows={rows} selectedId={selectedId} onSelect={onSelect} period={period} />
    ),
    { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> },
  );
}

function boardRowTestIds(): (string | null)[] {
  const board = screen.getByTestId("rotation-board");
  return within(board)
    .getAllByRole("button")
    .map((element) => element.getAttribute("data-testid"));
}

describe("RotationBoard", () => {
  afterEach(() => {
    cleanup();
  });

  test("sorts rows by the selected period descending", () => {
    const rows = [
      makeRow("a", "Alpha", { "1W": -2 }),
      makeRow("b", "Bravo", { "1W": 4 }),
      makeRow("c", "Charlie", { "1W": 0 }),
    ];
    renderBoard(rows, "1W");

    expect(boardRowTestIds()).toEqual([
      "rotation-row-b",
      "rotation-row-c",
      "rotation-row-a",
    ]);
    expect(screen.getByTestId("rotation-board")).toHaveAttribute("data-period", "1W");
  });

  test("re-sorts and repaints when the period prop changes", async () => {
    const rows = [
      makeRow("a", "Alpha", { "1W": -2, "1M": 12 }),
      makeRow("b", "Bravo", { "1W": 4, "1M": 2 }),
    ];
    const [period, setPeriod] = createSignal<RotationPeriod>("1W");
    render(
      () => (
        <RotationBoard rows={rows} selectedId={null} onSelect={() => {}} period={period()} />
      ),
      { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> },
    );

    expect(boardRowTestIds()).toEqual(["rotation-row-b", "rotation-row-a"]);
    expect(screen.getByTestId("rotation-board-value-b")).toHaveTextContent("+4.0%");
    expect(screen.getByTestId("rotation-board-value-a")).toHaveTextContent("-2.0%");

    setPeriod("1M");
    await waitFor(() =>
      expect(boardRowTestIds()).toEqual(["rotation-row-a", "rotation-row-b"]),
    );
    expect(screen.getByTestId("rotation-board-value-a")).toHaveTextContent("+12.0%");
    expect(screen.getByTestId("rotation-board-value-b")).toHaveTextContent("+2.0%");
    expect(screen.getByTestId("rotation-board-bar-a")).toHaveAttribute("data-width", "50");
  });

  test("renders rank, name, signed bar and direct support labels", () => {
    const row = makeRow(
      "sector:tech",
      "Technology",
      { "1D": 1.2, "1W": 3.8, "1M": 8.8 },
      { rank_delta: 4, breadth: 72, rs_1m: 9.1, status: "booming" },
    );
    renderBoard([row], "1M", "sector:tech");

    const rowElement = screen.getByTestId("rotation-row-sector:tech");
    expect(screen.getByTestId("rotation-board-rank-sector:tech")).toHaveTextContent("01");
    expect(rowElement).toHaveTextContent("Technology");
    expect(rowElement).toHaveTextContent("BOOM");
    expect(rowElement).toHaveTextContent("+1.2%");
    expect(rowElement).toHaveTextContent("+3.8%");
    expect(rowElement).toHaveTextContent("+8.8%");
    expect(rowElement).toHaveTextContent("RS");
    expect(rowElement).toHaveTextContent("9.10");
    expect(rowElement).toHaveTextContent("rank");
    expect(rowElement).toHaveTextContent("+4");
    expect(rowElement).toHaveTextContent("breadth");
    expect(rowElement).toHaveTextContent("72%");
    expect(screen.getByTestId("rotation-board-value-sector:tech")).toHaveTextContent("+8.8%");

    expect(rowElement.querySelector("table")).toBeNull();
    expect(rowElement.querySelector('[role="table"]')).toBeNull();
  });

  test("draws signed bars from the centre line", () => {
    const rows = [
      makeRow("pos", "Positive", { "1M": 10 }),
      makeRow("neg", "Negative", { "1M": -5 }),
      makeRow("flat", "Flat", { "1M": 0 }),
    ];
    renderBoard(rows, "1M");

    const positive = screen.getByTestId("rotation-board-bar-pos");
    expect(positive).toHaveAttribute("data-negative", "false");
    expect(positive).toHaveAttribute("data-width", "50");

    const negative = screen.getByTestId("rotation-board-bar-neg");
    expect(negative).toHaveAttribute("data-negative", "true");
    expect(negative).toHaveAttribute("data-width", "25");

    const flat = screen.getByTestId("rotation-board-bar-flat");
    expect(flat).toHaveAttribute("data-width", "0");
  });

  test("click selects the group id exactly once", () => {
    const onSelect = vi.fn();
    renderBoard([makeRow("sector:energy", "Energy", { "1M": 2 })], "1M", null, onSelect);

    fireEvent.click(screen.getByTestId("rotation-row-sector:energy"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("sector:energy");
  });

  test("Enter and Space each select the group id exactly once", () => {
    const onSelect = vi.fn();
    renderBoard(
      [
        makeRow("sector:energy", "Energy", { "1M": 2 }),
        makeRow("sector:tech", "Technology", { "1M": 1 }),
      ],
      "1M",
      null,
      onSelect,
    );

    fireEvent.keyDown(screen.getByTestId("rotation-row-sector:energy"), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenLastCalledWith("sector:energy");

    fireEvent.keyDown(screen.getByTestId("rotation-row-sector:tech"), { key: " " });
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenLastCalledWith("sector:tech");
  });

  test("shows the selected row with a rail, tint and pressed state", () => {
    renderBoard(
      [
        makeRow("sector:energy", "Energy", { "1M": 2 }),
        makeRow("sector:tech", "Technology", { "1M": 1 }),
      ],
      "1M",
      "sector:tech",
    );

    const selected = screen.getByTestId("rotation-row-sector:tech");
    expect(selected).toHaveAttribute("aria-pressed", "true");
    expect(selected).toHaveAttribute("data-active", "true");
    const style = selected.getAttribute("style") ?? "";
    expect(style).toContain("inset 2px");
    expect(style).toContain("rgba(");

    const other = screen.getByTestId("rotation-row-sector:energy");
    expect(other).toHaveAttribute("aria-pressed", "false");
    expect(other).not.toHaveAttribute("data-active");
  });

  test("keeps a minmax grid with no fixed width at 390", () => {
    renderBoard([makeRow("sector:tech", "Technology", { "1M": 1 })], "1M");

    const board = screen.getByTestId("rotation-board");
    expect(board).toHaveClass("min-w-0");
    expect(board).toHaveClass("overflow-hidden");

    const row = screen.getByTestId("rotation-row-sector:tech");
    expect(row).toHaveClass("grid-cols-[18px_minmax(0,1fr)_auto]");
    expect(row.getAttribute("style") ?? "").not.toMatch(/min-width/i);
  });
});
