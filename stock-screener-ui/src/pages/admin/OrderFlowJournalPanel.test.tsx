// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "../../test/test-utils";
import {
  OrderFlowJournalPanel,
  BROKER_BADGE,
  coverageTone,
  describeGap,
  formatBytes,
} from "./OrderFlowJournalPanel";
import type { OrderFlowJournalRow, OrderFlowJournalSummary } from "../../types/admin";

const fetchWithAuthMock = vi.fn();

vi.mock("../../components/auth/AuthProvider2", () => ({
  useAuth: () => ({ fetchWithAuth: fetchWithAuthMock }),
}));

function row(overrides: Partial<OrderFlowJournalRow> = {}): OrderFlowJournalRow {
  return {
    symbol: "RELIANCE",
    file: "RELIANCE_2026-09-17.jsonl",
    broker: "fyers_tbt",
    named_broker: "fyers_tbt",
    broker_mismatch: false,
    brokers_seen: ["fyers_tbt"],
    bytes: 26 * 1048576,
    records: 5485,
    ticks: 5485,
    signals: 0,
    first_ts: 1,
    last_ts: 2,
    covered_minutes: 49,
    coverage_pct: 13.1,
    gaps: [{ from: "09:15", to: "13:36", minutes: 261 }],
    ...overrides,
  };
}

function summary(overrides: Partial<OrderFlowJournalSummary> = {}): OrderFlowJournalSummary {
  return {
    day: "2026-09-17",
    session_start: "09:15",
    session_close: "15:30",
    session_minutes: 375,
    rows: [row()],
    total_bytes: 122 * 1048576,
    total_records: 25817,
    overall_coverage_pct: 13.1,
    available_days: ["2026-09-17", "2026-09-16"],
    broker_available: true,
    fetched_at: "2026-09-17T14:00:00Z",
    ...overrides,
  };
}

function mockResponse(body: unknown, ok = true) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(body),
  } as Response);
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchWithAuthMock.mockImplementation(() => mockResponse(summary()));
});

describe("OrderFlowJournalPanel", () => {
  it("renders one row per symbol with broker, size, records and coverage", async () => {
    renderWithProviders(<OrderFlowJournalPanel />);

    expect(await screen.findByTestId("orderflow-journal-table")).toBeInTheDocument();
    expect(screen.getByText("RELIANCE")).toBeInTheDocument();
    expect(screen.getByTestId("ofj-broker-fyers_tbt")).toHaveTextContent("Fyers TBT");
    expect(screen.getAllByTestId("ofj-coverage")[0]).toHaveTextContent("13.1%");
    expect(screen.getByText("26.0 MB")).toBeInTheDocument();
    expect(screen.getByText("5,485")).toBeInTheDocument();
  });

  it("shows the worst gap so a partial session is obvious", async () => {
    renderWithProviders(<OrderFlowJournalPanel />);
    expect(await screen.findByText(/09:15 → 13:36 \(261m\)/)).toBeInTheDocument();
  });

  it("flags a file that mixes two feeds", async () => {
    fetchWithAuthMock.mockImplementation(() =>
      mockResponse(summary({ rows: [row({ broker: "mixed", brokers_seen: ["fyers_tbt", "upstox"] })] })),
    );
    renderWithProviders(<OrderFlowJournalPanel />);

    const badge = await screen.findByTestId("ofj-broker-mixed");
    expect(badge).toHaveTextContent("MIXED");
  });

  it("reports overall coverage for the day", async () => {
    renderWithProviders(<OrderFlowJournalPanel />);
    // "13.1%" appears in both the summary stat and the row, so assert on the
    // unique session hint and the stat label instead.
    expect(await screen.findByText(/09:15–15:30 · 375 min/)).toBeInTheDocument();
    expect(screen.getByText("Session coverage")).toBeInTheDocument();
    expect(screen.getAllByText("13.1%").length).toBeGreaterThan(0);
  });

  it("reloads when the day changes", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    renderWithProviders(<OrderFlowJournalPanel />);
    await screen.findByTestId("orderflow-journal-table");

    await user.click(within(screen.getByTestId("ofj-day-select")).getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "2026-09-16" }));

    await waitFor(() =>
      expect(fetchWithAuthMock).toHaveBeenCalledWith(
        expect.stringContaining("day=2026-09-16"),
      ),
    );
  });

  it("surfaces a backend error", async () => {
    fetchWithAuthMock.mockImplementation(() => mockResponse({ detail: "journal scan failed" }, false));
    renderWithProviders(<OrderFlowJournalPanel />);
    expect(await screen.findByTestId("ofj-error")).toHaveTextContent("journal scan failed");
  });

  it("shows an empty message for a day with no data", async () => {
    fetchWithAuthMock.mockImplementation(() =>
      mockResponse(summary({ rows: [], total_bytes: 0, total_records: 0, overall_coverage_pct: 0 })),
    );
    renderWithProviders(<OrderFlowJournalPanel />);
    expect(await screen.findByText("No journal data for this day")).toBeInTheDocument();
  });
});

describe("orderflow journal helpers", () => {
  it("formats bytes across units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(26 * 1048576)).toBe("26.0 MB");
    expect(formatBytes(2 * 1024 * 1048576)).toBe("2.00 GB");
  });

  it("tones coverage so a half-captured day does not look fine", () => {
    expect(coverageTone(99)).toBe("success");
    expect(coverageTone(70)).toBe("text.secondary");
    expect(coverageTone(13)).toBe("warning");
    expect(coverageTone(0)).toBe("error");
  });

  it("describes the worst gap, or a dash when there is none", () => {
    expect(describeGap(row())).toBe("09:15 → 13:36 (261m)");
    expect(describeGap(row({ gaps: [] }))).toBe("—");
  });

  it("labels every broker shape including mixed", () => {
    expect(BROKER_BADGE.fyers_tbt.label).toContain("50 lv");
    expect(BROKER_BADGE.upstox.label).toContain("5 lv");
    expect(BROKER_BADGE.mixed.label).toMatch(/MIXED/);
  });
});

describe("OrderFlowJournalPanel broker-name verification", () => {
  it("flags a file whose name promises one feed but holds another", async () => {
    fetchWithAuthMock.mockImplementation(() =>
      mockResponse(
        summary({
          rows: [
            row({ broker: "upstox", named_broker: "fyers_tbt", broker_mismatch: true }),
          ],
        }),
      ),
    );
    renderWithProviders(<OrderFlowJournalPanel />);

    const flag = await screen.findByTestId("ofj-broker-mismatch");
    expect(flag).toHaveTextContent("name says fyers_tbt");
    // the content badge still tells the truth about what is inside
    expect(screen.getByTestId("ofj-broker-upstox")).toHaveTextContent("Upstox");
  });

  it("does not flag a correctly named file", async () => {
    fetchWithAuthMock.mockImplementation(() =>
      mockResponse(summary({ rows: [row({ broker: "fyers_tbt", named_broker: "fyers_tbt" })] })),
    );
    renderWithProviders(<OrderFlowJournalPanel />);

    await screen.findByTestId("ofj-broker-fyers_tbt");
    expect(screen.queryByTestId("ofj-broker-mismatch")).not.toBeInTheDocument();
  });
});
