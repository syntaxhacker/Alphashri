// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSignal } from "solid-js";
import { render } from "@solidjs/testing-library";
import { useDebouncedValue } from "./hooks";

/**
 * Four call sites had to re-implement this hook locally because it took a plain
 * value: a Solid component body runs once, so `useDebouncedValue(count(), 300)`
 * read `count` a single time and never fired again.
 */
describe("useDebouncedValue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("tracks an accessor and settles on the last value", () => {
    const [count, setCount] = createSignal(0);
    const { container } = render(() => {
      const [debounced] = useDebouncedValue(count, 300);
      return <span>{debounced()}</span>;
    });

    setCount(1);
    vi.advanceTimersByTime(100);
    setCount(2);
    vi.advanceTimersByTime(100);
    setCount(3);
    vi.advanceTimersByTime(400);

    expect(container.textContent).toBe("3");
  });

  it("accepts a plain value", () => {
    const { container } = render(() => {
      const [debounced] = useDebouncedValue("static", 300);
      return <span>{debounced()}</span>;
    });
    expect(container.textContent).toBe("static");
  });
});
