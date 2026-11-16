// @vitest-environment happy-dom
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import {
  TanStackTable,
  resolveColumnPrefs,
  type ColumnPrefs,
  type TableColumnDef,
} from "./TanStackTable";

afterEach(() => {
  cleanup();
});

interface Row {
  symbol: string;
  name: string;
  price: number;
  change: number;
  volume: number;
}

const rows: Row[] = [
  { symbol: "AAA", name: "Alpha", price: 100, change: 1.5, volume: 1000 },
  { symbol: "BBB", name: "Beta", price: 200, change: -0.5, volume: 2000 },
];

/** Declared defaults — deliberately NOT alphabetical, so order is observable. */
const columns: TableColumnDef<Row>[] = [
  { id: "symbol", header: "Symbol", accessorKey: "symbol" },
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "price", header: "Price", accessorKey: "price", meta: { align: "right" } },
  { id: "change", header: "Change", accessorKey: "change", meta: { align: "right" } },
  { id: "volume", header: "Volume", accessorKey: "volume", meta: { align: "right" } },
];

const headerIds = () =>
  screen.getAllByRole("columnheader").map((th) => th.id.replace("paper-tanstack-header-", ""));

const openPicker = () => fireEvent.click(screen.getByTestId("table-column-picker-trigger"));

const pickerToggle = (id: string) =>
  screen.getByTestId(`table-column-picker-toggle-${id}`) as HTMLInputElement;

const pickerRowOrder = () =>
  Array.from(document.querySelectorAll<HTMLLIElement>('[data-testid^="table-column-picker-row-"]')).map(
    (li) => li.dataset.testid!.replace("table-column-picker-row-", ""),
  );

/** Controlled harness: the parent owns the prefs, exactly as the store will. */
function ControlledTable(props: {
  initial?: ColumnPrefs;
  lockVisible?: string[];
  onChange?: (prefs: ColumnPrefs) => void;
}) {
  const [prefs, setPrefs] = createSignal<ColumnPrefs>(props.initial ?? { order: [], hidden: [] });
  return (
    <TanStackTable<Row>
      data={rows}
      columns={columns}
      enableColumnControls
      tableId="table.test"
      columnPrefs={prefs()}
      lockVisible={props.lockVisible}
      onColumnPrefsChange={(next) => {
        setPrefs(next);
        props.onChange?.(next);
      }}
      getRowTestId={(row) => `row-${row.symbol}`}
    />
  );
}

describe("resolveColumnPrefs — merge rules", () => {
  it("declared order is kept when no prefs are supplied", () => {
    const resolved = resolveColumnPrefs(["a", "b", "c"], undefined);
    expect(resolved).toEqual({ order: ["a", "b", "c"], hidden: [], visible: ["a", "b", "c"] });
  });

  it("saved order wins for known ids", () => {
    const resolved = resolveColumnPrefs(["a", "b", "c"], { order: ["c", "a"], hidden: [] });
    expect(resolved.order).toEqual(["c", "a", "b"]);
    expect(resolved.visible).toEqual(["c", "a", "b"]);
  });

  it("columns added after the config was saved append in declared order", () => {
    // "d" did not exist when the user saved; it must appear, never be dropped.
    const resolved = resolveColumnPrefs(["a", "b", "c", "d"], { order: ["c", "b"], hidden: [] });
    expect(resolved.order).toEqual(["c", "b", "a", "d"]);
  });

  it("drops unknown ids from order and hidden", () => {
    const resolved = resolveColumnPrefs(["a", "b"], { order: ["gone", "b"], hidden: ["gone", "a"] });
    expect(resolved.order).toEqual(["b", "a"]);
    expect(resolved.hidden).toEqual(["a"]);
    expect(resolved.visible).toEqual(["b"]);
  });

  it("ignores duplicate ids in a corrupted saved order", () => {
    const resolved = resolveColumnPrefs(["a", "b"], { order: ["b", "b", "a"], hidden: [] });
    expect(resolved.order).toEqual(["b", "a"]);
  });

  it("a locked column is never hidden even when the saved config hides it", () => {
    const resolved = resolveColumnPrefs(["symbol", "price"], { order: [], hidden: ["symbol", "price"] }, ["symbol"]);
    expect(resolved.hidden).toEqual(["price"]);
    expect(resolved.visible).toEqual(["symbol"]);
  });

  it("keeps the locked column visible when every hideable column is hidden", () => {
    // The reachability guard: hiding all 4 still leaves symbol on screen.
    const all = ["symbol", "name", "price", "change"];
    const resolved = resolveColumnPrefs(all, { order: [], hidden: ["name", "price", "change"] }, ["symbol"]);
    expect(resolved.visible).toEqual(["symbol"]);
  });

  it("forces one column visible when everything is hidden and nothing is locked", () => {
    const resolved = resolveColumnPrefs(["a", "b"], { order: [], hidden: ["a", "b"] });
    expect(resolved.visible).toEqual(["a"]);
    expect(resolved.hidden).toEqual(["b"]);
  });

  it("survives an empty column list", () => {
    expect(resolveColumnPrefs([], { order: ["a"], hidden: ["a"] }, ["a"])).toEqual({
      order: [],
      hidden: [],
      visible: [],
    });
  });
});

