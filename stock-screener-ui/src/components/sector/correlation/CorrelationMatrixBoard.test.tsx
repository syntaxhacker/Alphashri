// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen, within } from "@solidjs/testing-library";
import { CHART_TOP3 } from "@/ui/palette";
import {
  buildMatrixModel,
  CorrelationMatrixBoard,
  shortSectorLabel,
} from "./CorrelationMatrixBoard";

const NAMES = [
  "NIFTY 50",
  "NIFTY BANK",
  "NIFTY IT",
  "NIFTY FIN_SERVICE",
  "NIFTY CONSUMPTION",
];

const MATRIX = [
  [1, 0.8, 0.5, 0.2, -0.1],
  [0.8, 1, 0.6, 0.3, -0.2],
  [0.5, 0.6, 1, 0.4, 0.1],
  [0.2, 0.3, 0.4, 1, 0.7],
  [-0.1, -0.2, 0.1, 0.7, 1],
];

afterEach(() => cleanup());

describe("shortSectorLabel", () => {
  test("strips a shared NIFTY prefix and caps headers without rotating them", () => {
    expect(NAMES.map((name) => shortSectorLabel(name, NAMES))).toEqual([
      "50",
      "BANK",
      "IT",
      "FIN_S…",
      "CONSU…",
    ]);
    expect(shortSectorLabel("NIFTY IT", ["NIFTY IT", "SPY"])).toBe("NIFTY…");
    expect(shortSectorLabel("XLK", ["SPY", "XLK"])).toBe("XLK");
  });

  test("keeps missing cells distinguishably empty", () => {
    const model = buildMatrixModel([[1], []], ["NIFTY 50", "SPY"]);
    expect(model.cells[0]?.[0]).toMatchObject({ value: 1, diagonal: true });
    expect(model.cells[1]?.[1]?.value).toBeNull();
    expect(model.labels).toEqual(["NIFTY…", "SPY"]);
  });
});

describe("CorrelationMatrixBoard", () => {
  test("renders horizontal column headers with full names in title and aria-label", () => {
    render(() => <CorrelationMatrixBoard matrix={MATRIX} symbols={NAMES} isDark={false} />);

    const board = screen.getByTestId("correlation-matrix-board");
    for (const [index, full] of NAMES.entries()) {
      const header = screen.getByTestId(`correlation-matrix-header-${index}`);
      expect(header).toHaveAttribute("title", full);
      expect(header).toHaveAttribute("aria-label", full);
      expect(header.className).not.toContain("rotate");
      expect(within(header).getByText(shortSectorLabel(full, NAMES))).toBeInTheDocument();
    }
    expect(board.className).not.toContain("rotate");
  });

  test("is a CSS grid, not a table or an ECharts canvas", () => {
    render(() => <CorrelationMatrixBoard matrix={MATRIX} symbols={NAMES} isDark={false} />);

    const board = screen.getByTestId("correlation-matrix-board");
    expect(board.querySelector("table")).toBeNull();
    expect(board.querySelector("canvas")).toBeNull();
    expect(screen.getByTestId("correlation-matrix-grid")).toHaveClass("grid");
    expect(screen.getByTestId("correlation-matrix-grid").style.gridTemplateColumns).toContain(
      "repeat(5, minmax(40px, 1fr))",
    );
  });

  test("emphasizes the diagonal so the 1.0 self-correlation reads immediately", () => {
    render(() => <CorrelationMatrixBoard matrix={MATRIX} symbols={NAMES} isDark={false} />);

    const diagonal = document.querySelectorAll('[data-diagonal="true"]');
    expect(diagonal).toHaveLength(NAMES.length);
    for (const cell of diagonal) {
      expect(cell).toHaveTextContent("1.0");
      expect(cell.getAttribute("style")?.toLowerCase()).toContain(CHART_TOP3.toLowerCase());
    }
    expect(screen.getByTestId("correlation-matrix-cell-0-1")).toHaveTextContent("80");
    expect(screen.getByTestId("correlation-matrix-cell-0-1")).toHaveAttribute("data-diagonal", "false");
    expect(screen.getByTestId("correlation-matrix-diagonal-key")).toHaveTextContent("diagonal = 1.0");
  });

  test("accessible names contain the exact visible cell text", () => {
    render(() => (
      <CorrelationMatrixBoard
        matrix={[[1, null], [0.8, 1]]}
        symbols={["IT", "BANK"]}
        isDark={false}
      />
    ));

    const diagonal = screen.getByTestId("correlation-matrix-cell-0-0");
    expect(diagonal).toHaveTextContent("1.0");
    expect(diagonal).toHaveAttribute("aria-label", "IT × IT: 1.0 self");
    expect(diagonal).toHaveAttribute("title", "IT × IT: 1.0 self");

    const missing = screen.getByTestId("correlation-matrix-cell-0-1");
    expect(missing).toHaveTextContent("—");
    expect(missing).toHaveAttribute("aria-label", "IT × BANK: — no data");
    expect(missing).toHaveAttribute("title", "IT × BANK: — no data");

    const numeric = screen.getByTestId("correlation-matrix-cell-1-0");
    expect(numeric).toHaveTextContent("80");
    expect(numeric).toHaveAttribute("aria-label", "BANK × IT: 80%");
  });

  test("carries full names on row labels and cells for assistive tech", () => {
    render(() => <CorrelationMatrixBoard matrix={MATRIX} symbols={NAMES} isDark={false} />);

    expect(screen.getByTestId("correlation-matrix-row-3")).toHaveAttribute("title", NAMES[3]);
    expect(screen.getByTestId("correlation-matrix-row-3")).toHaveAttribute("aria-label", NAMES[3]);
    const cell = screen.getByTestId("correlation-matrix-cell-1-0");
    expect(cell).toHaveAttribute("title", "NIFTY BANK × NIFTY 50: 80%");
    expect(cell).toHaveAttribute("aria-label", "NIFTY BANK × NIFTY 50: 80%");
  });

  test("fits a 390 layout with internal scrolling instead of page-level width", () => {
    render(() => <CorrelationMatrixBoard matrix={MATRIX} symbols={NAMES} isDark={false} />);

    const scroll = screen.getByTestId("correlation-matrix-scroll");
    expect(scroll).toHaveClass("overflow-auto");
    expect(scroll).toHaveClass("min-w-0");
    expect(scroll).toHaveAttribute("role", "region");
    expect(scroll).toHaveAttribute("tabindex", "0");
    expect(screen.getByTestId("correlation-matrix-grid")).toHaveClass("w-max");
    expect(screen.getByTestId("correlation-matrix-grid")).toHaveClass("min-w-full");
    expect(screen.getByTestId("correlation-matrix-row-0")).toHaveClass("sticky");
    expect(screen.getByTestId("correlation-matrix-row-0")).toHaveClass("left-0");
    expect(screen.getByTestId("correlation-matrix-corner")).toHaveClass("sticky");
  });
});
