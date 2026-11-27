// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
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
      "N50",
      "BANK",
      "IT",
      "FIN SVC",
      "CONS.",
    ]);
    expect(shortSectorLabel("NIFTY IT", ["NIFTY IT", "SPY"])).toBe("NIFTY …");
    expect(shortSectorLabel("XLK", ["SPY", "XLK"])).toBe("XLK");
  });

  test("keeps missing cells distinguishably empty", () => {
    const model = buildMatrixModel([[1], []], ["NIFTY 50", "SPY"]);
    expect(model.cells[0]?.[0]).toMatchObject({ value: 1, diagonal: true });
    expect(model.cells[1]?.[1]?.value).toBeNull();
    expect(model.labels).toEqual(["N50", "SPY"]);
    expect(model.rowLabels).toEqual(["N50", "SPY"]);
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
    const baseHeader = screen.getByTestId("correlation-matrix-header-0");
    expect(baseHeader).toHaveTextContent("N50");
    expect(baseHeader).not.toHaveTextContent(/^50$/);
  });

  test("is a CSS grid, not a table or an ECharts canvas", () => {
    render(() => <CorrelationMatrixBoard matrix={MATRIX} symbols={NAMES} isDark={false} />);

    const board = screen.getByTestId("correlation-matrix-board");
    expect(board.querySelector("table")).toBeNull();
    expect(board.querySelector("canvas")).toBeNull();
    expect(screen.getByTestId("correlation-matrix-grid")).toHaveClass("grid");
    expect(screen.getByTestId("correlation-matrix-grid").style.gridTemplateColumns).toContain(
      "repeat(5, minmax(48px, 1fr))",
    );
  });

  test("emphasizes the diagonal so the 1.0 self-correlation reads immediately", () => {
    render(() => <CorrelationMatrixBoard matrix={MATRIX} symbols={NAMES} isDark={false} />);

    const diagonal = document.querySelectorAll('[data-diagonal="true"]');
    expect(diagonal).toHaveLength(NAMES.length);
    for (const cell of diagonal) {
      expect(cell).toHaveTextContent("100");
      expect(cell.getAttribute("style")?.toLowerCase()).toContain(CHART_TOP3.toLowerCase());
    }
    expect(screen.getByTestId("correlation-matrix-cell-0-1")).toHaveTextContent("80");
    expect(screen.getByTestId("correlation-matrix-cell-0-1")).toHaveAttribute("data-diagonal", "false");
    expect(screen.getByTestId("correlation-matrix-diagonal-key")).toHaveTextContent("diagonal = 100%");
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
    expect(diagonal).toHaveTextContent("100");
    expect(diagonal).toHaveAttribute("aria-label", "IT × IT: 100% self");
    expect(diagonal).toHaveAttribute("title", "IT × IT: 100% self");

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
    expect(scroll.className).not.toContain("flex-1");
    expect(scroll).toHaveAttribute("role", "region");
    expect(scroll).toHaveAttribute("tabindex", "0");
    expect(screen.getByTestId("correlation-matrix-grid")).toHaveClass("w-full");
    expect(screen.getByTestId("correlation-matrix-grid")).not.toHaveClass("w-max");
    expect(screen.getByTestId("correlation-matrix-grid").style.gridTemplateColumns).toContain(
      "104px",
    );
    // The grid keeps a phone-sized minimum so the scroll owner still works,
    // while 900/1100 stretch the flexible tracks to fit all ten columns.
    expect(screen.getByTestId("correlation-matrix-grid").style.minWidth).toBe("349px");
    const row = screen.getByTestId("correlation-matrix-row-0");
    expect(row).toHaveClass("sticky");
    expect(row).toHaveClass("left-0");
    expect(row).toHaveClass("text-ellipsis");
    expect(row).toHaveTextContent("N50");
    expect(row).toHaveAttribute("title", NAMES[0]);
    expect(row).toHaveAttribute("aria-label", NAMES[0]);
    expect(screen.getByTestId("correlation-matrix-corner")).toHaveClass("sticky");
  });

  test("shows exactly one scroll cue when the matrix overflows", () => {
    render(() => <CorrelationMatrixBoard matrix={MATRIX} symbols={NAMES} isDark={false} />);

    const hints = screen.getAllByTestId("correlation-matrix-scroll-hint");
    expect(hints).toHaveLength(1);
    const hint = hints[0];
    expect(hint).toHaveAttribute("aria-hidden", "true");
    expect(hint.className).toContain("hidden");

    const scroll = screen.getByTestId("correlation-matrix-scroll");
    Object.defineProperty(scroll, "clientWidth", { configurable: true, value: 200 });
    Object.defineProperty(scroll, "scrollWidth", { configurable: true, value: 500 });
    fireEvent.scroll(scroll);
    expect(hint).toHaveClass("flex");
    expect(hint).toHaveTextContent("Scroll →");

    Object.defineProperty(scroll, "scrollLeft", { configurable: true, value: 300 });
    fireEvent.scroll(scroll);
    expect(hint).toHaveTextContent("Scroll ←");
  });

  test("a 10-column matrix fits the 900/1100 panel without an inner scroll", () => {
    const TEN = [
      "NIFTY 50",
      "NIFTY BANK",
      "NIFTY IT",
      "NIFTY FMCG",
      "NIFTY PHARMA",
      "NIFTY AUTO",
      "NIFTY ENERGY",
      "NIFTY REALTY",
      "NIFTY METAL",
      "NIFTY CONSUMPTION",
    ];
    render(() => (
      <CorrelationMatrixBoard
        matrix={TEN.map(() => TEN.map(() => 0.5))}
        symbols={TEN}
        isDark={false}
      />
    ));
    const grid = screen.getByTestId("correlation-matrix-grid");
    expect(grid.style.gridTemplateColumns).toBe(
      "104px repeat(10, minmax(48px, 1fr))",
    );
    // 900px viewport minus the section/page rails leaves ~748px for the panel;
    // 1100 leaves ~934px. The 594px minimum then never forces a scroll there.
    expect(grid.style.minWidth).toBe("594px");
    expect(594).toBeLessThanOrEqual(748);
    expect(594).toBeLessThanOrEqual(934);
    expect(screen.getByTestId("correlation-matrix-header-9")).toHaveTextContent("CONS.");
  });

  test("seven columns stay readable and reachable through the 390 scroll viewport", () => {
    const SEVEN = [
      "NIFTY 50",
      "NIFTY BANK",
      "NIFTY IT",
      "NIFTY FMCG",
      "NIFTY PHARMA",
      "NIFTY AUTO",
      "NIFTY METAL",
    ];
    render(() => (
      <CorrelationMatrixBoard
        matrix={SEVEN.map(() => SEVEN.map(() => 0.5))}
        symbols={SEVEN}
        isDark={false}
      />
    ));

    const grid = screen.getByTestId("correlation-matrix-grid");
    expect(grid.style.gridTemplateColumns).toContain("repeat(7, minmax(48px, 1fr))");
    // 104px sticky rail + 7 x 48px cells no longer fit a ~374px phone body;
    // the matrix is allowed to scroll (with a cue) rather than overprint.
    expect(104 + 7 * 48 + 7).toBeGreaterThan(374);
    expect(grid.style.minWidth).toBe("447px");
    const scroll = screen.getByTestId("correlation-matrix-scroll");
    const headers = screen.getAllByTestId(/^correlation-matrix-header-/);
    expect(headers).toHaveLength(SEVEN.length);
    for (const header of headers) expect(scroll).toContainElement(header);
  });
});
