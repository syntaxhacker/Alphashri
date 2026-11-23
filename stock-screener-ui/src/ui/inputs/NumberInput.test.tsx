// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { NumberInput, coerceNumberInput } from "./NumberInput";

afterEach(cleanup);

describe("NumberInput", () => {
  test("exposes the testid on the wrapper; the input is a fillable spinbutton", () => {
    const onChange = vi.fn();
    render(() => <NumberInput value="" onChange={onChange} data-testid="num" />);
    const input = within(screen.getByTestId("num")).getByRole("spinbutton");
    (input as HTMLInputElement).value = "20";
    fireEvent.input(input);
    expect(onChange).toHaveBeenLastCalledWith(20);
  });

  test("complete numbers arrive as numbers, clears as empty string", () => {
    const onChange = vi.fn();
    render(() => <NumberInput value="5" onChange={onChange} data-testid="num" />);
    const input = within(screen.getByTestId("num")).getByRole("spinbutton");
    (input as HTMLInputElement).value = "";
    fireEvent.input(input);
    expect(onChange).toHaveBeenLastCalledWith("");
    (input as HTMLInputElement).value = "42";
    fireEvent.input(input);
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

describe("NumberInput — form error accessibility", () => {
  test("a string error is associated with the spinbutton, not the wrapper", () => {
    render(() => <NumberInput data-testid="num" id="price" error="Price is required" />);
    const wrapper = screen.getByTestId("num");
    const input = within(wrapper).getByRole("spinbutton");
    const message = screen.getByText("Price is required");

    expect(message.id).toBe("price-error");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", message.id);
    expect(wrapper).not.toHaveAttribute("aria-invalid");
  });

  test("a JSX error renders as elements, never [object Object]", () => {
    const { container } = render(() => (
      <NumberInput data-testid="num" id="price" error={<span data-testid="jsx-error"><b>Invalid</b> price</span>} />
    ));
    const input = within(screen.getByTestId("num")).getByRole("spinbutton");

    expect(screen.getByTestId("jsx-error").querySelector("b")).not.toBeNull();
    expect(container.textContent).not.toContain("[object Object]");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "price-error");
  });

  test("a description is described by the input with aria-invalid false", () => {
    render(() => <NumberInput data-testid="num" id="price" description="Enter a number" />);
    const input = within(screen.getByTestId("num")).getByRole("spinbutton");

    expect(input).toHaveAttribute("aria-invalid", "false");
    expect(input).toHaveAttribute("aria-describedby", "price-error");
    expect(screen.getByText("Enter a number")).toHaveAttribute("id", "price-error");
  });
});
