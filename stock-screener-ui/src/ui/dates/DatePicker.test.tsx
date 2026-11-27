// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import type { UIDatePickerProps } from "../types";
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

describe("DatePicker — public contract", () => {
  it("is one native date input, not a range or calendar grid", () => {
    const { container } = render(() => <DatePicker placeholder="Expiry" />);
    expect(container.querySelectorAll('input[type="date"]')).toHaveLength(1);
    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelectorAll("input")).toHaveLength(1);
  });

  it("never paints the removed Mantine-era props, even if a JS caller forces them through", () => {
    // size / weekendDays / valueFormat / getDayProps are gone from UIDatePickerProps.
    const legacy = {
      size: "xs",
      weekendDays: [0, 6],
      valueFormat: "MMM D",
      getDayProps: () => ({ "data-day": true }),
    } as unknown as UIDatePickerProps;
    const { container } = render(() => <DatePicker {...legacy} placeholder="Expiry" />);
    const root = container.firstElementChild as HTMLElement;
    const input = inputOf(container);

    for (const key of ["size", "weekenddays", "valueformat", "getdayprops", "data-day"]) {
      expect(root).not.toHaveAttribute(key);
      expect(input).not.toHaveAttribute(key);
    }
    expect(input).toHaveAttribute("type", "date");
    expect(container.querySelectorAll('input[type="date"]')).toHaveLength(1);
  });

  it("gives the input a stable id and associates the visible label", () => {
    const { container } = render(() => <DatePicker placeholder="Expiry" />);
    const input = inputOf(container);

    expect(input.id).toBeTruthy();
    expect(screen.getByLabelText("Expiry")).toBe(input);
    expect(container.querySelector(`label[for="${input.id}"]`)).toBeInTheDocument();
  });

  it("reuses an explicit id, then data-testid, as the input id", () => {
    const explicit = render(() => <DatePicker id="expiry" placeholder="Expiry" />);
    expect(inputOf(explicit.container)).toHaveAttribute("id", "expiry");

    explicit.unmount();

    const tested = render(() => <DatePicker data-testid="expiry-test" placeholder="Expiry" />);
    expect(inputOf(tested.container)).toHaveAttribute("id", "expiry-test");
  });

  it("names a label-less input through labels.input, defaulting to 'Date'", () => {
    const bare = render(() => <DatePicker />);
    expect(inputOf(bare.container)).toHaveAttribute("aria-label", "Date");
    bare.unmount();

    const localised = render(() => <DatePicker labels={{ input: "Fecha" }} />);
    expect(inputOf(localised.container)).toHaveAttribute("aria-label", "Fecha");
  });

  it("exposes rejected state as aria-invalid and points at the alert", () => {
    const { container } = render(() => (
      <DatePicker value={new Date(2026, 3, 20)} excludeDate={() => true} />
    ));
    const input = inputOf(container);
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");

    fireEvent.input(input, { target: { value: "2026-04-21" } });

    const alert = screen.getByRole("alert");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(alert.id).toBeTruthy();
    expect(input).toHaveAttribute("aria-describedby", alert.id);
  });

  it("keeps a visible focus ring on the native input", () => {
    const { container } = render(() => <DatePicker />);
    const className = inputOf(container).className;
    expect(className).toContain("focus:ring-fin-text");
    expect(className).toContain("focus-visible:ring-2");
  });
});

describe("DatePicker — labels", () => {
  it("uses the backward-compatible English defaults", () => {
    const onChange = vi.fn();
    const { container } = render(() => (
      <DatePicker value={new Date(2026, 3, 20)} clearable onChange={onChange} excludeDate={() => true} />
    ));

    expect(screen.getByRole("button", { name: "Clear date" })).toBeInTheDocument();

    fireEvent.input(inputOf(container), { target: { value: "2026-04-21" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Selected date is not available");
  });

  it("uses caller-supplied clear and invalid strings", () => {
    const { container } = render(() => (
      <DatePicker
        value={new Date(2026, 3, 20)}
        clearable
        excludeDate={() => true}
        labels={{ clear: "Effacer", invalid: "Date indisponible" }}
      />
    ));

    expect(screen.getByRole("button", { name: "Effacer" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear date" })).not.toBeInTheDocument();

    fireEvent.input(inputOf(container), { target: { value: "2026-04-21" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Date indisponible");
    expect(screen.queryByText("Selected date is not available")).not.toBeInTheDocument();
  });

  it("falls back per key when only some labels are supplied", () => {
    const { container } = render(() => <DatePicker clearable value={new Date(2026, 3, 20)} labels={{ clear: "Löschen" }} />);
    expect(screen.getByRole("button", { name: "Löschen" })).toBeInTheDocument();
    expect(inputOf(container)).toHaveAttribute("aria-label", "Date");
  });
});