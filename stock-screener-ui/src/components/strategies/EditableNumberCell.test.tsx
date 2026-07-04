// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { EditableNumberCell } from "./EditableNumberCell";

afterEach(cleanup);

vi.mock("@/ui", () => ({
  NumberInput: (props: any) => {
    const testId = props["data-testid"] || "number-input";
    return (
      <input
        data-testid={testId}
        data-value={props.value}
        value={props.value}
        onChange={(e: any) =>
          props.onChange(e.target.value === "" ? "" : parseFloat(e.target.value))
        }
        onBlur={props.onBlur}
        onKeyDown={props.onKeyDown}
      />
    );
  },
}));

const mockOnUpdate = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockOnUpdate.mockResolvedValue(undefined);
});

function renderCell(props: Partial<Parameters<typeof EditableNumberCell>[0]> = {}) {
  return render(
    <EditableNumberCell
      value={1.5}
      field="sl_pct"
      strategyId={1}
      onUpdate={mockOnUpdate}
      {...props}
    />,
  );
}

describe("EditableNumberCell", () => {
  it("renders with initial value", () => {
    renderCell();
    expect(screen.getByTestId("editable-sl_pct-1")).toBeTruthy();
  });

  it("calls onUpdate on blur when value changes", async () => {
    renderCell();
    const input = screen.getByTestId("editable-sl_pct-1");
    fireEvent.change(input, { target: { value: "2.0" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(mockOnUpdate).toHaveBeenCalledWith(1, "sl_pct", 2.0);
    });
  });

  it("does not call onUpdate on blur when value is unchanged", () => {
    renderCell();
    const input = screen.getByTestId("editable-sl_pct-1");
    fireEvent.blur(input);

    expect(mockOnUpdate).not.toHaveBeenCalled();
  });

  it("does not call onUpdate on blur when value is invalid", () => {
    renderCell();
    const input = screen.getByTestId("editable-sl_pct-1");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);

    expect(mockOnUpdate).not.toHaveBeenCalled();
  });

  it("reverts value on update failure", async () => {
    mockOnUpdate.mockRejectedValue(new Error("fail"));

    renderCell();
    const input = screen.getByTestId("editable-sl_pct-1");
    fireEvent.change(input, { target: { value: "2.0" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(mockOnUpdate).toHaveBeenCalled();
      expect(screen.getByTestId("editable-sl_pct-1").getAttribute("data-value")).toBe("1.5");
    });
  });

  it("calls onUpdate on Enter key", async () => {
    renderCell();
    const input = screen.getByTestId("editable-sl_pct-1");
    fireEvent.change(input, { target: { value: "2.0" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(mockOnUpdate).toHaveBeenCalledWith(1, "sl_pct", 2.0);
    });
  });

  it("reverts value on Escape key without saving", () => {
    renderCell();
    const input = screen.getByTestId("editable-sl_pct-1");
    fireEvent.change(input, { target: { value: "2.0" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(mockOnUpdate).not.toHaveBeenCalled();
    expect(screen.getByTestId("editable-sl_pct-1").getAttribute("data-value")).toBe("1.5");
  });

  it("stops propagation on key events", () => {
    const onDivKeyDown = vi.fn();
    render(
      <div onKeyDown={onDivKeyDown}>
        <EditableNumberCell value={1.5} field="sl_pct" strategyId={1} onUpdate={mockOnUpdate} />
      </div>,
    );

    const input = screen.getByTestId("editable-sl_pct-1");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onDivKeyDown).not.toHaveBeenCalled();
  });

  it("handles integer fields (max_positions)", async () => {
    renderCell({ value: 5, field: "max_positions", step: 1, decimalScale: 0, min: 1, max: 20 });
    const input = screen.getByTestId("editable-max_positions-1");
    fireEvent.change(input, { target: { value: "8" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(mockOnUpdate).toHaveBeenCalledWith(1, "max_positions", 8);
    });
  });

  it("syncs with external value changes", () => {
    const { rerender } = renderCell();
    rerender(
      <EditableNumberCell value={2.5} field="sl_pct" strategyId={1} onUpdate={mockOnUpdate} />,
    );

    expect(screen.getByTestId("editable-sl_pct-1").getAttribute("data-value")).toBe("2.5");
  });

  it("does not sync external value while user is editing dirty value", () => {
    const { rerender } = renderCell();
    const input = screen.getByTestId("editable-sl_pct-1");
    fireEvent.change(input, { target: { value: "2.0" } });

    rerender(
      <EditableNumberCell value={3.0} field="sl_pct" strategyId={1} onUpdate={mockOnUpdate} />,
    );

    expect(screen.getByTestId("editable-sl_pct-1").getAttribute("data-value")).toBe("2");
  });
});