describe("TanStackTable column controls — off by default", () => {
  it("renders no picker and no toolbar when the prop is absent", () => {
    render(() => <TanStackTable<Row> data={rows} columns={columns} />);
    expect(screen.queryByTestId("table-column-picker-trigger")).toBeNull();
    expect(screen.queryByTestId("table-column-controls")).toBeNull();
  });

  it("renders no picker when columnPrefs is passed without the opt-in flag", () => {
    render(() => (
      <TanStackTable<Row>
        data={rows}
        columns={columns}
        tableId="table.test"
        columnPrefs={{ order: ["price"], hidden: ["name"] }}
      />
    ));
    expect(screen.queryByTestId("table-column-picker-trigger")).toBeNull();
    // ...and the prefs are inert: the declared default layout renders.
    expect(headerIds()).toEqual(["symbol", "name", "price", "change", "volume"]);
  });

  it("renders every declared column in declared order with no prefs", () => {
    render(() => <ControlledTable />);
    expect(headerIds()).toEqual(["symbol", "name", "price", "change", "volume"]);
  });

  it("exposes tableId for a future store/E2E scope", () => {
    render(() => <ControlledTable />);
    expect(screen.getByTestId("table-column-picker-trigger").parentElement).toHaveAttribute(
      "data-table-id",
      "table.test",
    );
  });
});

describe("TanStackTable column controls — visibility", () => {
  it("unchecking a column removes its header and cells, and emits the hidden id", () => {
    const onChange = vi.fn();
    render(() => <ControlledTable onChange={onChange} />);
    openPicker();
    fireEvent.click(pickerToggle("change"));

    expect(headerIds()).toEqual(["symbol", "name", "price", "volume"]);
    // `order: []` — hiding a column is not an opinion about order, so a future
    // default reorder must still be able to take effect.
    expect(onChange).toHaveBeenLastCalledWith({ order: [], hidden: ["change"] });
    // Cells follow the header: 4 cells per row now, and no -0.5 value anywhere.
    const firstRow = screen.getByTestId("row-AAA");
    expect(firstRow.querySelectorAll("td")).toHaveLength(4);
    expect(screen.queryByText("-0.5")).toBeNull();
  });

  it("pins an explicit order only once the user actually reorders", () => {
    const onChange = vi.fn();
    render(() => <ControlledTable onChange={onChange} />);
    openPicker();
    fireEvent.keyDown(screen.getByTestId("table-column-picker-handle-price"), { key: "ArrowUp" });

    const last = onChange.mock.lastCall?.[0] as ColumnPrefs;
    expect(last.order).toEqual(["symbol", "price", "name", "change", "volume"]);
  });

  it("returns to order: [] when the user drags the columns back to the default", () => {
    const onChange = vi.fn();
    render(() => <ControlledTable onChange={onChange} />);
    openPicker();
    fireEvent.keyDown(screen.getByTestId("table-column-picker-handle-price"), { key: "ArrowUp" });
    fireEvent.keyDown(screen.getByTestId("table-column-picker-handle-price"), { key: "ArrowDown" });

    expect(onChange.mock.lastCall?.[0]).toEqual({ order: [], hidden: [] });
    expect(headerIds()).toEqual(["symbol", "name", "price", "change", "volume"]);
  });

  it("re-checking a hidden column restores it at its saved position", () => {
    render(() => <ControlledTable initial={{ order: [], hidden: ["change"] }} />);
    expect(headerIds()).toEqual(["symbol", "name", "price", "volume"]);

    openPicker();
    fireEvent.click(pickerToggle("change"));
    expect(headerIds()).toEqual(["symbol", "name", "price", "change", "volume"]);
  });

  it("applies a hydrated saved config on first render", () => {
    render(() => (
      <ControlledTable initial={{ order: ["symbol", "volume", "change"], hidden: ["name"] }} />
    ));
    expect(headerIds()).toEqual(["symbol", "volume", "change", "price"]);
  });

  it("a column added after the saved config renders even though the config predates it", () => {
    // Simulates a deploy that added "volume": saved order has 4 ids, live has 5.
    const liveColumns: TableColumnDef<Row>[] = [
      ...columns,
      { id: "extra", header: "Extra", accessorKey: "volume" },
    ];
    render(() => (
      <TanStackTable<Row>
        data={rows}
        columns={liveColumns}
        enableColumnControls
        columnPrefs={{ order: ["symbol", "price"], hidden: ["name"] }}
        onColumnPrefsChange={() => {}}
      />
    ));
    // Saved order first, new columns appended in declared order.
    expect(headerIds()).toEqual(["symbol", "price", "change", "volume", "extra"]);
  });
});

