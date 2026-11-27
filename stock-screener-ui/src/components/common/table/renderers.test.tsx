// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi } from "vitest";
import { fireEvent, screen } from "@solidjs/testing-library";
import { renderWithProviders } from "@/test-utils/renderWithProviders";
import { NumCell } from "../tableCells";
import { renderGroupRow, renderHeader, renderRow, renderSubRow, type TableRenderContext } from "./renderers";
import type { GroupSlot, RowSlot, TableColumnDef, TableProps } from "./types";

interface Row {
  v: number | null;
  label: string;
}

function makeCtx(overrides: Partial<TableRenderContext<Row>> = {}): TableRenderContext<Row> {
  const tableProps: TableProps<Row> = { data: [], columns: [] };
  return {
    props: tableProps,
    visibleColumns: () => [],
    colCount: () => 1,
    isNumeric: () => false,
    columnView: () => ({ cellClass: "", cellStyle: {} }),
    rowStyleBase: () => ({}),
    getValue: (row, col) => (row as unknown as Record<string, unknown>)[col.id],
    sorting: () => [],
    enableSorting: () => true,
    toggleSort: vi.fn(),
    isRowExpanded: () => false,
    toggleRow: vi.fn(),
    isGroupExpanded: () => false,
    toggleGroup: vi.fn(),
    ...overrides,
  };
}

function rowSlot(row: Row, index: number, key = `row-${index}`): RowSlot<Row> {
  return { kind: "row", key, frame: () => ({ row, index }), set: vi.fn() };
}

const col = (overrides: Partial<TableColumnDef<Row>> = {}): TableColumnDef<Row> => ({
  id: "v",
  header: "Value",
  ...overrides,
});

describe("renderHeader", () => {
  test("exposes sort state to assistive tech and toggles on click and keyboard", () => {
    const toggleSort = vi.fn();
    const ctx = makeCtx({ toggleSort });
    renderWithProviders(() => <table><thead><tr>{renderHeader(col(), ctx)}</tr></thead></table>);

    const header = screen.getByRole("columnheader", { name: /Value/ });
    expect(header).toHaveAttribute("id", "paper-tanstack-header-v");
    expect(header).toHaveAttribute("aria-sort", "none");
    expect(header).toHaveAttribute("tabindex", "0");

    fireEvent.click(header);
    fireEvent.keyDown(header, { key: "Enter" });
    fireEvent.keyDown(header, { key: " " });
    expect(toggleSort).toHaveBeenCalledTimes(3);
    expect(toggleSort).toHaveBeenCalledWith("v");
  });

  test("reports direction and blocks sorting when the column opts out", () => {
    const sorted = makeCtx({ sorting: () => [{ id: "v", desc: true }] });
    const first = renderWithProviders(() =>
      <table><thead><tr>{renderHeader(col(), sorted)}</tr></thead></table>,
    );
    expect(screen.getByRole("columnheader")).toHaveAttribute("aria-sort", "descending");
    expect(screen.getByRole("columnheader")).toHaveTextContent("▼");
    first.unmount();

    const ctx = makeCtx();
    renderWithProviders(() =>
      <table><thead><tr>{renderHeader(col({ enableSorting: false }), ctx)}</tr></thead></table>,
    );
    const header = screen.getByRole("columnheader");
    expect(header).not.toHaveAttribute("aria-sort");
    expect(header).not.toHaveAttribute("tabindex");
    fireEvent.click(header);
    expect(ctx.toggleSort).not.toHaveBeenCalled();
  });

  test("aligns by column meta over numeric inference and pins a sticky header", () => {
    const ctx = makeCtx({ isNumeric: () => true, props: { data: [], columns: [], stickyHeader: true } });
    renderWithProviders(() =>
      <table><thead><tr>
        {renderHeader(col({ meta: { align: "center" } }), ctx)}
        {renderHeader(col({ id: "v2", meta: undefined }), ctx)}
      </tr></thead></table>,
    );

    const [centred, numeric] = screen.getAllByRole("columnheader");
    expect(centred.style.textAlign).toBe("center");
    expect(numeric.style.textAlign).toBe("right");
    expect(numeric.style.position).toBe("sticky");
    expect(numeric.style.top).toBe("0px");
  });
});

