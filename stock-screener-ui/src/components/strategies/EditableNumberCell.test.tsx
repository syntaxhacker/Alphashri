// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

function getInput(testId: string) {
  const outer = screen.getByTestId(testId);
  // NumberInput renders TextField with input role spinbutton inside
  return within(outer).getByRole("spinbutton") as HTMLInputElement;
}

describe("EditableNumberCell", () => {
  it("renders with initial value", () => {
    renderCell();
    expect(getInput("editable-sl_pct-1")).toHaveValue(1.5);
  });

  it("calls onUpdate on blur when value changes", async () => {
      const user = userEvent.setup();
    renderCell();
    const input = getInput("editable-sl_pct-1");
    await user.clear(input); await user.type(input, "2");
    await user.tab() // blur input;

    await waitFor(() => {
      expect(mockOnUpdate).toHaveBeenCalledWith(1, "sl_pct", 2.0);
    });
  });

  it("does not call onUpdate on blur when value is unchanged", async () => {
      const user = userEvent.setup();
    renderCell();
    const input = getInput("editable-sl_pct-1");
    await user.click(input);
    await user.tab() // blur input;

    expect(mockOnUpdate).not.toHaveBeenCalled();
  });

  it("does not call onUpdate on blur when value is invalid", async () => {
      const user = userEvent.setup();
    renderCell();
    const input = getInput("editable-sl_pct-1");
    await user.clear(input);
    await user.tab() // blur input;

    expect(mockOnUpdate).not.toHaveBeenCalled();
  });

  it("reverts value on update failure", async () => {
      const user = userEvent.setup();
    mockOnUpdate.mockRejectedValue(new Error("fail"));

    renderCell();
    const input = getInput("editable-sl_pct-1");
    await user.clear(input); await user.type(input, "2");
    await user.tab() // blur input;

    await waitFor(() => {
      expect(mockOnUpdate).toHaveBeenCalled();
      expect(getInput("editable-sl_pct-1")).toHaveValue(1.5);
    });
  });

  it("calls onUpdate on Enter key", async () => {
      const user = userEvent.setup();
    renderCell();
    const input = getInput("editable-sl_pct-1");
    await user.clear(input); await user.type(input, "2");
    await user.keyboard("{Enter}");
    fireEvent.blur(input);

    await waitFor(() => {
      expect(mockOnUpdate).toHaveBeenCalledWith(1, "sl_pct", 2.0);
    });
  });

  it("reverts value on Escape key without saving", async () => {
      const user = userEvent.setup();
    renderCell();
    const input = getInput("editable-sl_pct-1");
    await user.clear(input); await user.type(input, "2");
    await user.keyboard("{Escape}");

    expect(mockOnUpdate).not.toHaveBeenCalled();
    expect(getInput("editable-sl_pct-1")).toHaveValue(1.5);
  });

  it("stops propagation on key events", async () => {
      const user = userEvent.setup();
    const onDivKeyDown = vi.fn();
    render(
      <div onKeyDown={onDivKeyDown}>
        <EditableNumberCell value={1.5} field="sl_pct" strategyId={1} onUpdate={mockOnUpdate} />
      </div>,
    );

    const input = getInput("editable-sl_pct-1");
    await user.click(input);
    await user.keyboard("{Enter}");

    expect(onDivKeyDown).not.toHaveBeenCalled();
  });

  it("handles integer fields (max_positions)", async () => {
      const user = userEvent.setup();
    renderCell({ value: 5, field: "max_positions", step: 1, decimalScale: 0, min: 1, max: 20 });
    const input = getInput("editable-max_positions-1");
    await user.clear(input); await user.type(input, "8");
    await user.tab() // blur input;

    await waitFor(() => {
      expect(mockOnUpdate).toHaveBeenCalledWith(1, "max_positions", 8);
    });
  });

  it("syncs with external value changes", () => {
    const { rerender } = renderCell();
    rerender(
      <EditableNumberCell value={2.5} field="sl_pct" strategyId={1} onUpdate={mockOnUpdate} />,
    );

    expect(getInput("editable-sl_pct-1")).toHaveValue(2.5);
  });

  it("does not sync external value while user is editing dirty value", async () => {
      const user = userEvent.setup();
    const { rerender } = renderCell();
    const input = getInput("editable-sl_pct-1");
    await user.clear(input); await user.type(input, "2");

    rerender(
      <EditableNumberCell value={3.0} field="sl_pct" strategyId={1} onUpdate={mockOnUpdate} />,
    );

    expect(getInput("editable-sl_pct-1")).toHaveValue(2);
  });
});
