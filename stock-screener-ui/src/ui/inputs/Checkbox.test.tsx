// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { TYPE_SCALE, typeSize } from "../typography";
import { Checkbox } from "./Checkbox";
import { Switch } from "./Switch";

afterEach(cleanup);

const boxOf = (testId: string): HTMLElement =>
  screen.getByTestId(testId).nextElementSibling as HTMLElement;

describe("Checkbox — square selection box", () => {
  it("is a 16px square with a 4px radius", () => {
    render(() => <Checkbox label="Row" data-testid="cb" />);
    const style = boxOf("cb").getAttribute("style") ?? "";
    expect(style).toContain("width: 16px");
    expect(style).toContain("height: 16px");
    expect(style).toContain("border-radius: 4px");
    expect(style).toContain("font-size: 12px");
  });

  it("sizes the check mark from the shared ladder, never below the 12px floor", () => {
    const scale = Object.values(TYPE_SCALE).map((s) => s.size);
    for (const size of ["xs", "sm", "md", "lg", "xl"] as const) {
      render(() => <Checkbox size={size} data-testid={`cb-${size}`} />);
      const px = Number.parseFloat(boxOf(`cb-${size}`).style.fontSize);
      expect(scale, `size ${size}`).toContain(px);
      expect(px, `size ${size}`).toBeGreaterThanOrEqual(typeSize("micro"));
    }
  });

  it("has no knob — a checked box paints a checkmark, not a travelling dot", () => {
    render(() => <Checkbox label="Row" checked onChange={() => {}} data-testid="cb" />);
    const box = boxOf("cb");
    expect(box.querySelector("[data-part='switch-knob']")).toBeNull();
    expect(box.textContent).toBe("✔");
    expect(box.getAttribute("style") ?? "").not.toContain("translateX");
  });

  it("fills with the tone and shows the check when selected", () => {
    render(() => <Checkbox label="Row" checked onChange={() => {}} data-testid="cb" />);
    const style = boxOf("cb").getAttribute("style") ?? "";
    expect(style).toContain("background-color: var(--color-fin-primary)");
    expect(style).toContain("border-color: var(--color-fin-primary)");
  });

  it("shows a dash for the indeterminate state", () => {
    render(() => <Checkbox label="Row" indeterminate onChange={() => {}} data-testid="cb" />);
    const box = boxOf("cb");
    expect(box.textContent).toBe("—");
    expect((screen.getByTestId("cb") as HTMLInputElement).indeterminate).toBe(true);
  });

  it("is visually distinct from a switch track", () => {
    render(() => (
      <div>
        <Checkbox label="Row" data-testid="cb" />
        <Switch label="Toggle" data-testid="sw" />
      </div>
    ));
    const square = boxOf("cb").getAttribute("style") ?? "";
    const track = screen.getByTestId("sw").closest("[data-part='switch-track']")!.getAttribute("style") ?? "";
    expect(square).toContain("border-radius: 4px");
    expect(track).toContain("border-radius: 9999px");
    expect(square).not.toContain("9999px");
  });

  it("toggles uncontrolled state and emits onChange with the checked boolean", () => {
    const onChange = vi.fn();
    render(() => <Checkbox label="Row" data-testid="cb" onChange={onChange} />);
    const input = screen.getByTestId("cb") as HTMLInputElement;
    fireEvent.click(input);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);
    expect(boxOf("cb").textContent).toBe("✔");

    fireEvent.click(input);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(boxOf("cb").textContent).toBe("");
  });

  it("emits the checked boolean for a controlled checkbox without owning state", () => {
    const onChange = vi.fn();
    render(() => <Checkbox label="Row" data-testid="cb" checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("cb"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe(true);
    expect(typeof onChange.mock.calls[0][0]).toBe("boolean");
    expect(boxOf("cb").textContent).toBe("");
  });

  it("fades to 45% and blocks the cursor when disabled", () => {
    render(() => <Checkbox label="Row" disabled data-testid="cb" />);
    const style = boxOf("cb").getAttribute("style") ?? "";
    expect(style).toContain("opacity: 0.45");
    expect(style).toContain("cursor: not-allowed");
    expect(style).toContain("background-color: var(--color-fin-surface-alt)");
    expect(screen.getByTestId("cb")).toBeDisabled();
  });

  it("shows a keyboard focus ring on the box", () => {
    render(() => <Checkbox label="Row" data-testid="cb" />);
    fireEvent.focus(screen.getByTestId("cb"));
    const style = boxOf("cb").getAttribute("style") ?? "";
    expect(style).toContain("border-color: var(--color-fin-primary)");
    expect(style).toContain("box-shadow: 0 0 0 1px var(--color-fin-primary)");
  });

  it("exposes an error message and invalid state on the checkbox", () => {
    render(() => <Checkbox label="Accept" error="Required" data-testid="cb" />);
    const input = screen.getByTestId("cb");
    expect(input).toHaveAttribute("aria-invalid", "true");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent("Required");
  });
});