describe("TanStackTable column controls — order", () => {
  it("moves a column with the keyboard handle and renders the new order", () => {
    const onChange = vi.fn();
    render(() => <ControlledTable onChange={onChange} />);
    openPicker();

    // "price" is index 2; ArrowUp moves it to index 1.
    fireEvent.keyDown(screen.getByTestId("table-column-picker-handle-price"), { key: "ArrowUp" });

    expect(headerIds()).toEqual(["symbol", "price", "name", "change", "volume"]);
    expect(onChange).toHaveBeenLastCalledWith({
      order: ["symbol", "price", "name", "change", "volume"],
      hidden: [],
    });
    expect(pickerRowOrder()).toEqual(["symbol", "price", "name", "change", "volume"]);
  });

  it("moves a column down and clamps at the last position", () => {
    render(() => <ControlledTable />);
    openPicker();
    const handle = () => screen.getByTestId("table-column-picker-handle-volume");

    fireEvent.keyDown(handle(), { key: "ArrowDown" }); // already last — no-op
    expect(headerIds()).toEqual(["symbol", "name", "price", "change", "volume"]);

    // Now the first row cannot move up either.
    fireEvent.keyDown(screen.getByTestId("table-column-picker-handle-symbol"), { key: "ArrowUp" });
    expect(headerIds()).toEqual(["symbol", "name", "price", "change", "volume"]);
  });

  it("reorders by drag and drop", () => {
    render(() => <ControlledTable />);
    openPicker();

    const handle = screen.getByTestId("table-column-picker-handle-symbol");
    const targetRow = screen.getByTestId("table-column-picker-row-price");
    fireEvent.dragStart(handle);
    fireEvent.dragOver(targetRow);
    fireEvent.drop(targetRow);

    expect(headerIds()).toEqual(["name", "price", "symbol", "change", "volume"]);
  });

  it("order is display-order only — header sorting still works", () => {
    render(() => <ControlledTable initial={{ order: ["symbol", "name", "price", "change", "volume"], hidden: [] }} />);
    const priceTh = screen.getByText("Price").closest("th")!;
    fireEvent.click(priceTh);
    // Descending: 200 (BBB) before 100 (AAA).
    const bodyRows = Array.from(document.querySelectorAll<HTMLTableRowElement>("tbody tr"));
    expect(bodyRows[0].textContent).toContain("Beta");
    expect(bodyRows[1].textContent).toContain("Alpha");
    expect(priceTh.textContent).toContain("▼");
    // Column order unchanged by the sort.
    expect(headerIds()).toEqual(["symbol", "name", "price", "change", "volume"]);
  });

  it("a hidden column still sorts via its saved order when re-shown", () => {
    render(() => <ControlledTable initial={{ order: ["price", "symbol", "name", "change", "volume"], hidden: ["price"] }} />);
    expect(headerIds()).toEqual(["symbol", "name", "change", "volume"]);
    openPicker();
    fireEvent.click(pickerToggle("price"));
    expect(headerIds()).toEqual(["price", "symbol", "name", "change", "volume"]);
  });
});

