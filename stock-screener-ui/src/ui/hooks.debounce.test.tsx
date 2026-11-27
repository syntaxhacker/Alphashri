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

  it("restarts the timer on later input and never publishes a superseded value", () => {
    const [query, setQuery] = createSignal("a");
    const { container } = render(() => {
      const [debounced] = useDebouncedValue(query, 100);
      return <span>{debounced()}</span>;
    });

    expect(container.textContent).toBe("a");

    setQuery("ab");
    vi.advanceTimersByTime(60);
    expect(container.textContent).toBe("a");

    // "ab"'s deadline (120ms) has passed, but "abc" restarted the timer — the
    // stale value must not be published just because its own delay elapsed.
    setQuery("abc");
    vi.advanceTimersByTime(60);
    expect(container.textContent).toBe("a");

    vi.advanceTimersByTime(40);
    expect(container.textContent).toBe("abc");
  });

  it("accepts a plain value", () => {
    const { container } = render(() => {
      const [debounced] = useDebouncedValue("static", 300);
      return <span>{debounced()}</span>;
    });
    expect(container.textContent).toBe("static");
  });
});
