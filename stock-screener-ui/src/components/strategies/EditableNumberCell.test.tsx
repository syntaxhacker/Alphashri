// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSignal } from "solid-js";
import { render, screen, waitFor, cleanup, within, fireEvent } from "@solidjs/testing-library";
import { EditableNumberCell } from "./EditableNumberCell";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const mockOnUpdate = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockOnUpdate.mockResolvedValue(undefined);
});

function renderCell(partial: Partial<Parameters<typeof EditableNumberCell>[0]> = {}) {
  const { value, ...rest } = partial;
  const [valueSig, setValue] = createSignal(value ?? 1.5);
  const utils = render(() => (
    <EditableNumberCell
      value={valueSig()}
      field="sl_pct"
      strategyId={1}
      onUpdate={mockOnUpdate}
      {...rest}
    />
  ));
  return { ...utils, setValue };
}

function getInput(testId: string) {
  const outer = screen.getByTestId(testId);
  // NumberInput renders a native input with role spinbutton inside
  return within(outer).getByRole("spinbutton") as HTMLInputElement;
}

describe("EditableNumberCell", () => {
  it("renders with initial value", () => {
    renderCell();
    expect(getInput("editable-sl_pct-1")).toHaveValue(1.5);
  });

  it("calls onUpdate on blur when value changes", async () => {
    renderCell();
    const input = getInput("editable-sl_pct-1");
    fireEvent.input(input, { target: { value: "2" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(mockOnUpdate).toHaveBeenCalledWith(1, "sl_pct", 2.0);
    });
  });

  it("does not call onUpdate on blur when value is unchanged", async () => {
    renderCell();
    const input = getInput("editable-sl_pct-1");
    fireEvent.click(input);
    fireEvent.blur(input);

    expect(mockOnUpdate).not.toHaveBeenCalled();
  });

  it("does not call onUpdate on blur when value is invalid", async () => {
    renderCell();
    const input = getInput("editable-sl_pct-1");
    fireEvent.input(input, { target: { value: "" } });
    fireEvent.blur(input);

    expect(mockOnUpdate).not.toHaveBeenCalled();
  });

  it("reverts value on update failure", async () => {
    mockOnUpdate.mockRejectedValue(new Error("fail"));

    renderCell();
    const input = getInput("editable-sl_pct-1");
    fireEvent.input(input, { target: { value: "2" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(mockOnUpdate).toHaveBeenCalled();
      expect(getInput("editable-sl_pct-1")).toHaveValue(1.5);
    });
  });

  it("calls onUpdate on Enter key", async () => {
    renderCell();
    const input = getInput("editable-sl_pct-1");
    fireEvent.input(input, { target: { value: "2" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(mockOnUpdate).toHaveBeenCalledWith(1, "sl_pct", 2.0);
    });
  });

  it("reverts value on Escape key without saving", async () => {
    renderCell();
    const input = getInput("editable-sl_pct-1");
    fireEvent.input(input, { target: { value: "2" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(mockOnUpdate).not.toHaveBeenCalled();
    expect(getInput("editable-sl_pct-1")).toHaveValue(1.5);
  });

  it("stops propagation on key events", async () => {
    const onDivKeyDown = vi.fn();
    render(() => (
      <div onKeyDown={onDivKeyDown}>
        <EditableNumberCell value={1.5} field="sl_pct" strategyId={1} onUpdate={mockOnUpdate} />
      </div>
    ));

    const input = getInput("editable-sl_pct-1");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onDivKeyDown).not.toHaveBeenCalled();
  });

  it("handles integer fields (max_positions)", async () => {
    renderCell({ value: 5, field: "max_positions", step: 1, decimalScale: 0, min: 1, max: 20 });
    const input = getInput("editable-max_positions-1");
    fireEvent.input(input, { target: { value: "8" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(mockOnUpdate).toHaveBeenCalledWith(1, "max_positions", 8);
    });
  });

  it("syncs with external value changes", () => {
    const { setValue } = renderCell();
    setValue(2.5);

    expect(getInput("editable-sl_pct-1")).toHaveValue(2.5);
  });

  it("does not sync external value while user is editing dirty value", async () => {
    const { setValue } = renderCell();
    const input = getInput("editable-sl_pct-1");
    fireEvent.input(input, { target: { value: "2" } });

    setValue(3.0);

    expect(getInput("editable-sl_pct-1")).toHaveValue(2);
  });
});
