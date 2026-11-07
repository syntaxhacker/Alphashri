// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import { isoDate } from "../../state/events";
import type { AnomaliesResponse, EventDTO } from "../../types/events";
import type { UseEventsResult } from "../../hooks/useEvents";

const mocks = vi.hoisted(() => ({ useEvents: vi.fn() }));

vi.mock("../../hooks/useEvents", () => ({ useEvents: mocks.useEvents }));

import { EventsPanel } from "./EventsPanel";

const EVENTS_DIR = join(process.cwd(), "src", "components", "events");

function makeEvent(overrides: Partial<EventDTO> = {}): EventDTO {
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
    source_url: null,
    confidence: 0.9,
    recurring: true,
    notes: null,
    days_until: 3,
    is_alpha: true,
    ...overrides,
  };
}

const EVENTS: EventDTO[] = [
  makeEvent(),
  makeEvent({
    id: "evt-2",
    symbol: "MSFT",
    event_type: "earnings",
    title: "Microsoft Q1 Results",
    is_alpha: false,
    days_until: 10,
  }),
  makeEvent({ id: "evt-3", symbol: "NVDA", event_type: "guidance", title: "Nvidia Guidance Update" }),
];

const ANOMALIES: AnomaliesResponse = {
  anomalies: [
    {
      symbol: "AAPL",
      ts: "2026-10-29T10:31:00+05:30",
      price: 245.5,
      ret_pct: -2.4,
      ret_sigma: -3.1,
      vol_ratio: 2.8,
      has_known_event: false,
      suspected: null,
      exchange: "NASDAQ",
    },
  ],
  meta: {
    as_of: "2026-10-29T11:00:00+05:30",
    date: "2026-10-29",
    scanned: 120,
    thresholds: { ret_sigma: 3, vol_mult: 2, min_abs_ret: 1, cooldown_min: 30 },
    warnings: [],
  },
};

function makeResult(overrides: Partial<UseEventsResult> = {}): UseEventsResult {
  return {
    data: null,
    events: EVENTS,
    anomalies: null,
    meta: null,
    isLoading: false,
    isRefreshing: false,
    error: null,
    lastUpdated: "2026-10-29T10:00:00+05:30",
    refresh: vi.fn(),
    setQuery: vi.fn(),
    loadAnomalies: vi.fn(),
    ...overrides,
  };
}

function r(jsx: React.ReactElement) {
  return render(<UIProvider>{jsx}</UIProvider>);
}

beforeEach(() => {
  mocks.useEvents.mockReset();
  mocks.useEvents.mockReturnValue(makeResult());
});

afterEach(cleanup);

describe("EventsPanel", () => {
  test("renders the panel and its rows", () => {
    r(<EventsPanel />);
    expect(screen.getByTestId("events-panel")).toBeInTheDocument();
    expect(screen.getByText("Corporate Events")).toBeInTheDocument();
    expect(screen.getByTestId("events-table")).toBeInTheDocument();
    for (const event of EVENTS) {
      expect(screen.getByTestId(`event-row-${event.id}`)).toBeInTheDocument();
    }
  });

  test("loads today's anomalies on mount", () => {
    const result = makeResult();
    mocks.useEvents.mockReturnValue(result);
    r(<EventsPanel />);
    expect(result.loadAnomalies).toHaveBeenCalledWith(isoDate(new Date()));
  });

  test("prints the refresh time as a clock time, with the raw instant in the tooltip", () => {
    // `meta.as_of` is a full ISO instant; the label is a freshness hint, not a
    // record, so it must not print "2026-10-29T10:00:00+05:30" verbatim.
    r(<EventsPanel />);
    const label = screen.getByTestId("events-last-updated");
    expect(label.textContent).toMatch(/^updated \d{2}:\d{2}$/);
    expect(label).toHaveAttribute("title", "2026-10-29T10:00:00+05:30");
  });

  test("shows the error state instead of the table", () => {
    mocks.useEvents.mockReturnValue(
      makeResult({
        events: [],
        error: new Error("Could not load the event calendar. Events request failed (HTTP 503)"),
      }),
    );
    r(<EventsPanel />);
    expect(screen.getByTestId("events-error")).toBeInTheDocument();
    expect(screen.getByText(/Could not load the event calendar/)).toBeInTheDocument();
    expect(screen.queryByTestId("events-table")).not.toBeInTheDocument();
  });

  test("hides the anomalies strip when there are no anomalies", () => {
    r(<EventsPanel />);
    expect(screen.queryByTestId("events-anomalies")).not.toBeInTheDocument();
  });

  test("shows the anomalies strip when anomalies exist", () => {
    mocks.useEvents.mockReturnValue(makeResult({ anomalies: ANOMALIES }));
    r(<EventsPanel />);
    expect(screen.getByTestId("events-anomalies")).toBeInTheDocument();
    expect(screen.getByTestId("events-anomaly-AAPL")).toBeInTheDocument();
    expect(screen.getByText("-2.40%")).toBeInTheDocument();
  });

  test("clicking a row opens the detail drawer", async () => {
    const user = userEvent.setup();
    r(<EventsPanel />);
    expect(screen.queryByTestId("event-detail-drawer")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("event-row-evt-1"));
    expect(screen.getByTestId("event-detail-drawer")).toBeInTheDocument();
    expect(screen.getByTestId("event-detail-title")).toHaveTextContent("Apple Investor Day");
  });

  test("uses no Mantine `styles` prop anywhere in the feature", () => {
    const offenders = readdirSync(EVENTS_DIR)
      .filter((file) => file.endsWith(".tsx") && !file.includes(".test."))
      .filter((file) => /styles=\{\{/.test(readFileSync(join(EVENTS_DIR, file), "utf8")));
    expect(offenders).toEqual([]);
  });
});
