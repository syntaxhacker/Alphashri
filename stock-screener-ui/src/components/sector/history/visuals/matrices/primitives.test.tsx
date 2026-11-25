// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { For } from "solid-js";
import { MONO, PRIMARY, SURFACE } from "@/ui/palette";
import { MatrixFrame, type MatrixRowRail } from "./MatrixFrame";
import { labelWidthFor } from "./labelWidth";
import { type RovingCell, useRovingGrid } from "./useRovingGrid";

const DEFAULT_ROWS = 3;
const DEFAULT_COLS = 4;

function cellId(row: number, col: number): string {
  return `roving-${row}-${col}`;
}

interface RovingHarnessProps {
  rows?: number;
  cols?: number;
  initial?: RovingCell;
  onFocus?: (cell: RovingCell) => void;
}

function RovingHarness(props: RovingHarnessProps) {
  const rows = () => props.rows ?? DEFAULT_ROWS;
  const cols = () => props.cols ?? DEFAULT_COLS;
  const grid = useRovingGrid({
    rows,
    cols,
    cellId,
    initial: props.initial,
    onFocus: props.onFocus,
  });

  return (
    <div>
      <output data-testid="active-cell">{`${grid.active().row},${grid.active().col}`}</output>
      <output data-testid="first-active">{String(grid.isActive(0, 0))}</output>
      <button type="button" data-testid="jump-cell" onClick={() => grid.focusCell(2, 3)}>
        jump
      </button>
      <button type="button" data-testid="mark-cell" onClick={() => grid.setActive(1, 1)}>
        mark
      </button>
      <button
        type="button"
        data-testid="mark-object"
        onClick={() => grid.setActive({ row: 2, col: 2 })}
      >
        mark object
      </button>
      <div role="grid" aria-label="Roving test grid">
        <For each={Array.from({ length: rows() }, (_, row) => row)}>
          {(row) => (
            <div role="row">
              <For each={Array.from({ length: cols() }, (_, col) => col)}>
                {(col) => (
                  <div
                    role="gridcell"
                    id={cellId(row, col)}
                    aria-label={`cell ${row},${col}`}
                    tabindex={grid.tabIndex(row, col)}
                    onFocus={() => grid.setActive(row, col)}
                    onKeyDown={(event) => grid.onKeyDown(event, row, col)}
                  >
                    {`${row},${col}`}
                  </div>
                )}
              </For>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

function gridCells(): HTMLElement[] {
  return screen.getAllByRole("gridcell");
}

function cellAt(row: number, col: number): HTMLElement {
  const element = document.getElementById(cellId(row, col));
  if (!element) throw new Error(`Missing cell ${row},${col}`);
  return element;
}

function expectActive(row: number, col: number) {
  const target = cellAt(row, col);
  expect(target).toHaveAttribute("tabindex", "0");
  expect(document.activeElement).toBe(target);
  expect(screen.getByTestId("active-cell")).toHaveTextContent(`${row},${col}`);
  expect(gridCells().filter((cell) => cell.getAttribute("tabindex") === "0")).toEqual([target]);
}

const RAIL: MatrixRowRail = {
  rows: [{ label: "NIFTY IT", title: "Information technology" }, { label: "PSU BANK" }],
  labelWidth: 140,
  headerHeight: 24,
  rowHeight: 20,
  footerHeight: 12,
};

afterEach(() => {
  cleanup();
});

describe("useRovingGrid", () => {
  test("renders exactly one tab stop and reports the active cell", () => {
    render(() => <RovingHarness />);
    const cells = gridCells();
    expect(cells).toHaveLength(DEFAULT_ROWS * DEFAULT_COLS);
    expect(cells.filter((cell) => cell.getAttribute("tabindex") === "0")).toEqual([cellAt(0, 0)]);
    expect(cellAt(0, 0)).toHaveAttribute("tabindex", "0");
    expect(cellAt(2, 3)).toHaveAttribute("tabindex", "-1");
    expect(screen.getByTestId("active-cell")).toHaveTextContent("0,0");
    expect(screen.getByTestId("first-active")).toHaveTextContent("true");
  });

  test("moves with arrows, Home and End, and clamps at every edge", () => {
    render(() => <RovingHarness />);

    fireEvent.keyDown(cellAt(0, 0), { key: "ArrowRight" });
    expectActive(0, 1);

    fireEvent.keyDown(cellAt(0, 1), { key: "ArrowDown" });
    expectActive(1, 1);

    fireEvent.keyDown(cellAt(1, 1), { key: "ArrowLeft" });
    expectActive(1, 0);

    fireEvent.keyDown(cellAt(1, 0), { key: "ArrowUp" });
    expectActive(0, 0);

    fireEvent.keyDown(cellAt(0, 0), { key: "ArrowUp" });
    expectActive(0, 0);
    fireEvent.keyDown(cellAt(0, 0), { key: "ArrowLeft" });
    expectActive(0, 0);

    fireEvent.keyDown(cellAt(0, 0), { key: "End" });
    expectActive(0, 3);

    fireEvent.keyDown(cellAt(0, 3), { key: "ArrowRight" });
    expectActive(0, 3);
    fireEvent.keyDown(cellAt(0, 3), { key: "Home" });
    expectActive(0, 0);

    fireEvent.keyDown(cellAt(0, 0), { key: "ArrowDown" });
    fireEvent.keyDown(cellAt(1, 0), { key: "ArrowDown" });
    fireEvent.keyDown(cellAt(2, 0), { key: "ArrowDown" });
    expectActive(2, 0);
  });

  test("prevents default on Enter and Space without leaving the cell", () => {
    render(() => <RovingHarness />);
    fireEvent.keyDown(cellAt(0, 0), { key: "ArrowRight" });
    expectActive(0, 1);

    expect(fireEvent.keyDown(cellAt(0, 1), { key: "Enter" })).toBe(false);
    expectActive(0, 1);

    expect(fireEvent.keyDown(cellAt(0, 1), { key: " " })).toBe(false);
    expectActive(0, 1);

    expect(fireEvent.keyDown(cellAt(0, 1), { key: "a" })).toBe(true);
    expectActive(0, 1);
  });

  test("focusCell focuses the requested cell and setActive moves the tab stop", () => {
    render(() => <RovingHarness />);

    fireEvent.click(screen.getByTestId("jump-cell"));
    expectActive(2, 3);

    fireEvent.click(screen.getByTestId("mark-cell"));
    expect(cellAt(1, 1)).toHaveAttribute("tabindex", "0");
    expect(cellAt(2, 3)).toHaveAttribute("tabindex", "-1");
    expect(screen.getByTestId("active-cell")).toHaveTextContent("1,1");
    expect(gridCells().filter((cell) => cell.getAttribute("tabindex") === "0")).toEqual([
      cellAt(1, 1),
    ]);

    fireEvent.click(screen.getByTestId("mark-object"));
    expect(cellAt(2, 2)).toHaveAttribute("tabindex", "0");
    expect(cellAt(1, 1)).toHaveAttribute("tabindex", "-1");
    expect(screen.getByTestId("active-cell")).toHaveTextContent("2,2");
  });

  test("clamps an out-of-bounds initial cell", () => {
    render(() => <RovingHarness initial={{ row: 99, col: -4 }} />);
    expect(cellAt(2, 0)).toHaveAttribute("tabindex", "0");
    expect(screen.getByTestId("active-cell")).toHaveTextContent("2,0");
  });

  test("calls onFocus with the new cell after a key move", () => {
    const onFocus = vi.fn();
    render(() => <RovingHarness onFocus={onFocus} />);

    fireEvent.keyDown(cellAt(0, 0), { key: "ArrowRight" });
    expect(onFocus).toHaveBeenCalledWith({ row: 0, col: 1 });

    fireEvent.keyDown(cellAt(0, 1), { key: "ArrowLeft" });
    expect(onFocus).toHaveBeenLastCalledWith({ row: 0, col: 0 });
  });

  test("a move mutates only the old and new tabindex attributes", () => {
    render(() => <RovingHarness />);
    const grid = screen.getByRole("grid");
    const observer = new MutationObserver(() => {});
    observer.observe(grid, {
      attributes: true,
      attributeFilter: ["tabindex"],
      subtree: true,
    });

    fireEvent.keyDown(cellAt(0, 0), { key: "ArrowRight" });
    const records = observer.takeRecords();
    observer.disconnect();

    expect(records).toHaveLength(2);
    expect(records.map((record) => record.target)).toEqual([cellAt(0, 0), cellAt(0, 1)]);
    expect(cellAt(0, 0)).toHaveAttribute("tabindex", "-1");
    expect(cellAt(0, 1)).toHaveAttribute("tabindex", "0");
  });
});

describe("MatrixFrame", () => {
  test("renders an accessible SVG with title, desc, background and focus style", () => {
    render(() => (
      <MatrixFrame
        title="Rank matrix"
        desc="Rows are sectors and columns are months."
        width={320}
        height={160}
        testId="matrix-frame"
        className="custom-matrix"
        style={{ "max-width": "480px" }}
        data-top3="true"
        rowRail={RAIL}
      >
        <rect data-cell="0-0" x={140} y={24} width={20} height={20} fill={SURFACE} />
      </MatrixFrame>
    ));

    const svg = screen.getByTestId("matrix-frame");
    expect(svg.tagName.toLowerCase()).toBe("svg");
    expect(svg).toHaveAttribute("role", "img");
    expect(svg).toHaveAttribute("viewBox", "0 0 320 160");
    expect(svg).toHaveAttribute("preserveAspectRatio", "xMinYMin meet");
    expect(svg).toHaveAttribute("font-family", MONO);
    expect(svg).toHaveAttribute("font-size", "12");
    expect(svg).toHaveAttribute("data-top3", "true");

    const labelledBy = (svg.getAttribute("aria-labelledby") ?? "").split(" ").filter(Boolean);
    expect(labelledBy).toHaveLength(2);
    for (const id of labelledBy) {
      expect(svg.querySelector(`#${id}`)).not.toBeNull();
    }
    expect(svg.querySelector("title")).toHaveTextContent("Rank matrix");
    expect(svg.querySelector("desc")).toHaveTextContent("Rows are sectors and columns are months.");

    const background = svg.querySelector("rect");
    expect(background).toHaveAttribute("width", "320");
    expect(background).toHaveAttribute("height", "160");
    expect(background).toHaveAttribute("fill", SURFACE);
    expect(svg.querySelector('[data-cell="0-0"]')).not.toBeNull();

    const root = screen.getByTestId("matrix-frame-frame");
    expect(root).toHaveClass("custom-matrix");
    expect(root).toHaveStyle({ "max-width": "480px" });
    expect(root).toHaveAttribute("data-top3", "true");

    const focusStyle = root.querySelector("style");
    expect(focusStyle?.textContent).toContain("[data-cell]:focus-visible");
    expect(focusStyle?.textContent).toContain(`outline: 2px solid ${PRIMARY}`);
  });

  test("appends caller label ids after the generated title and desc ids", () => {
    render(() => (
      <MatrixFrame
        title="Labelled matrix"
        desc="Extra labels are appended."
        width={200}
        height={100}
        testId="matrix-labelled"
        labelledBy="external-matrix-label"
      >
        <text>body</text>
      </MatrixFrame>
    ));

    const svg = screen.getByTestId("matrix-labelled");
    const labelledBy = (svg.getAttribute("aria-labelledby") ?? "").split(" ").filter(Boolean);
    expect(labelledBy).toHaveLength(3);
    expect(labelledBy[2]).toBe("external-matrix-label");
  });

  test("renders the empty fallback instead of children", () => {
    render(() => (
      <MatrixFrame
        title="Empty matrix"
        desc="No rows to draw."
        width={360}
        height={96}
        testId="matrix-empty"
        empty={<text data-testid="empty-copy">No matrix data</text>}
      />
    ));

    const svg = screen.getByTestId("matrix-empty");
    expect(screen.getByTestId("matrix-empty-empty")).toHaveTextContent("No matrix data");
    expect(within(svg).getByText("No matrix data")).toBeInTheDocument();
    expect(svg.querySelector("title")).toHaveTextContent("Empty matrix");
    expect(svg.querySelector("desc")).toHaveTextContent("No rows to draw.");
    expect(screen.queryByTestId("matrix-empty-row-rail")).not.toBeInTheDocument();
  });

  test("pins the row rail over the SVG with full labels", () => {
    render(() => (
      <MatrixFrame
        title="Rail matrix"
        desc="Two sectors."
        width={320}
        height={160}
        testId="matrix-rail"
        rowRail={RAIL}
      >
        <rect data-cell="0-0" x={140} y={24} width={20} height={20} />
      </MatrixFrame>
    ));

    const rail = screen.getByTestId("matrix-rail-row-rail");
    expect(rail).toHaveAttribute("aria-hidden", "true");
    expect(rail.style.position).toBe("sticky");
    expect(rail.style.left).toBe("0px");
    expect(rail.style.width).toBe("140px");
    expect(rail.style.height).toBe("64px");
    expect(rail.style.marginTop).toBe("-160px");
    expect(rail.style.marginBottom).toBe("12px");
    expect(rail.style.zIndex).toBe("2");
    expect(rail.style.pointerEvents).toBe("none");
    expect(rail.textContent).toBe("NIFTY ITPSU BANK");
    expect(rail.querySelectorAll("div")).toHaveLength(2);
    expect(rail.querySelector('[title="Information technology"]')).toHaveTextContent("NIFTY IT");
    expect(rail.querySelector('[title="PSU BANK"]')).toHaveTextContent("PSU BANK");
    expect(rail.textContent).not.toContain("…");
  });
});

describe("labelWidthFor", () => {
  test("keeps short names at the minimum and long names at the maximum", () => {
    expect(labelWidthFor([])).toBe(140);
    expect(labelWidthFor(["IT"])).toBe(140);
    expect(labelWidthFor(["NIFTY FINANCIAL SERVICES AND INDUSTRIALS"])).toBe(210);
  });

  test("grows monotonically with the longest name and stays bounded", () => {
    const short = labelWidthFor(["NIFTY IT"]);
    const medium = labelWidthFor(["NIFTY FINANCIAL SERVICES"]);
    const long = labelWidthFor(["NIFTY FINANCIAL SERVICES AND INDUSTRIALS"]);

    expect(short).toBe(140);
    expect(medium).toBe(182);
    expect(long).toBe(210);
    expect(short).toBeLessThan(medium);
    expect(medium).toBeLessThan(long);
    expect(medium).toBeLessThanOrEqual(210);
    expect(medium).toBeGreaterThanOrEqual(140);
    expect(Number.isInteger(medium)).toBe(true);
    expect(labelWidthFor(["A", "NIFTY FINANCIAL SERVICES"])).toBe(medium);
  });

  test("honours custom bounds, character width and padding", () => {
    expect(labelWidthFor(["ABCDE"], 20, 100, 10, 0)).toBe(50);
    expect(labelWidthFor(["ABCDE"], 60, 100, 10, 0)).toBe(60);
    expect(labelWidthFor(["ABCDE"], 20, 40, 10, 0)).toBe(40);
    expect(labelWidthFor(["ABCDE"], 20, 100, 10, 6)).toBe(56);
  });
});
