// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { FilterNumber } from "./FilterNumber";

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/patterns/solidUiMock");
  return mockSolidUi();
});

function inputOf(testId: string) {
  return within(screen.getByTestId(testId)).getByRole("spinbutton");
}

describe("FilterNumber", () => {
  afterEach(() => cleanup());

  test("renders a numeric input with its testId and placeholder", () => {
    render(() => <FilterNumber testId="fn" onChange={vi.fn()} placeholder="Any" />);
    const input = inputOf("fn");
    expect(input).toHaveAttribute("placeholder", "Any");
    expect(input).not.toBeDisabled();
  });

  test("typing a complete number emits a number, never a string", () => {
    const onChange = vi.fn();
    render(() => <FilterNumber testId="fn" onChange={onChange} />);
    fireEvent.input(inputOf("fn"), { target: { value: "123.5" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(123.5);
  });

  test("clearing a numeric value emits null", () => {
    const onChange = vi.fn();
    render(() => <FilterNumber testId="fn" value={5} onChange={onChange} />);
    fireEvent.input(inputOf("fn"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(null);
  });

  test("entering '-' never stores NaN", () => {
    // happy-dom normalizes "-" to "" in <input type="number">, so partials
    // surface as either empty or valid — never NaN.
    const onChange = vi.fn();
    render(() => <FilterNumber testId="fn" onChange={onChange} />);
    fireEvent.input(inputOf("fn"), { target: { value: "-" } });
    expect(onChange.mock.calls.every(([value]) => value === null || !Number.isNaN(value))).toBe(true);
  });

  test("entering '1.' never stores NaN", () => {
    const onChange = vi.fn();
    render(() => <FilterNumber testId="fn" onChange={onChange} />);
    fireEvent.input(inputOf("fn"), { target: { value: "1." } });
    expect(onChange.mock.calls.every(([value]) => !Number.isNaN(value))).toBe(true);
  });

  test("forwards min/max/step to the underlying input", () => {
    render(() => <FilterNumber testId="fn" onChange={vi.fn()} min={0} max={100} step={0.5} />);
    const input = inputOf("fn");
    expect(input).toHaveAttribute("min", "0");
    expect(input).toHaveAttribute("max", "100");
    expect(input).toHaveAttribute("step", "0.5");
  });

  test("forwards disabled to the underlying input", () => {
    render(() => <FilterNumber testId="fn" onChange={vi.fn()} disabled />);
    expect(inputOf("fn")).toBeDisabled();
  });
});
