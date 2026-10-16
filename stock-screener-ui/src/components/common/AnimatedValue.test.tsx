// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { AnimatedValue, flashDirection } from "./AnimatedValue";

afterEach(() => {
  vi.useRealTimers();
});

describe("flashDirection", () => {
  test("up when next is greater", () => {
    expect(flashDirection(100, 101)).toBe("up");
    expect(flashDirection(-5, -4.9)).toBe("up");
  });

  test("down when next is smaller", () => {
    expect(flashDirection(101, 100)).toBe("down");
    expect(flashDirection(0, -0.01)).toBe("down");
  });

  test("null when equal", () => {
    expect(flashDirection(100, 100)).toBeNull();
    expect(flashDirection(0, 0)).toBeNull();
  });

  test("null when either side is null/undefined", () => {
    expect(flashDirection(null, 100)).toBeNull();
    expect(flashDirection(100, null)).toBeNull();
    expect(flashDirection(undefined, 100)).toBeNull();
    expect(flashDirection(100, undefined)).toBeNull();
    expect(flashDirection(null, null)).toBeNull();
  });

  test("null when either side is non-finite", () => {
    expect(flashDirection(NaN, 100)).toBeNull();
    expect(flashDirection(100, NaN)).toBeNull();
    expect(flashDirection(Infinity, 200)).toBeNull();
    expect(flashDirection(100, Infinity)).toBeNull();
    expect(flashDirection(-Infinity, Infinity)).toBeNull();
  });
});

describe("AnimatedValue", () => {
  const fmt = (v: number) => v.toLocaleString("en-IN");

  test("first render shows the formatted value with no flash class", () => {
    render(<AnimatedValue value={26000} format={fmt} testId="av" />);
    const el = screen.getByTestId("av");
    expect(el).toHaveTextContent("26,000");
    expect(el.className).not.toContain("price-flash-up");
    expect(el.className).not.toContain("price-flash-down");
  });

  test("an increase adds price-flash-up", () => {
    const { rerender } = render(
      <AnimatedValue value={100} format={fmt} testId="av" />,
    );
    rerender(<AnimatedValue value={110} format={fmt} testId="av" />);
    const el = screen.getByTestId("av");
    expect(el).toHaveTextContent("110");
    expect(el.className).toContain("price-flash-up");
    expect(el.className).not.toContain("price-flash-down");
  });

  test("a decrease adds price-flash-down", () => {
    const { rerender } = render(
      <AnimatedValue value={100} format={fmt} testId="av" />,
    );
    rerender(<AnimatedValue value={90} format={fmt} testId="av" />);
    expect(screen.getByTestId("av").className).toContain("price-flash-down");
  });

  test("same value does not flash", () => {
    const { rerender } = render(
      <AnimatedValue value={100} format={fmt} testId="av" />,
    );
    rerender(<AnimatedValue value={100} format={fmt} testId="av" />);
    const el = screen.getByTestId("av");
    expect(el.className).not.toContain("price-flash-up");
    expect(el.className).not.toContain("price-flash-down");
  });

  test("change to null renders a dash without flashing", () => {
    const { rerender } = render(
      <AnimatedValue value={100} format={fmt} testId="av" />,
    );
    rerender(<AnimatedValue value={null} format={fmt} testId="av" />);
    const el = screen.getByTestId("av");
    expect(el).toHaveTextContent("—");
    expect(el.className).not.toContain("price-flash-up");
    expect(el.className).not.toContain("price-flash-down");
  });

  test("null initial value renders a dash without flashing", () => {
    render(<AnimatedValue value={null} format={fmt} testId="av" />);
    const el = screen.getByTestId("av");
    expect(el).toHaveTextContent("—");
    expect(el.className).not.toContain("price-flash");
  });

  test("flash class clears after the timeout", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <AnimatedValue value={100} format={fmt} testId="av" />,
    );
    rerender(<AnimatedValue value={110} format={fmt} testId="av" />);
    expect(screen.getByTestId("av").className).toContain("price-flash-up");
    act(() => {
      vi.advanceTimersByTime(600);
    });
    const el = screen.getByTestId("av");
    expect(el.className).not.toContain("price-flash-up");
    expect(el.className).not.toContain("price-flash-down");
  });

  test("incoming className is preserved alongside the flash class", () => {
    const { rerender } = render(
      <AnimatedValue value={100} className="my-num" testId="av" />,
    );
    rerender(<AnimatedValue value={101} className="my-num" testId="av" />);
    const el = screen.getByTestId("av");
    expect(el.className).toContain("my-num");
    expect(el.className).toContain("price-flash-up");
  });
});
