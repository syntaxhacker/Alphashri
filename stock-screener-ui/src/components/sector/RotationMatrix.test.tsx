// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import type { RotationPeriod, RotationRow } from "../../types/rotation";
import { RotationMatrix } from "./RotationMatrix";

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
  overrides: Partial<RotationRow> = {},
  periodReturns: Partial<Record<RotationPeriod, number>> = {},
): RotationRow {
  return {
    id,
    name,
    kind: "sector",
    category: name,
    members: 10,
    covered: 10,
    returns: { ...BASE_RETURNS, ...periodReturns },
    rs_1m: 0,
    rs_1w: 0,
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

function renderMatrix(
  rows: RotationRow[],
  selectedId: string | null = null,
  onSelect: (id: string) => void = () => {},
) {
  return render(() => <RotationMatrix rows={rows} selectedId={selectedId} onSelect={onSelect} />, {
    wrapper: ({ children }) => <UIProvider>{children}</UIProvider>,
  });
}

function rowTestIds(): (string | null)[] {
  const rows = screen.getByTestId("rotation-matrix-rows");
  return Array.from(rows.querySelectorAll("button")).map((element) =>
    element.getAttribute("data-testid"),
  );
}

describe("RotationMatrix", () => {
  afterEach(() => {
    cleanup();
  });

  test("renders seven direct-labeled period cells and no table markup", () => {
    const tech = makeRow("sector:tech", "Technology", {}, {
      "1D": 1.2,
      "1W": -3.8,
      "1M": 8.8,
      "3M": 14.2,
      "6M": 19.1,
      YTD: 24.8,
      "1Y": 30.2,
    });
    renderMatrix([tech]);

    const matrix = screen.getByTestId("rotation-matrix");
    expect(matrix.querySelector("table")).toBeNull();
    expect(matrix.querySelector('[role="table"]')).toBeNull();

    const expected: Record<RotationPeriod, string> = {
      "1D": "+1.2%",
      "1W": "-3.8%",
      "1M": "+8.8%",
      "3M": "+14.2%",
      "6M": "+19.1%",
      YTD: "+24.8%",
      "1Y": "+30.2%",
    };
    for (const [period, label] of Object.entries(expected) as [RotationPeriod, string][]) {
      expect(screen.getByTestId(`rotation-matrix-cell-sector:tech-${period}`)).toHaveTextContent(
        label,
      );
    }

    const header = screen.getByTestId("rotation-matrix-header");
    for (const period of ["1D", "1W", "1M", "3M", "6M", "YTD", "1Y"]) {
      expect(header).toHaveTextContent(period);
    }
  });

  test("sorts rows by 1M descending and keeps ties stable", () => {
    const rows = [
      makeRow("a", "Alpha", {}, { "1M": 5 }),
      makeRow("b", "Bravo", {}, { "1M": 9 }),
      makeRow("c", "Charlie", {}, { "1M": 5 }),
      makeRow("d", "Delta", {}, { "1M": Number.NaN }),
    ];
    renderMatrix(rows);

    expect(rowTestIds()).toEqual([
      "rotation-matrix-row-b",
      "rotation-matrix-row-a",
      "rotation-matrix-row-c",
      "rotation-matrix-row-d",
    ]);
  });

  test("click selects the group id exactly once", () => {
    const onSelect = vi.fn();
    renderMatrix([makeRow("sector:energy", "Energy")], null, onSelect);

    fireEvent.click(screen.getByTestId("rotation-matrix-row-sector:energy"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("sector:energy");
  });

  test("Enter and Space each select the group id exactly once", () => {
    const onSelect = vi.fn();
    renderMatrix(
      [makeRow("sector:energy", "Energy"), makeRow("sector:tech", "Technology")],
      null,
      onSelect,
    );

    const energy = screen.getByTestId("rotation-matrix-row-sector:energy");
    fireEvent.keyDown(energy, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenLastCalledWith("sector:energy");

    fireEvent.keyDown(screen.getByTestId("rotation-matrix-row-sector:tech"), { key: " " });
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenLastCalledWith("sector:tech");
  });

  test("shows the selected row with a rail, tint and pressed state", () => {
    renderMatrix(
      [makeRow("sector:energy", "Energy"), makeRow("sector:tech", "Technology")],
      "sector:tech",
    );

    const selected = screen.getByTestId("rotation-matrix-row-sector:tech");
    expect(selected).toHaveAttribute("aria-pressed", "true");
    expect(selected).toHaveAttribute("data-active", "true");
    const style = selected.getAttribute("style") ?? "";
    expect(style).toContain("inset 2px");
    expect(style).toContain("rgba(");

    const other = screen.getByTestId("rotation-matrix-row-sector:energy");
    expect(other).toHaveAttribute("aria-pressed", "false");
    expect(other).not.toHaveAttribute("data-active");
  });

  test("keeps a minmax grid with no fixed width at 390", () => {
    renderMatrix([makeRow("sector:tech", "Technology")]);

    const matrix = screen.getByTestId("rotation-matrix");
    expect(matrix).toHaveClass("min-w-0");
    expect(matrix).toHaveClass("overflow-hidden");

    const rows = screen.getByTestId("rotation-matrix-rows");
    expect(rows).toHaveClass("overflow-x-hidden");

    const grid = screen.getByTestId("rotation-matrix-row-sector:tech");
    expect(grid).toHaveClass("grid-cols-[62px_repeat(7,minmax(0,1fr))]");
    expect(grid.getAttribute("style") ?? "").not.toMatch(/min-width/i);
  });
});
