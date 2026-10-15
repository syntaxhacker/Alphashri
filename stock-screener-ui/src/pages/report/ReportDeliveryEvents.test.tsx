// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ReportDeliveryStrip } from "./ReportDeliveryStrip";
import { ReportEventsStrip } from "./ReportEventsStrip";
import { UIProvider } from "@/ui";

const deliveryData = {
  date: "2026-10-09",
  universe: "nifty500",
  as_of: "2026-10-09T18:00:00+05:30",
  cached: false,
  source: "nse-bhavcopy",
  rows: [
    { symbol: "RELIANCE", delivery_qty: 65000, delivery_pct: 65.0, traded_qty: 100000, close: 1515.5 },
    { symbol: "TCS", delivery_qty: 10000, delivery_pct: 20.0, traded_qty: 50000, close: 4106.0 },
  ],
};

const eventsData = {
  from: "2026-10-11",
  to: "2026-11-01",
  as_of: "2026-10-11T10:00:00+05:30",
  cached: false,
  events: [
    { date: "2026-10-16", symbol: "RELIANCE", kind: "results" as const, title: "Results on 2026-10-16 (est EPS 12.3)" },
    { date: "2026-10-20", symbol: "TCS", kind: "dividend" as const, title: "Ex-dividend 2026-10-20" },
  ],
  symbols_covered: 2,
  symbols_total: 2,
};

function renderStrip(ui: React.ReactElement) {
  return render(<UIProvider>{ui}</UIProvider>);
}

describe("ReportDeliveryStrip", () => {
  it("renders rows with delivery % in tabular nums", () => {
    renderStrip(<ReportDeliveryStrip data={deliveryData} loading={false} error={null} />);
    expect(screen.getByTestId("report-delivery-strip")).toBeInTheDocument();
    expect(screen.getByTestId("report-delivery-row-RELIANCE")).toHaveTextContent("65.00%");
    expect(screen.getByTestId("report-delivery-row-TCS")).toHaveTextContent("20.00%");
    expect(screen.getByTestId("report-delivery-date")).toHaveTextContent("2026-10-09");
    cleanup();
  });

  it("shows loading and error states", () => {
    renderStrip(<ReportDeliveryStrip data={null} loading error={null} />);
    expect(screen.getByTestId("report-delivery-loading")).toBeInTheDocument();
    cleanup();
    renderStrip(<ReportDeliveryStrip data={null} loading={false} error="boom" />);
    expect(screen.getByTestId("report-delivery-error-alert")).toHaveTextContent("boom");
    cleanup();
  });

  it("renders nothing when there are no rows", () => {
    const { container } = renderStrip(<ReportDeliveryStrip data={{ ...deliveryData, rows: [] }} loading={false} error={null} />);
    expect(container.firstChild).toBeNull();
    cleanup();
  });

  it("opens the symbol on click", async () => {
    const onOpen = vi.fn();
    const { default: userEvent } = await import("@testing-library/user-event");
    renderStrip(<ReportDeliveryStrip data={deliveryData} loading={false} error={null} onOpenSymbol={onOpen} />);
    await userEvent.click(screen.getByTestId("report-delivery-row-RELIANCE"));
    expect(onOpen).toHaveBeenCalledWith("RELIANCE");
    cleanup();
  });
});

describe("ReportEventsStrip", () => {
  it("renders events with kind badges", () => {
    renderStrip(<ReportEventsStrip data={eventsData} loading={false} error={null} />);
    expect(screen.getByTestId("report-events-strip")).toBeInTheDocument();
    expect(screen.getByTestId("report-events-row-RELIANCE-results")).toHaveTextContent("est EPS 12.3");
    expect(screen.getByTestId("report-events-row-TCS-dividend")).toHaveTextContent("Ex-dividend");
    expect(screen.getByTestId("report-events-count")).toHaveTextContent("2");
    cleanup();
  });

  it("shows loading and error states", () => {
    renderStrip(<ReportEventsStrip data={null} loading error={null} />);
    expect(screen.getByTestId("report-events-loading")).toBeInTheDocument();
    cleanup();
    renderStrip(<ReportEventsStrip data={null} loading={false} error="boom" />);
    expect(screen.getByTestId("report-events-error-alert")).toHaveTextContent("boom");
    cleanup();
  });

  it("renders nothing when there are no events", () => {
    const { container } = renderStrip(<ReportEventsStrip data={{ ...eventsData, events: [] }} loading={false} error={null} />);
    expect(container.firstChild).toBeNull();
    cleanup();
  });
});
