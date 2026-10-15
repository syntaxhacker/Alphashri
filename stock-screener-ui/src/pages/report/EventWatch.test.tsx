// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { EventWatch } from "./EventWatch";
import { fetchRecentEvents, fetchUpcomingEvents } from "../../api/eventWatch";
import { copyToClipboard } from "../../utils/copyCsv";
import { UIProvider } from "@/ui";

vi.mock("../../api/eventWatch", () => ({
  fetchUpcomingEvents: vi.fn(),
  fetchRecentEvents: vi.fn(),
}));

vi.mock("../../utils/copyCsv", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/copyCsv")>();
  return { ...actual, copyToClipboard: vi.fn().mockResolvedValue(true) };
});

const mockUpcoming = {
  as_of: "2026-10-11T10:00:00+05:30",
  events: [
    { date: "2026-10-13", symbol: "RELIANCE", name: "Reliance Industries", kind: "results", title: "Q2 results", source: "nse" },
    { date: "2026-10-13", symbol: "INFY", name: "Infosys", kind: "dividend", title: "Interim dividend", source: "nse" },
    { date: "2026-10-14", symbol: "TCS", name: "TCS Ltd", kind: "results", title: "Q2 results", source: "nse" },
  ],
};

const mockRecent = {
  as_of: "2026-10-11T10:00:00+05:30",
  events: [
    { date: "2026-10-10", symbol: "HDFCBANK", name: "HDFC Bank", kind: "upgrade", title: "Broker upgrade", source: "news" },
    { date: "2026-10-09", symbol: "LT", name: "L&T", kind: "order", title: "Wins ₹5K Cr order", source: "news" },
  ],
};

const mockDaily = {
  date: "2026-10-11",
  universe: "nifty500",
  as_of: "2026-10-11T10:00:00+05:30",
  cached: false,
  breadth: {
    total: 1, advances: 1, declines: 0, unchanged: 0, new_highs: 0,
    new_lows: 0, avg_change: 1, median_change: 1, up_volume: 1, down_volume: 0,
  },
  moves: {
    gainers: [
      { symbol: "RELIANCE", name: "Reliance Industries", close: 2850.5, change: 3.2, sub_value: "2.5x vol", price_52_week_high: 3000 },
    ],
    volume_surge: [
      { symbol: "RELIANCE", name: "Reliance Industries", close: 2850.5, change: 3.2, sub_value: "2.5x vol", price_52_week_high: 3000 },
    ],
  },
};

function mockOk() {
  vi.mocked(fetchUpcomingEvents).mockResolvedValue(mockUpcoming as never);
  vi.mocked(fetchRecentEvents).mockResolvedValue(mockRecent as never);
}

function renderWatch(props?: { onOpenSymbol?: (s: string) => void; daily?: unknown }) {
  return render(
    <UIProvider>
      <EventWatch universe="nifty500" daily={(props?.daily ?? mockDaily) as never} onOpenSymbol={props?.onOpenSymbol} />
    </UIProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOk();
});

afterEach(() => {
  cleanup();
});

