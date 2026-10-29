// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import type { EventDTO } from "../../types/events";
import { EventsTable } from "./EventsTable";
import { buildEventColumns } from "./eventsColumns";

function r(jsx: React.ReactElement) {
  return render(<UIProvider>{jsx}</UIProvider>);
}

afterEach(cleanup);

export function makeEvent(overrides: Partial<EventDTO> = {}): EventDTO {
  return {
    id: "evt-1",
    symbol: "AAPL",
    event_type: "investor_day",
    title: "Apple Investor Day",
    event_date: "2026-10-28",
    source: "ir",
    exchange: "NASDAQ",
    name: "Apple Inc.",
    announced_at: "2026-10-20",
    source_url: "https://example.com/aapl-investor-day",
    confidence: 0.9,
    recurring: true,
    notes: "Guidance update expected.",
    days_until: 3,
    is_alpha: true,
    ...overrides,
  };
}

const FIXTURE: EventDTO[] = [
  makeEvent({ id: "evt-today", symbol: "AAPL", days_until: 0 }),
  makeEvent({
    id: "evt-soon",
    symbol: "MSFT",
    event_type: "earnings",
    title: "Microsoft Q1 Results",
    days_until: 3,
    is_alpha: false,
    announced_at: null,
  }),
  makeEvent({
    id: "evt-past",
    symbol: "NVDA",
    event_type: "guidance",
    title: "Nvidia Guidance Update",
    days_until: -3,
  }),
];

describe("EventsTable", () => {
  test("renders a row per event", () => {
    r(<EventsTable events={FIXTURE} isLoading={false} onOpen={vi.fn()} />);
    expect(screen.getByTestId("events-table")).toBeInTheDocument();
    for (const id of ["evt-today", "evt-soon", "evt-past"]) {
      expect(screen.getByTestId(`event-row-${id}`)).toBeInTheDocument();
    }
    expect(within(screen.getByTestId("event-row-evt-today")).getByText("AAPL")).toBeInTheDocument();
  });

  test("renders formatted dates, lead times and the dashed announced date", () => {
    r(<EventsTable events={FIXTURE} isLoading={false} onOpen={vi.fn()} />);
    expect(screen.getByTestId("event-date-evt-today")).toHaveTextContent("Oct 28");
    expect(screen.getByTestId("event-days-evt-today")).toHaveTextContent("today");
    expect(screen.getByTestId("event-days-evt-soon")).toHaveTextContent("in 3d");
    expect(screen.getByTestId("event-days-evt-past")).toHaveTextContent("3d ago");
    expect(screen.getByTestId("event-announced-evt-soon")).toHaveTextContent("—");
  });

  test("every column declares an explicit alignment", () => {
    const columns = buildEventColumns(vi.fn());
    const alignOf = (id: string): string => {
      const column = columns.find((c) => c.id === id);
      expect(column, `column ${id} exists`).toBeDefined();
      return (column?.meta as { align?: string } | undefined)?.align ?? "MISSING";
    };
    expect(alignOf("symbol")).toBe("left");
    expect(alignOf("title")).toBe("left");
    expect(alignOf("event_type")).toBe("center");
    expect(alignOf("event_date")).toBe("center");
    expect(alignOf("announced_at")).toBe("center");
    expect(alignOf("source")).toBe("center");
    expect(alignOf("days_until")).toBe("right");
    expect(alignOf("actions")).toBe("center");
    for (const column of columns) {
      expect((column.meta as { align?: string } | undefined)?.align).toBeTruthy();
    }
  });

  test("clicking a row opens that event", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    r(<EventsTable events={FIXTURE} isLoading={false} onOpen={onOpen} />);
    await user.click(screen.getByTestId("event-row-evt-soon"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(FIXTURE[1]);
  });

  test("the trailing action opens the event without double-firing", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    r(<EventsTable events={FIXTURE} isLoading={false} onOpen={onOpen} />);
    await user.click(screen.getByTestId("event-open-evt-past"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(FIXTURE[2]);
  });

  test("shows the shared empty state when there are no events", () => {
    r(<EventsTable events={[]} isLoading={false} onOpen={vi.fn()} />);
    expect(screen.getByTestId("events-empty")).toBeInTheDocument();
    expect(screen.getByText("No events in this window.")).toBeInTheDocument();
  });

  test("shows skeleton rows while the first load is in flight", () => {
    r(<EventsTable events={[]} isLoading onOpen={vi.fn()} />);
    expect(screen.getByTestId("events-loading")).toBeInTheDocument();
    expect(screen.getAllByTestId("events-skeleton-row").length).toBeGreaterThan(0);
  });
});
