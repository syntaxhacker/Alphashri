// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";

const isTradingHoliday = vi.fn<(date: string) => boolean>(() => false);
vi.mock("../../state/holidays", () => ({ isTradingHoliday: (d: string) => isTradingHoliday(d) }));

import { TradingDatePicker } from "./TradingDatePicker";

afterEach(() => {
  vi.unstubAllEnvs();
  isTradingHoliday.mockReset();
  isTradingHoliday.mockReturnValue(false);
});

function inputOf(container: HTMLElement): HTMLInputElement {
  return container.querySelector("input[type=date]") as HTMLInputElement;
}

describe("TradingDatePicker — string round-trip", () => {
  for (const tz of ["America/New_York", "Asia/Kolkata", "UTC"]) {
    it(`shows the stored day unchanged in ${tz}`, () => {
      vi.stubEnv("TZ", tz);
      const { container } = render(() => <TradingDatePicker value="2026-04-20" />);
      expect(inputOf(container).value).toBe("2026-04-20");
    });
  }

  it("shows a January date without slipping into the previous year", () => {
    vi.stubEnv("TZ", "Asia/Kolkata");
    const { container } = render(() => <TradingDatePicker value="2026-01-01" />);
    expect(inputOf(container).value).toBe("2026-01-01");
  });

  it("emits the same YYYY-MM-DD the user picked", () => {
    vi.stubEnv("TZ", "America/New_York");
    const onChange = vi.fn();
    const { container } = render(() => <TradingDatePicker value="2026-04-20" onChange={onChange} />);

    fireEvent.input(inputOf(container), { target: { value: "2026-04-21" } });

    expect(onChange).toHaveBeenCalledWith("2026-04-21");
  });

  it("keeps min/max strings intact in a west-of-UTC zone", () => {
    vi.stubEnv("TZ", "America/New_York");
    const { container } = render(() => (
      <TradingDatePicker minDate="2026-01-01" maxDate="2026-04-20" />
    ));
    const input = inputOf(container);
    expect(input.min).toBe("2026-01-01");
    expect(input.max).toBe("2026-04-20");
  });
});

describe("TradingDatePicker — non-trading days", () => {
  it("rejects an exchange holiday and restores the previous value", () => {
    isTradingHoliday.mockImplementation((d) => d === "2026-04-21");
    const onChange = vi.fn();
    const { container } = render(() => <TradingDatePicker value="2026-04-20" onChange={onChange} />);

    fireEvent.input(inputOf(container), { target: { value: "2026-04-21" } });

    expect(onChange).not.toHaveBeenCalled();
    expect(inputOf(container).value).toBe("2026-04-20");
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("rejects a date excluded by the caller's own predicate", () => {
    const onChange = vi.fn();
    const { container } = render(() => (
      <TradingDatePicker
        value="2026-04-20"
        onChange={onChange}
        excludeDate={(v) => v === "2026-04-22"}
      />
    ));

    fireEvent.input(inputOf(container), { target: { value: "2026-04-22" } });

    expect(onChange).not.toHaveBeenCalled();
    expect(inputOf(container).value).toBe("2026-04-20");
  });

  it("accepts a normal trading day", () => {
    const onChange = vi.fn();
    const { container } = render(() => <TradingDatePicker value="2026-04-20" onChange={onChange} />);

    fireEvent.input(inputOf(container), { target: { value: "2026-04-23" } });

    expect(onChange).toHaveBeenCalledWith("2026-04-23");
    expect(isTradingHoliday).toHaveBeenCalledWith("2026-04-23");
  });
});