describe("EventWatch", () => {
  it("renders upcoming and recent sections with rows", async () => {
    renderWatch();
    await waitFor(() => expect(screen.getByTestId("event-watch")).toBeInTheDocument());
    expect(screen.getByTestId("event-watch-upcoming")).toBeInTheDocument();
    expect(screen.getByTestId("event-watch-recent")).toBeInTheDocument();
    expect(screen.getByTestId("event-watch-upcoming-row-RELIANCE-results")).toBeInTheDocument();
    expect(screen.getByTestId("event-watch-recent-row-HDFCBANK-upgrade")).toBeInTheDocument();
    // date-grouped upcoming list
    expect(screen.getByTestId("event-watch-upcoming-group-2026-10-13")).toBeInTheDocument();
    expect(screen.getByTestId("event-watch-upcoming-group-2026-10-14")).toBeInTheDocument();
    // technical snapshot beside the row (price from daily payload)
    expect(screen.getByTestId("event-watch-upcoming-row-RELIANCE-results")).toHaveTextContent("₹2850.50");
  });

  it("filters rows by kind chip with counts", async () => {
    const user = userEvent.setup();
    renderWatch();
    await screen.findByTestId("event-watch-upcoming-row-RELIANCE-results");
    expect(screen.getByTestId("event-watch-filter-results")).toHaveTextContent("Results (2)");
    await user.click(screen.getByTestId("event-watch-filter-results"));
    expect(screen.getByTestId("event-watch-upcoming-row-RELIANCE-results")).toBeInTheDocument();
    expect(screen.queryByTestId("event-watch-upcoming-row-INFY-dividend")).not.toBeInTheDocument();
    expect(screen.queryByTestId("event-watch-recent-row-HDFCBANK-upgrade")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("event-watch-filter-all"));
    expect(screen.getByTestId("event-watch-upcoming-row-INFY-dividend")).toBeInTheDocument();
  });

  it("row click calls onOpenSymbol", async () => {
    const user = userEvent.setup();
    const onOpenSymbol = vi.fn();
    renderWatch({ onOpenSymbol });
    await screen.findByTestId("event-watch-recent-row-LT-order");
    await user.click(screen.getByTestId("event-watch-recent-row-LT-order"));
    expect(onOpenSymbol).toHaveBeenCalledWith("LT");
  });

  it("tolerates absent endpoints by showing the section that loads", async () => {
    vi.mocked(fetchUpcomingEvents).mockResolvedValue(null);
    renderWatch();
    await waitFor(() => expect(screen.getByTestId("event-watch")).toBeInTheDocument());
    expect(screen.queryByTestId("event-watch-upcoming")).not.toBeInTheDocument();
    expect(screen.getByTestId("event-watch-recent-row-HDFCBANK-upgrade")).toBeInTheDocument();
  });

  it("renders nothing when both endpoints are absent", async () => {
    vi.mocked(fetchUpcomingEvents).mockResolvedValue(null);
    vi.mocked(fetchRecentEvents).mockResolvedValue(null);
    renderWatch();
    await waitFor(() => expect(vi.mocked(fetchRecentEvents)).toHaveBeenCalled());
    // allow effects to settle
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("event-watch")).not.toBeInTheDocument();
  });

  it("shows loading then per-section error without hiding the other section", async () => {
    vi.mocked(fetchUpcomingEvents).mockImplementation(() => new Promise(() => {}));
    vi.mocked(fetchRecentEvents).mockImplementation(() => new Promise(() => {}));
    renderWatch();
    expect(screen.getByTestId("event-watch-loading")).toBeInTheDocument();
    cleanup();

    vi.mocked(fetchUpcomingEvents).mockRejectedValue(new Error("upcoming boom"));
    vi.mocked(fetchRecentEvents).mockResolvedValue(mockRecent as never);
    renderWatch();
    await waitFor(() => expect(screen.getByTestId("event-watch-upcoming-error")).toBeInTheDocument());
    expect(screen.getByTestId("event-watch-upcoming-error")).toHaveTextContent("upcoming boom");
    expect(screen.getByTestId("event-watch-recent-row-HDFCBANK-upgrade")).toBeInTheDocument();
  });

  it("copies the row symbol via the per-row copy button", async () => {
    const user = userEvent.setup();
    renderWatch();
    await screen.findByTestId("event-watch-upcoming-row-RELIANCE-results");
    const copyBtn = screen.getByTestId("event-watch-upcoming-row-RELIANCE-results-copy");
    expect(copyBtn).toHaveTextContent("Copy");
    await user.click(copyBtn);
    await waitFor(() => expect(copyToClipboard).toHaveBeenCalledWith("RELIANCE"));
    expect(screen.getByTestId("event-watch-upcoming-row-RELIANCE-results-copy")).toHaveTextContent("Copied!");
  });

  it("copies recent-row symbols with a distinct testid", async () => {
    const user = userEvent.setup();
    renderWatch();
    await screen.findByTestId("event-watch-recent-row-LT-order");
    await user.click(screen.getByTestId("event-watch-recent-row-LT-order-copy"));
    await waitFor(() => expect(copyToClipboard).toHaveBeenCalledWith("LT"));
  });
});
