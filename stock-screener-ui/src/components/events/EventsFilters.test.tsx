// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import { isoDate } from "../../state/events";
import type { EventsQuery } from "../../types/events";
import { ALPHA_EVENT_TYPES, EventsFilters } from "./EventsFilters";

// Native <select> keeps option selection deterministic under happy-dom.
vi.mock("@/ui", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Select: ({ value, onChange, data = [], "data-testid": testId }: any) => (
      <select
        data-testid={testId}
        value={value ?? ""}
        onChange={(e) => onChange?.(e.target.value)}
      >
        {(data as Array<{ value: string; label: string }>).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    ),
  };
});

function r(jsx: React.ReactElement) {
  return render(<UIProvider>{jsx}</UIProvider>);
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

afterEach(cleanup);

describe("EventsFilters", () => {
  test("changing the market emits the matching EventMarket", async () => {
    const onChange = vi.fn();
    r(
      <EventsFilters
        query={baseQuery()}
        onChange={onChange}
        onRefresh={vi.fn()}
        isRefreshing={false}
      />,
    );
    await userEvent.selectOptions(screen.getByTestId("events-market-select"), "india");
    expect(onChange).toHaveBeenCalledWith({ market: "india" });
  });

  test("changing the window rewrites from/to through isoDate", async () => {
    const onChange = vi.fn();
    r(
      <EventsFilters
        query={baseQuery()}
        onChange={onChange}
        onRefresh={vi.fn()}
        isRefreshing={false}
      />,
    );
    await userEvent.selectOptions(screen.getByTestId("events-window-select"), "7");
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
    expect(screen.getByTestId("events-window-select")).toHaveValue("all");
  });

  test("alpha toggle sets the alpha type list and clears it again", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = r(
      <EventsFilters
        query={baseQuery()}
        onChange={onChange}
        onRefresh={vi.fn()}
        isRefreshing={false}
      />,
    );
    await user.click(screen.getByTestId("events-alpha-only"));
    expect(onChange).toHaveBeenLastCalledWith({ types: ALPHA_EVENT_TYPES.join(",") });

    rerender(
      <UIProvider>
        <EventsFilters
          query={baseQuery({ types: ALPHA_EVENT_TYPES.join(",") })}
          onChange={onChange}
          onRefresh={vi.fn()}
          isRefreshing={false}
        />
      </UIProvider>,
    );
    await user.click(screen.getByTestId("events-alpha-only"));
    expect(onChange).toHaveBeenLastCalledWith({ types: undefined });
  });

  test("symbol search trims and uppercases on commit", async () => {
    const user = userEvent.setup();
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
    await user.type(input, " aapl , msft ");
    await user.tab();
    expect(onChange).toHaveBeenCalledWith({ symbols: "AAPL,MSFT" });
  });

  test("symbol search commits on Enter and clears to undefined", async () => {
    const user = userEvent.setup();
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
    await user.clear(input);
    await user.type(input, "{Enter}");
    expect(onChange).toHaveBeenCalledWith({ symbols: undefined });
  });

  test("refresh button fires onRefresh and reflects the loading flag", async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    const { rerender } = r(
      <EventsFilters
        query={baseQuery()}
        onChange={vi.fn()}
        onRefresh={onRefresh}
        isRefreshing={false}
      />,
    );
    await user.click(screen.getByTestId("events-refresh"));
    expect(onRefresh).toHaveBeenCalledTimes(1);

    rerender(
      <UIProvider>
        <EventsFilters
          query={baseQuery()}
          onChange={vi.fn()}
          onRefresh={onRefresh}
          isRefreshing
        />
      </UIProvider>,
    );
    expect(screen.getByTestId("events-refresh")).toBeDisabled();
  });
});
