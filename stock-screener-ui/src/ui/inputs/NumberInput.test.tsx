// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { UIProvider } from "@/ui";
import { NumberInput, coerceNumberInput } from "./NumberInput";

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> });
}

describe("NumberInput", () => {
  afterEach(() => cleanup());

  test("exposes the testid on the wrapper; the input is a fillable spinbutton", async () => {
    const onChange = vi.fn();
    r(<NumberInput value="" onChange={onChange} data-testid="num" />);
    const input = within(screen.getByTestId("num")).getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "20" } });
    expect(onChange).toHaveBeenLastCalledWith(20);
  });

  test("complete numbers arrive as numbers, clears as empty string", () => {
    const onChange = vi.fn();
    r(<NumberInput value="5" onChange={onChange} data-testid="num" />);
    const input = within(screen.getByTestId("num")).getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith("");
    fireEvent.change(input, { target: { value: "42" } });
    expect(onChange).toHaveBeenLastCalledWith(42);
  });

  test("partial strings never produce NaN or truncated numbers", () => {
    // happy-dom sanitizes type=number partials at the DOM level, so the guard
    // is covered at the unit level (real-browser typing emits "-", "1.", …).
    expect(coerceNumberInput("")).toBe("");
    expect(coerceNumberInput("42")).toBe(42);
    expect(coerceNumberInput("4.5")).toBe(4.5);
    for (const partial of ["-", "1.", "1e-", ".", "1e"]) {
      const emitted = coerceNumberInput(partial);
      expect(typeof emitted).toBe("string");
      expect(Number.isNaN(emitted)).toBe(false);
    }
    expect(coerceNumberInput("1.")).toBe("1.");
    expect(coerceNumberInput("-")).toBe("-");
  });
});
