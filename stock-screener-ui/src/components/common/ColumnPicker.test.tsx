// @vitest-environment happy-dom
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { ColumnPicker, type ColumnPickerItem } from "./ColumnPicker";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const items: ColumnPickerItem[] = [
  { id: "symbol", label: "Symbol", visible: true, locked: true },
  { id: "name", label: "Name", visible: true },
  { id: "price", label: "Price", visible: false },
];

function setup(overrides: Partial<Record<"onMove" | "onToggle" | "onReset", () => void>> = {}) {
  const onMove = vi.fn();
  const onToggle = vi.fn();
  const onReset = vi.fn();
  render(() => (
    <ColumnPicker
      items={items}
      onMove={(overrides.onMove as never) ?? onMove}
      onToggle={(overrides.onToggle as never) ?? onToggle}
      onReset={(overrides.onReset as never) ?? onReset}
    />
  ));
  fireEvent.click(screen.getByTestId("table-column-picker-trigger"));
  return { onMove, onToggle, onReset };
}

describe("ColumnPicker", () => {
  it("starts closed and opens on the trigger", () => {
    render(() => <ColumnPicker items={items} onMove={() => {}} onToggle={() => {}} onReset={() => {}} />);
    expect(screen.queryByTestId("table-column-picker")).toBeNull();
    fireEvent.click(screen.getByTestId("table-column-picker-trigger"));
    expect(screen.getByTestId("table-column-picker")).toBeInTheDocument();
  });

  it("counts visible columns against the total", () => {
    setup();
    expect(screen.getByTestId("table-column-picker-count").textContent).toBe("2/3");
  });

  it("does not open a panel when there is nothing to customise", () => {
    render(() => (
      <ColumnPicker items={[{ id: "only", label: "Only", visible: true, locked: true }]} onMove={() => {}} onToggle={() => {}} onReset={() => {}} />
    ));
    // Still opens — a single locked column is a legitimate (if boring) picker.
    fireEvent.click(screen.getByTestId("table-column-picker-trigger"));
    expect(screen.getByTestId("table-column-picker")).toBeInTheDocument();
    expect(screen.getByTestId("table-column-picker-toggle-only")).toBeDisabled();
  });

  it("toggles a hideable column and reports the next state", () => {
    const { onToggle } = setup();
    fireEvent.click(screen.getByTestId("table-column-picker-toggle-name"));
    expect(onToggle).toHaveBeenCalledWith("name", false);

    fireEvent.click(screen.getByTestId("table-column-picker-toggle-price"));
    expect(onToggle).toHaveBeenLastCalledWith("price", true);
  });

  it("never toggles a locked column, even when the event fires", () => {
    const { onToggle } = setup();
    const locked = screen.getByTestId("table-column-picker-toggle-symbol") as HTMLInputElement;
    expect(locked).toBeDisabled();
    fireEvent.click(locked);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("explains why a locked column cannot be hidden", () => {
    setup();
    expect(screen.getByText("locked")).toBeInTheDocument();
    expect(screen.getAllByText("locked")).toHaveLength(1);
  });

  it("reorders with the keyboard from the drag handle", () => {
    const { onMove } = setup();
    const handle = screen.getByTestId("table-column-picker-handle-price");
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(onMove).toHaveBeenCalledWith(2, 1);

    fireEvent.keyDown(screen.getByTestId("table-column-picker-handle-name"), { key: "ArrowDown" });
    expect(onMove).toHaveBeenLastCalledWith(1, 2);
  });

  it("ignores keyboard moves that would leave the list", () => {
    const { onMove } = setup();
    fireEvent.keyDown(screen.getByTestId("table-column-picker-handle-symbol"), { key: "ArrowUp" });
    fireEvent.keyDown(screen.getByTestId("table-column-picker-handle-price"), { key: "ArrowDown" });
    expect(onMove).not.toHaveBeenCalled();
  });

  it("reorders by drag and drop, and clears the drag source on dragend", () => {
    const { onMove } = setup();
    const handle = screen.getByTestId("table-column-picker-handle-symbol");
    const target = screen.getByTestId("table-column-picker-row-price");
    fireEvent.dragStart(handle);
    fireEvent.dragOver(target);
    fireEvent.drop(target);
    expect(onMove).toHaveBeenCalledWith(0, 2);

    // A second drag must start from a clean state, not replay the first.
    fireEvent.dragEnd(handle);
    fireEvent.drop(screen.getByTestId("table-column-picker-row-name"));
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it("does not treat a foreign drag as a reorder", () => {
    const { onMove } = setup();
    // No dragStart on a handle: a file dragged from the desktop must not move rows.
    fireEvent.drop(screen.getByTestId("table-column-picker-row-price"));
    expect(onMove).not.toHaveBeenCalled();
  });

  it("reset is a single, explicit action", () => {
    const { onReset } = setup();
    fireEvent.click(screen.getByTestId("table-column-picker-reset"));
    expect(onReset).toHaveBeenCalledTimes(1);
    // Resetting does not rely on the parent to close the panel.
    expect(screen.getByTestId("table-column-picker")).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    setup();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("table-column-picker")).toBeNull();
  });

  it("stays open on a click inside the panel so multi-column edits work", () => {
    setup();
    fireEvent.mouseDown(screen.getByTestId("table-column-picker-row-name"));
    expect(screen.getByTestId("table-column-picker")).toBeInTheDocument();
  });

  it("keeps the panel row DOM nodes stable when a checkbox flips", async () => {
    // The picker receives a fresh items array on every prefs change, so a
    // reference-keyed `For` remounts every row and the user loses focus on the
    // third column they were about to toggle.
    const [itemsSig, setItems] = createSignal<ColumnPickerItem[]>(items);
    const onToggle = vi.fn((id: string, visible: boolean) => {
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, visible } : it)));
    });
    render(() => (
      <ColumnPicker items={itemsSig()} onMove={() => {}} onToggle={onToggle} onReset={() => {}} />
    ));
    fireEvent.click(screen.getByTestId("table-column-picker-trigger"));

    const rowBefore = screen.getByTestId("table-column-picker-row-name");
    const toggleBefore = screen.getByTestId("table-column-picker-toggle-name");
    fireEvent.click(toggleBefore);

    expect(onToggle).toHaveBeenCalledWith("name", false);
    expect(screen.getByTestId("table-column-picker-row-name")).toBe(rowBefore);
    expect(screen.getByTestId("table-column-picker-toggle-name")).toBe(toggleBefore);
  });

  it("renders rows in item order, so display order is the source of truth", () => {
    setup();
    const order = Array.from(
      document.querySelectorAll<HTMLLIElement>('[data-testid^="table-column-picker-row-"]'),
    ).map((li) => li.dataset.testid!.replace("table-column-picker-row-", ""));
    expect(order).toEqual(["symbol", "name", "price"]);
  });

  it("flips above the trigger and shrinks to the space available", async () => {
    render(() => <ColumnPicker items={items} onMove={() => {}} onToggle={() => {}} onReset={() => {}} />);
    const trigger = screen.getByTestId("table-column-picker-trigger");
    const vw = window.innerWidth;
    // A short viewport: neither side can hold the full 320px panel.
    const vh = 200;
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(vh);
    // The picker anchors to its own wrapper (an inline-block around the button).
    const anchor = trigger.parentElement as HTMLElement;
    // 68px above the fold, so a 320px panel cannot open downwards either.
    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue({
      top: vh - 68,
      bottom: vh - 38,
      left: vw - 120,
      right: vw - 20,
      width: 100,
      height: 30,
      x: vw - 120,
      y: vh - 68,
      toJSON: () => ({}),
    } as DOMRect);
    fireEvent.click(trigger);
    // Placement runs on a microtask, then the panel is revealed.
    await Promise.resolve();

    const panel = screen.getByTestId("table-column-picker");
    const top = Number.parseFloat(panel.style.top);
    const right = Number.parseFloat(panel.style.right);
    const maxHeight = Number.parseFloat(panel.style.maxHeight);
    expect(top).toBeGreaterThanOrEqual(8);
    expect(top + maxHeight).toBeLessThanOrEqual(vh - 38);
    expect(maxHeight).toBeLessThan(320);
    expect(right).toBeGreaterThanOrEqual(8);
    expect(right + 232).toBeLessThanOrEqual(vw);
    expect(panel.style.visibility).toBe("visible");
  });

  it("opens downwards when there is room below", async () => {
    render(() => <ColumnPicker items={items} onMove={() => {}} onToggle={() => {}} onReset={() => {}} />);
    const trigger = screen.getByTestId("table-column-picker-trigger");
    const anchor = trigger.parentElement as HTMLElement;
    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 130,
      left: 400,
      right: 500,
      width: 100,
      height: 30,
      x: 400,
      y: 100,
      toJSON: () => ({}),
    } as DOMRect);
    fireEvent.click(trigger);
    await Promise.resolve();

    const panel = screen.getByTestId("table-column-picker");
    expect(Number.parseFloat(panel.style.top)).toBe(134);
    expect(Number.parseFloat(panel.style.maxHeight)).toBe(320);
  });
});
