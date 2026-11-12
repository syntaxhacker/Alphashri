// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, within } from "@solidjs/testing-library";
import type { JobDTO, PatternSummary } from "@/types/chartPatterns";
import { ScanStats } from "./ScanStats";

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/patterns/solidUiMock");
  return mockSolidUi();
});

const SUMMARY: PatternSummary = {
  scanned: 500,
  patterns: 12,
  in_view: 8,
  confirmed: 5,
  bullish: 7,
  bearish: 3,
  data_through: "2026-09-30",
};

function makeJob(overrides: Partial<JobDTO> = {}): JobDTO {
  return {
    job_id: "cpj_1",
    universe: "all_equity",
    timeframe: "1D",
    status: "running",
    total: 1081,
    done: 360,
    failed: 0,
    skipped: 0,
    queue_position: null,
    started_at: "2026-10-01T04:00:00Z",
    finished_at: null,
    data_through: null,
    error: null,
    ...overrides,
  };
}

describe("ScanStats", () => {
  afterEach(() => cleanup());

  test("renders every stat key", () => {
    render(() => <ScanStats summary={SUMMARY} />);
    const strip = screen.getByTestId("patterns-stats");
    for (const key of ["scanned", "patterns", "in_view", "confirmed", "bull_bear", "data_through"]) {
      expect(within(strip).getByTestId(`patterns-stat-${key}`)).toBeInTheDocument();
    }
  });

  test("formats the bull/bear and data-through values", () => {
    render(() => <ScanStats summary={SUMMARY} />);
    expect(screen.getByTestId("patterns-stat-bull_bear")).toHaveTextContent("7 / 3");
    expect(screen.getByTestId("patterns-stat-data_through")).toHaveTextContent("2026-09-30");
  });

  test("renders placeholders when summary is null", () => {
    render(() => <ScanStats summary={null} />);
    expect(screen.getByTestId("patterns-stats")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-stat-scanned")).toHaveTextContent("—");
    expect(screen.getByTestId("patterns-stat-data_through")).toHaveTextContent("—");
    expect(screen.getByTestId("patterns-stat-last_scan")).toHaveTextContent("—");
  });

  test("shows the relative age of the last scan", () => {
    const twelveMinAgo = new Date(Date.now() - 12 * 60_000).toISOString();
    render(() => <ScanStats summary={{ ...SUMMARY, last_scan_at: twelveMinAgo }} />);
    expect(screen.getByTestId("patterns-stat-last_scan")).toHaveTextContent("12 min ago");
  });

  test("shows 'just now' for a fresh scan and placeholders for a missing one", () => {
    render(() => <ScanStats summary={{ ...SUMMARY, last_scan_at: new Date().toISOString() }} />);
    expect(screen.getByTestId("patterns-stat-last_scan")).toHaveTextContent("just now");
    cleanup();
    render(() => <ScanStats summary={{ ...SUMMARY, last_scan_at: null }} />);
    expect(screen.getByTestId("patterns-stat-last_scan")).toHaveTextContent("—");
  });

  test("refreshes the relative age on a 60s interval without store updates", () => {
    vi.useFakeTimers();
    try {
      const base = Date.now();
      vi.setSystemTime(base - 61_000);
      const stamp = new Date().toISOString();
      vi.setSystemTime(base);
      render(() => <ScanStats summary={{ ...SUMMARY, last_scan_at: stamp }} />);
      expect(screen.getByTestId("patterns-stat-last_scan")).toHaveTextContent("1 min ago");

      // A minute passes with no prop change — the tick re-renders the age.
      // (advanceTimersByTime also moves the mocked clock forward.)
      vi.advanceTimersByTime(60_000);
      expect(screen.getByTestId("patterns-stat-last_scan")).toHaveTextContent("2 min ago");
    } finally {
      vi.useRealTimers();
    }
  });

  test("renders a dash for every stat when summary is null", () => {
    render(() => <ScanStats summary={null} />);
    for (const key of [
      "scanned",
      "patterns",
      "in_view",
      "confirmed",
      "bull_bear",
      "data_through",
      "last_scan",
    ]) {
      expect(screen.getByTestId(`patterns-stat-${key}`)).toHaveTextContent("—");
    }
  });

  test("renders a custom data_through value verbatim", () => {
    render(() => <ScanStats summary={{ ...SUMMARY, data_through: "2026-10-01 (delayed)" }} />);
    expect(screen.getByTestId("patterns-stat-data_through")).toHaveTextContent(
      "2026-10-01 (delayed)",
    );
  });

  test("formats large counts with en-IN grouping", () => {
    render(() => <ScanStats summary={{ ...SUMMARY, scanned: 9700, patterns: 123456 }} />);
    expect(screen.getByTestId("patterns-stat-scanned")).toHaveTextContent("9,700");
    expect(screen.getByTestId("patterns-stat-patterns")).toHaveTextContent("1,23,456");
  });

  test("shows hour and day granularity for the last scan age", () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 3_600_000).toISOString();
    render(() => <ScanStats summary={{ ...SUMMARY, last_scan_at: threeHoursAgo }} />);
    expect(screen.getByTestId("patterns-stat-last_scan")).toHaveTextContent("3 h ago");
    cleanup();
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
    render(() => <ScanStats summary={{ ...SUMMARY, last_scan_at: twoDaysAgo }} />);
    expect(screen.getByTestId("patterns-stat-last_scan")).toHaveTextContent("2 d ago");
  });

  test("a running job reports live progress instead of the last completed scan", () => {
    render(() => <ScanStats summary={{ ...SUMMARY, last_scan_at: "2026-10-01T00:00:00Z" }} job={makeJob()} />);
    expect(screen.getByTestId("patterns-stat-scanned")).toHaveTextContent("360 / 1,081");
    expect(screen.getByTestId("patterns-stat-last_scan")).toHaveTextContent("running…");
    // Non-progress cells still come from the summary.
    expect(screen.getByTestId("patterns-stat-confirmed")).toHaveTextContent("5");
  });

  test("a running job with no total falls back to the summary count", () => {
    render(() => <ScanStats summary={SUMMARY} job={makeJob({ total: 0, done: 0 })} />);
    expect(screen.getByTestId("patterns-stat-scanned")).toHaveTextContent("500");
  });

  test("a queued job shows its queue position", () => {
    render(() =>       <ScanStats
        summary={SUMMARY}
        job={makeJob({ status: "queued", queue_position: 3, done: 0 })}
      />);
    expect(screen.getByTestId("patterns-stat-last_scan")).toHaveTextContent("queued #3");
  });

  test("a queued job without a queue position shows plain 'queued'", () => {
    render(() =>       <ScanStats
        summary={SUMMARY}
        job={makeJob({ status: "queued", queue_position: null, done: 0 })}
      />);
    expect(screen.getByTestId("patterns-stat-last_scan")).toHaveTextContent("queued");
    expect(screen.getByTestId("patterns-stat-last_scan")).not.toHaveTextContent("#");
  });

  test("a running job prefers its own data_through", () => {
    render(() =>       <ScanStats
        summary={SUMMARY}
        job={makeJob({ data_through: "2026-10-02" })}
      />);
    expect(screen.getByTestId("patterns-stat-data_through")).toHaveTextContent("2026-10-02");
    cleanup();
    render(() => <ScanStats summary={SUMMARY} job={makeJob({ data_through: null })} />);
    expect(screen.getByTestId("patterns-stat-data_through")).toHaveTextContent("2026-09-30");
  });

  test("a completed job keeps the summary behavior", () => {
    const twelveMinAgo = new Date(Date.now() - 12 * 60_000).toISOString();
    render(() =>       <ScanStats
        summary={{ ...SUMMARY, last_scan_at: twelveMinAgo }}
        job={makeJob({ status: "completed", finished_at: new Date().toISOString() })}
      />);
    expect(screen.getByTestId("patterns-stat-scanned")).toHaveTextContent("500");
    expect(screen.getByTestId("patterns-stat-last_scan")).toHaveTextContent("12 min ago");
  });
});