describe("TanStackTable column controls — locked columns", () => {
  it("disables the checkbox of a locked column and shows why", () => {
    render(() => <ControlledTable lockVisible={["symbol"]} />);
    openPicker();
    expect(pickerToggle("symbol")).toBeDisabled();
    expect(screen.getByText("locked")).toBeInTheDocument();
    expect(pickerToggle("name")).not.toBeDisabled();
  });

  it("a locked column cannot be hidden by a hydrated config", () => {
    render(() => (
      <ControlledTable lockVisible={["symbol"]} initial={{ order: [], hidden: ["symbol", "name"] }} />
    ));
    // symbol survives the merge; only the hideable "name" disappears.
    expect(headerIds()).toEqual(["symbol", "price", "change", "volume"]);
  });

  it("hiding every hideable column keeps the locked column reachable", () => {
    render(() => <ControlledTable lockVisible={["symbol"]} />);
    openPicker();
    for (const id of ["name", "price", "change", "volume"]) fireEvent.click(pickerToggle(id));
    expect(headerIds()).toEqual(["symbol"]);
    expect(screen.getByText("AAA")).toBeInTheDocument();
  });

  it("with nothing locked, hiding every column leaves exactly one visible", () => {
    render(() => (
      <ControlledTable initial={{ order: [], hidden: ["name", "price", "change", "volume"] }} />
    ));
    expect(headerIds()).toEqual(["symbol"]);
  });
});

describe("TanStackTable column controls — reset", () => {
  it("reset emits empty arrays and restores the declared layout", () => {
    const onChange = vi.fn();
    render(() => (
      <ControlledTable
        onChange={onChange}
        initial={{ order: ["volume", "symbol"], hidden: ["name", "change"] }}
      />
    ));
    expect(headerIds()).not.toEqual(["symbol", "name", "price", "change", "volume"]);

    openPicker();
    fireEvent.click(screen.getByTestId("table-column-picker-reset"));

    expect(onChange).toHaveBeenLastCalledWith({ order: [], hidden: [] });
    expect(headerIds()).toEqual(["symbol", "name", "price", "change", "volume"]);
  });
});

describe("TanStackTable column controls — overlay contract", () => {
  it("renders the panel in a portal, outside the table's scroll container", () => {
    render(() => (
      <div style={{ "overflow": "hidden", height: "40px" }}>
        <ControlledTable />
      </div>
    ));
    openPicker();
    const panel = screen.getByTestId("table-column-picker");
    // Portalled out of the table, so no clipping ancestor can swallow it.
    expect(panel.closest(".paper-tanstack-scroll")).toBeNull();
    expect(panel.closest(".paper-tanstack-container")).toBeNull();
    expect(panel.parentElement?.parentElement).toBe(document.body);
    // `fixed` + the inline z-index keep it above the sticky header (z-index 1).
    expect(panel.className).toContain("fixed");
    expect(panel.style.getPropertyValue("z-index")).toBe("1300");
  });

  it("closes on Escape and on a click outside", () => {
    render(() => <ControlledTable />);
    openPicker();
    expect(screen.getByTestId("table-column-picker")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("table-column-picker")).toBeNull();

    openPicker();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId("table-column-picker")).toBeNull();
  });

  it("the trigger reflects the visible count", () => {
    render(() => <ControlledTable initial={{ order: [], hidden: ["name", "change"] }} />);
    expect(screen.getByTestId("table-column-picker-count").textContent).toBe("3/5");
  });

  it("keeps an opted-in sticky header sticky with the toolbar present", () => {
    render(() => (
      <TanStackTable<Row>
        data={rows}
        columns={columns}
        stickyHeader
        enableColumnControls
        columnPrefs={{ order: [], hidden: [] }}
        onColumnPrefsChange={() => {}}
      />
    ));
    const th = screen.getAllByRole("columnheader")[0] as HTMLTableCellElement;
    expect(th.style.position).toBe("sticky");
    expect(th.style.top).toBe("0px");
  });
});

