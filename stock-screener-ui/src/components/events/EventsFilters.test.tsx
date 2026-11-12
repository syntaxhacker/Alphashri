// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import type { JSX } from "solid-js";
import { UIProvider } from "@/ui";
import { isoDate } from "../../state/events";
import type { EventsQuery } from "../../types/events";
import { ALPHA_EVENT_TYPES, EventsFilters } from "./EventsFilters";

function r(jsx: JSX.Element) {
  return render(() => <UIProvider>{jsx}</UIProvider>);
}

function baseQuery(overrides: Partial<EventsQuery> = {}): EventsQuery {
  return {
    market: "us",
    from: "2026-10-29",
    to: "2027-01-27",
    upcoming_only: true,
    ...overrides,
  };
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function selectOf(testId: string): HTMLSelectElement {
  const el = screen.getByTestId(testId).querySelector("select");
  if (!el) throw new Error(`No <select> under ${testId}`);
  return el;
}

afterEach(cleanup);

describe("EventsFilters", () => {
  test("changing the market emits the matching EventMarket", () => {
    const onChange = vi.fn();
    r(
      <EventsFilters
        query={baseQuery()}
        onChange={onChange}
        onRefresh={vi.fn()}
        isRefreshing={false}
      />,
    );
    fireEvent.input(selectOf("events-market-select"), { target: { value: "india" } });
    expect(onChange).toHaveBeenCalledWith({ market: "india" });
  });

  test("changing the window rewrites from/to through isoDate", () => {
    const onChange = vi.fn();
    r(
      <EventsFilters
        query={baseQuery()}
        onChange={onChange}
        onRefresh={vi.fn()}
        isRefreshing={false}
      />,
    );
    fireEvent.input(selectOf("events-window-select"), { target: { value: "7" } });
    const now = new Date();
    expect(onChange).toHaveBeenCalledWith({
      from: isoDate(now),
      to: isoDate(addDays(now, 7)),
    });
  });

  test("resolves the far-horizon window as All upcoming", () => {
    const now = new Date();
    r(
      <EventsFilters
        query={baseQuery({ to: isoDate(addDays(now, 3650)) })}
        onChange={vi.fn()}
        onRefresh={vi.fn()}
        isRefreshing={false}
      />,
    );
    expect(screen.getByTestId("events-window-select").querySelector("select")).toHaveValue("all");
  });

  test("alpha toggle sets the alpha type list and clears it again", () => {
    const onChange = vi.fn();
    const first = r(
      <EventsFilters
        query={baseQuery()}
        onChange={onChange}
        onRefresh={vi.fn()}
        isRefreshing={false}
      />,
    );
    fireEvent.click(screen.getByTestId("events-alpha-only"));
    expect(onChange).toHaveBeenLastCalledWith({ types: ALPHA_EVENT_TYPES.join(",") });
    first.unmount();

    r(
      <EventsFilters
        query={baseQuery({ types: ALPHA_EVENT_TYPES.join(",") })}
        onChange={onChange}
        onRefresh={vi.fn()}
        isRefreshing={false}
      />,
    );
    fireEvent.click(screen.getByTestId("events-alpha-only"));
    expect(onChange).toHaveBeenLastCalledWith({ types: undefined });
  });

  test("symbol search trims and uppercases on commit", () => {
    const onChange = vi.fn();
    r(
      <EventsFilters
        query={baseQuery()}
        onChange={onChange}
        onRefresh={vi.fn()}
        isRefreshing={false}
      />,
    );
    const input = screen.getByTestId("events-symbols-input");
    fireEvent.input(input, { target: { value: " aapl , msft " } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith({ symbols: "AAPL,MSFT" });
  });

  test("symbol search commits on Enter and clears to undefined", () => {
    const onChange = vi.fn();
    r(
      <EventsFilters
        query={baseQuery({ symbols: "AAPL" })}
        onChange={onChange}
        onRefresh={vi.fn()}
        isRefreshing={false}
      />,
    );
    const input = screen.getByTestId("events-symbols-input");
    fireEvent.input(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith({ symbols: undefined });
  });

  test("refresh button fires onRefresh and reflects the loading flag", () => {
    const onRefresh = vi.fn();
    const first = r(
      <EventsFilters
        query={baseQuery()}
        onChange={vi.fn()}
        onRefresh={onRefresh}
        isRefreshing={false}
      />,
    );
    fireEvent.click(screen.getByTestId("events-refresh"));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    first.unmount();

    r(
      <EventsFilters
        query={baseQuery()}
        onChange={vi.fn()}
        onRefresh={onRefresh}
        isRefreshing
      />,
    );
    expect(screen.getByTestId("events-refresh")).toBeDisabled();
  });
});