describe("renderRow", () => {
  test("delegates cell values to real renderers for missing, zero and negative numbers", () => {
    const ctx = makeCtx({
      visibleColumns: () => [col({
        cell: ({ row }) => (
          <NumCell value={row.original.v} signed testId={`cell-${row.index}`} />
        ),
      })],
    });
    const rows = [
      rowSlot({ v: null, label: "missing" }, 0),
      rowSlot({ v: 0, label: "flat" }, 1),
      rowSlot({ v: -12.5, label: "loss" }, 2),
    ];

    renderWithProviders(() => <table><tbody>{rows.map((slot) => renderRow(slot, ctx))}</tbody></table>);

    const missing = screen.getByTestId("cell-0");
    const zero = screen.getByTestId("cell-1");
    const negative = screen.getByTestId("cell-2");
    expect(missing).toHaveTextContent("—");
    expect(zero).toHaveTextContent("0");
    expect(negative).toHaveTextContent("-12.5");
    expect(negative.className).toContain("text-fin-negative");
    expect(negative.className).toContain("font-mono");
    expect(missing.className).not.toContain("text-fin-negative");
  });

  test("stringifies getValue when a column has no cell renderer", () => {
    const ctx = makeCtx({ visibleColumns: () => [col()] });
    renderWithProviders(() =>
      <table><tbody>
        {renderRow(rowSlot({ v: 0, label: "A" }, 0), ctx)}
        {renderRow(rowSlot({ v: -3, label: "B" }, 1), ctx)}
        {renderRow(rowSlot({ v: null, label: "C" }, 2), ctx)}
      </tbody></table>,
    );

    const cells = screen.getAllByRole("cell");
    expect(cells.map((c) => c.textContent)).toEqual(["0", "-3", "null"]);
    expect(cells[0]).toHaveAttribute("id", "paper-tanstack-cell-v-row-0");
  });

  test("wires row clicks, keyboard activation, testids and caller attributes", () => {
    const onRowClick = vi.fn();
    const ctx = makeCtx({
      props: {
        data: [],
        columns: [],
        onRowClick,
        getRowTestId: (row) => `stock-row-${row.label}`,
        getRowClassName: () => "highlight",
        getRowAttributes: () => ({ "data-strategy": "orb" }),
      },
    });
    renderWithProviders(() =>
      <table><tbody>{renderRow(rowSlot({ v: 1, label: "SBIN" }, 4), ctx)}</tbody></table>,
    );

    const row = screen.getByTestId("stock-row-SBIN");
    expect(row).toHaveAttribute("data-row", "stock");
    expect(row).toHaveAttribute("data-clickable", "true");
    expect(row).toHaveAttribute("data-strategy", "orb");
    expect(row).toHaveClass("highlight");
    expect(row).toHaveAttribute("tabindex", "0");

    fireEvent.click(row);
    fireEvent.keyDown(row, { key: "Enter" });
    fireEvent.keyDown(row, { key: " " });
    expect(onRowClick).toHaveBeenCalledTimes(3);
    expect(onRowClick).toHaveBeenCalledWith({ v: 1, label: "SBIN" });
  });

  test("does not hijack Enter/Space on a nested copy button", () => {
    const onRowClick = vi.fn();
    const ctx = makeCtx({
      props: { data: [], columns: [], onRowClick, getRowTestId: () => "stock-row" },
      visibleColumns: () => [
        col({ id: "action", header: "", cell: () => <button data-testid="copy">Copy</button> }),
      ],
    });
    renderWithProviders(() =>
      <table><tbody>{renderRow(rowSlot({ v: 1, label: "SBIN" }, 0), ctx)}</tbody></table>,
    );

    const copy = screen.getByTestId("copy");
    fireEvent.click(copy);
    fireEvent.keyDown(copy, { key: "Enter" });
    fireEvent.keyDown(copy, { key: " " });
    expect(onRowClick).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("stock-row"));
    fireEvent.keyDown(screen.getByTestId("stock-row"), { key: "Enter" });
    expect(onRowClick).toHaveBeenCalledTimes(2);
  });

  test("mounts the expanded sub-row only for an expanded expandable row", () => {
    const ctx = makeCtx({
      props: {
        data: [],
        columns: [],
        getRowCanExpand: (row) => row.label === "SBIN",
        renderSubComponent: (row) => <span data-testid="sub">{row.label} detail</span>,
      },
      isRowExpanded: () => true,
    });
    const expandable = renderWithProviders(() =>
      <table><tbody>{renderRow(rowSlot({ v: 1, label: "SBIN" }, 0), ctx)}</tbody></table>,
    );
    const sub = screen.getByTestId("sub");
    expect(sub).toHaveTextContent("SBIN detail");
    expect(sub.closest("tr")).toHaveClass("paper-tanstack-expanded-row");
    expect(sub.closest("td")).toHaveAttribute("colspan", "1");
    expandable.unmount();

    renderWithProviders(() =>
      <table><tbody>{renderRow(rowSlot({ v: 1, label: "TCS" }, 0), ctx)}</tbody></table>,
    );
    expect(screen.queryByTestId("sub")).not.toBeInTheDocument();
  });
});

describe("renderSubRow / renderGroupRow", () => {
  test("renders nothing for the sub-row when no expander is configured", () => {
    const ctx = makeCtx();
    renderWithProviders(() =>
      <table><tbody>{renderSubRow(() => ({ v: 1, label: "SBIN" }), () => 0, ctx)}</tbody></table>,
    );
    expect(document.querySelector(".paper-tanstack-expanded-row")).toBeNull();
  });

  test("group rows expose expanded state and toggle by click and keyboard", () => {
    const toggleGroup = vi.fn();
    const ctx = makeCtx({
      toggleGroup,
      isGroupExpanded: () => false,
      props: {
        data: [],
        columns: [],
        getGroupRowTestId: (value) => `group-${String(value)}`,
        renderGroupHeader: ({ value, rows, isExpanded }) => (
          <span data-testid="group-header">
            {String(value)} ({rows.length}) expanded={String(isExpanded())}
          </span>
        ),
      },
    });
    const slot: GroupSlot<Row> = {
      kind: "group",
      key: "group-NSE",
      frame: () => ({
        value: "NSE",
        rows: [{ v: 1, label: "SBIN" }, { v: 2, label: "TCS" }],
        baseIndex: 0,
      }),
      set: vi.fn(),
    };

    renderWithProviders(() => <table><tbody>{renderGroupRow(slot, ctx)}</tbody></table>);

    const row = screen.getByTestId("group-NSE");
    expect(row).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("group-header")).toHaveTextContent("NSE (2) expanded=false");

    fireEvent.click(row);
    fireEvent.keyDown(row, { key: "Enter" });
    fireEvent.keyDown(row, { key: " " });
    expect(toggleGroup).toHaveBeenCalledTimes(3);
    expect(toggleGroup).toHaveBeenCalledWith("NSE");
  });
});