describe("TanStackTable column controls — combined with existing features", () => {
  it("hiding a column keeps the empty state and its colSpan correct", () => {
    render(() => (
      <TanStackTable<Row>
        data={[]}
        columns={columns}
        enableColumnControls
        columnPrefs={{ order: [], hidden: ["name", "price"] }}
        onColumnPrefsChange={() => {}}
        emptyMessage="Nothing here"
      />
    ));
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
    const emptyCell = screen.getByText("Nothing here").closest("td")!;
    expect(emptyCell.getAttribute("colspan")).toBe("3");
  });

  it("works inside a grouped table without disturbing the group row colSpan", () => {
    type GroupRow = Row & { category: string };
    const grouped: GroupRow[] = [
      { ...rows[0], category: "A" },
      { ...rows[1], category: "A" },
    ];
    render(() => (
      <TanStackTable<GroupRow>
        data={grouped}
        columns={[
          { id: "category", header: "Category", accessorKey: "category" },
          { id: "symbol", header: "Symbol", accessorKey: "symbol" },
          { id: "price", header: "Price", accessorKey: "price" },
        ]}
        enableGrouping
        grouping={["category"]}
        initialState={{ expanded: { "category:A": true } }}
        enableColumnControls
        columnPrefs={{ order: [], hidden: ["price"] }}
        onColumnPrefsChange={() => {}}
        renderGroupHeader={({ value }) => <span data-testid={`grp-${String(value)}`}>Group {String(value)}</span>}
        getGroupRowTestId={(value) => `group-row-${String(value)}`}
      />
    ));
    const headerCells = screen.getByTestId("group-row-A").querySelectorAll("td");
    expect(headerCells).toHaveLength(1);
    expect(headerCells[0].getAttribute("colspan")).toBe("2");
    expect(headerIds()).toEqual(["category", "symbol"]);
  });

  it("recomputed layout is stable across a data change (no extra prefs churn)", () => {
    const onChange = vi.fn();
    const [data, setData] = createSignal<Row[]>(rows);
    render(() => (
      <TanStackTable<Row>
        data={data()}
        columns={columns}
        enableColumnControls
        columnPrefs={{ order: [], hidden: ["name"] }}
        onColumnPrefsChange={onChange}
        getRowTestId={(row) => `stable-${row.symbol}`}
      />
    ));
    const headerBefore = screen.getAllByRole("columnheader");
    setData([...rows, { symbol: "CCC", name: "Gamma", price: 300, change: 2, volume: 3000 }]);
    expect(screen.getAllByRole("columnheader")).toEqual(headerBefore);
    expect(screen.getByTestId("stable-CCC")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("hideable columns are listed with their header labels, in display order", () => {
    render(() => <ControlledTable />);
    openPicker();
    const panel = screen.getByTestId("table-column-picker");
    expect(pickerRowOrder()).toEqual(["symbol", "name", "price", "change", "volume"]);
    expect(within(panel).getByText("Symbol")).toBeInTheDocument();
    expect(within(panel).getByText("Volume")).toBeInTheDocument();
  });

  it("falls back to the column id when a header is JSX", () => {
    render(() => (
      <TanStackTable<Row>
        data={rows}
        columns={[
          { id: "symbol", header: "Symbol", accessorKey: "symbol" },
          { id: "name", header: <span>Name JSX</span>, accessorKey: "name" },
        ]}
        enableColumnControls
        columnPrefs={{ order: [], hidden: [] }}
        onColumnPrefsChange={() => {}}
      />
    ));
    openPicker();
    const panel = screen.getByTestId("table-column-picker");
    // The JSX header is rendered in the table, but the picker labels it "name".
    expect(within(panel).getByText("name")).toBeInTheDocument();
  });
});
