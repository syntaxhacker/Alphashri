// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { DatePicker } from "./DatePicker";

afterEach(() => vi.unstubAllEnvs());

function inputOf(container: HTMLElement): HTMLInputElement {
  return container.querySelector("input[type=date]") as HTMLInputElement;
}

describe("DatePicker — YYYY-MM-DD round-trip", () => {
  const cases: [string, string][] = [
    ["2026-04-20", "America/New_York"],
    ["2026-01-01", "America/New_York"],
    ["2026-04-20", "Asia/Kolkata"],
    ["2026-01-01", "Asia/Kolkata"],
    ["2026-04-20", "UTC"],
  ];

  for (const [day, tz] of cases) {
    it(`renders ${day} as ${day} in ${tz}`, () => {
      vi.stubEnv("TZ", tz);
      const [y, m, d] = day.split("-").map(Number);
      const { container } = render(() => <DatePicker value={new Date(y, m - 1, d)} />);
      expect(inputOf(container).value).toBe(day);
    });
  }

  for (const tz of ["America/New_York", "Asia/Kolkata"]) {
    it(`parses a typed 2026-04-20 back to local midnight in ${tz}`, () => {
      vi.stubEnv("TZ", tz);
      const onChange = vi.fn();
      const { container } = render(() => <DatePicker value={null} onChange={onChange} />);

      fireEvent.input(inputOf(container), { target: { value: "2026-04-20" } });

      expect(onChange).toHaveBeenCalledTimes(1);
      const picked = onChange.mock.calls[0][0] as Date;
      expect(picked.getFullYear()).toBe(2026);
      expect(picked.getMonth()).toBe(3);
      expect(picked.getDate()).toBe(20);
    });
  }

  it("keeps min/max on the same local calendar day", () => {
    vi.stubEnv("TZ", "Asia/Kolkata");
    const { container } = render(() => (
      <DatePicker value={null} minDate={new Date(2026, 0, 1)} maxDate={new Date(2026, 3, 20)} />
    ));
    const input = inputOf(container);
    expect(input.min).toBe("2026-01-01");
    expect(input.max).toBe("2026-04-20");
  });
});

describe("DatePicker — excludeDate", () => {
  it("rejects an excluded date, restores the previous value and announces it", () => {
    const onChange = vi.fn();
    const { container } = render(() => (
      <DatePicker
        value={new Date(2026, 3, 20)}
        onChange={onChange}
        excludeDate={(d) => d.getDate() === 19}
      />
    ));
    const input = inputOf(container);

    fireEvent.input(input, { target: { value: "2026-04-19" } });

    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe("2026-04-20");
    expect(screen.getByRole("alert")).toHaveTextContent("Selected date is not available");
  });

  it("accepts a date the predicate allows and clears the message", () => {
    const onChange = vi.fn();
    const { container } = render(() => (
      <DatePicker
        value={new Date(2026, 3, 20)}
        onChange={onChange}
        excludeDate={(d) => d.getDate() === 19}
      />
    ));
    const input = inputOf(container);

    fireEvent.input(input, { target: { value: "2026-04-19" } });
    expect(screen.getByRole("alert")).toBeInTheDocument();

    fireEvent.input(input, { target: { value: "2026-04-21" } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect((onChange.mock.calls[0][0] as Date).getDate()).toBe(21);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("still allows clearing a rejected field", () => {
    const onChange = vi.fn();
    const { container } = render(() => (
      <DatePicker
        value={new Date(2026, 3, 20)}
        onChange={onChange}
        clearable
        excludeDate={() => true}
      />
    ));

    fireEvent.input(inputOf(container), { target: { value: "2026-04-21" } });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("Clear date"));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("clears the rejection message when the parent supplies a new value", () => {
    const [value, setValue] = createSignal<Date | null>(new Date(2026, 3, 20));
    const { container } = render(() => (
      <DatePicker value={value()} onChange={setValue} excludeDate={(d) => d.getDate() === 19} />
    ));

    fireEvent.input(inputOf(container), { target: { value: "2026-04-19" } });
    expect(screen.getByRole("alert")).toBeInTheDocument();

    setValue(new Date(2026, 3, 23));

    expect(inputOf(container).value).toBe("2026-04-23");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});