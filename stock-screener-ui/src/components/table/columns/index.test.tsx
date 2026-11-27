// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { createSignal } from "solid-js";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import type { TableColumnDef } from "@/components/common/TanStackTable";
import { numColumn, symbolColumn, textColumn } from "./index";

afterEach(() => cleanup());

function renderCell<T>(column: TableColumnDef<T>, row: T): void {
  const cell = column.cell!;
  render(() =>
    cell({
      row: { original: row, index: 0, isExpanded: () => false, toggle: () => {} },
      column,
    }),
  );
}

describe("numColumn flash opt-in", () => {
  test("keeps the plain numeric cell flash-free by default", () => {
    const row = { ltp: 100 };
    const column = numColumn<typeof row>({
      id: "ltp",
      header: "LTP",
      cellTestId: () => "col-ltp",
    });
    renderCell(column, row);

    const el = screen.getByTestId("col-ltp");
    expect(el).toHaveTextContent("100");
    expect(el.className).not.toContain("value-flash-");
    expect(el.parentElement?.hasAttribute("data-flash-key")).toBe(false);
  });

  test("flashes up on a polling change and keeps the cell text and testid", () => {
    const [ltp, setLtp] = createSignal(100);
    const row = {
      symbol: "RELIANCE",
      get ltp() {
        return ltp();
      },
    };
    const column = numColumn<typeof row>({
      id: "ltp",
      header: "LTP",
      flash: true,
      flashKey: (r) => r.symbol,
      format: (v) => `₹${v.toFixed(2)}`,
      cellTestId: () => "col-ltp",
    });
    renderCell(column, row);

    expect(screen.getByTestId("col-ltp").parentElement).toHaveAttribute("data-flash-key", "0");

    setLtp(101);
    const cell = screen.getByTestId("col-ltp");
    expect(cell).toHaveTextContent("₹101.00");
    const flash = cell.parentElement!;
    expect(flash).toHaveClass("value-flash-up");
    expect(flash).toHaveAttribute("data-flash-key", "1");
    expect(flash).toHaveAttribute("data-flash-direction", "up");
  });

  test("a second change in the same direction bumps the key and restarts the animation", () => {
    const [ltp, setLtp] = createSignal(100);
    const row = {
      get ltp() {
        return ltp();
      },
    };
    const column = numColumn<typeof row>({
      id: "ltp",
      header: "LTP",
      flash: true,
      cellTestId: () => "col-ltp",
    });
    renderCell(column, row);

    setLtp(101);
    const first = screen.getByTestId("col-ltp").parentElement;
    expect(first).toHaveAttribute("data-flash-key", "1");

    setLtp(102);
    const second = screen.getByTestId("col-ltp").parentElement;
    expect(second).toHaveAttribute("data-flash-key", "2");
    expect(second).toHaveClass("value-flash-up");
    expect(second).not.toBe(first);
  });
});

describe("static column factories never flash", () => {
  test("symbolColumn and textColumn carry no flash attributes", () => {
    const row = { symbol: "RELIANCE", name: "Reliance Industries" };
    renderCell(symbolColumn<typeof row>({ id: "symbol", header: "SYMBOL", cellTestId: () => "col-symbol" }), row);
    renderCell(textColumn<typeof row>({ id: "name", header: "NAME", cellTestId: () => "col-name" }), row);

    for (const id of ["col-symbol", "col-name"]) {
      const el = screen.getByTestId(id);
      expect(el.className).not.toContain("value-flash-");
      expect(el.hasAttribute("data-flash-key")).toBe(false);
      expect(el.closest("[data-flash-key]")).toBeNull();
    }
  });

  test("symbolColumn renders a decorated feed symbol as a bare ticker", () => {
    const row = { symbol: "NSE:RELIANCE", name: "Reliance Industries" };
    renderCell(symbolColumn<typeof row>({ id: "symbol", header: "SYMBOL", cellTestId: () => "col-symbol" }), row);

    const el = screen.getByTestId("col-symbol");
    expect(el).toHaveTextContent("RELIANCE");
    expect(el).not.toHaveTextContent("NSE:");
  });
});

describe("symbolColumn copy affordance", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  type Row = { symbol: string; name?: string };

  function renderSymbolCell(
    row: Row,
    handlers: { onOpen?: (symbol: string) => void; onRowClick?: () => void; showCopy?: boolean } = {},
  ) {
    const column = symbolColumn<Row>({
      id: "symbol",
      header: "SYMBOL",
      cellTestId: () => "col-symbol",
      onOpen: handlers.onOpen,
      showCopy: handlers.showCopy,
    });
    render(() => (
      <UIProvider>
        <div onClick={handlers.onRowClick}>
          {column.cell!({
            row: { original: row, index: 0, isExpanded: () => false, toggle: () => {} },
            column,
          })}
        </div>
      </UIProvider>
    ));
  }

  test("renders a copy affordance that writes the displayed symbol without firing row click", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const onRowClick = vi.fn();
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    renderSymbolCell(
      { symbol: "NSE:RELIANCE", name: "Reliance Industries" },
      { onRowClick },
    );

    expect(screen.getByTestId("col-symbol")).toHaveTextContent("RELIANCE");
    const copy = screen.getByTestId("symbol-copy-RELIANCE");
    expect(copy).toHaveAccessibleName("Copy RELIANCE");
    await fireEvent.click(copy);
    expect(writeText).toHaveBeenCalledWith("RELIANCE");
    expect(onRowClick).not.toHaveBeenCalled();
  });

  test("row click still reaches the host when no onOpen handler is supplied", async () => {
    const onRowClick = vi.fn();
    renderSymbolCell({ symbol: "RELIANCE" }, { onRowClick });

    await fireEvent.click(screen.getByTestId("col-symbol"));
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });

  test("onOpen still opens the dock without also firing the row handler", async () => {
    const onOpen = vi.fn();
    const onRowClick = vi.fn();
    renderSymbolCell({ symbol: "RELIANCE" }, { onOpen, onRowClick });

    await fireEvent.click(screen.getByTestId("col-symbol"));
    expect(onOpen).toHaveBeenCalledWith("RELIANCE");
    expect(onRowClick).not.toHaveBeenCalled();
  });

  test("showCopy false opts out of the affordance", () => {
    renderSymbolCell({ symbol: "RELIANCE" }, { showCopy: false });
    expect(screen.queryByTestId("symbol-copy-RELIANCE")).toBeNull();
  });
});
