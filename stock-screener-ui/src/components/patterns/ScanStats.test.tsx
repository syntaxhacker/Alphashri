// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { UIProvider } from "@/ui";
import type { PatternSummary } from "@/types/chartPatterns";
import { ScanStats } from "./ScanStats";

const SUMMARY: PatternSummary = {
  scanned: 500,
  patterns: 12,
  in_view: 8,
  confirmed: 5,
  bullish: 7,
  bearish: 3,
  data_through: "2026-09-30",
};

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> });
}

describe("ScanStats", () => {
  afterEach(() => cleanup());

  test("renders every stat key", () => {
    r(<ScanStats summary={SUMMARY} />);
    const strip = screen.getByTestId("patterns-stats");
    for (const key of ["scanned", "patterns", "in_view", "confirmed", "bull_bear", "data_through"]) {
      expect(within(strip).getByTestId(`patterns-stat-${key}`)).toBeInTheDocument();
    }
  });

  test("formats the bull/bear and data-through values", () => {
    r(<ScanStats summary={SUMMARY} />);
    expect(screen.getByTestId("patterns-stat-bull_bear")).toHaveTextContent("7 / 3");
    expect(screen.getByTestId("patterns-stat-data_through")).toHaveTextContent("2026-09-30");
  });

  test("renders placeholders when summary is null", () => {
    r(<ScanStats summary={null} />);
    expect(screen.getByTestId("patterns-stats")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-stat-scanned")).toHaveTextContent("—");
    expect(screen.getByTestId("patterns-stat-data_through")).toHaveTextContent("—");
    expect(screen.getByTestId("patterns-stat-last_scan")).toHaveTextContent("—");
  });

  test("shows the relative age of the last scan", () => {
    const twelveMinAgo = new Date(Date.now() - 12 * 60_000).toISOString();
    r(<ScanStats summary={{ ...SUMMARY, last_scan_at: twelveMinAgo }} />);
    expect(screen.getByTestId("patterns-stat-last_scan")).toHaveTextContent("12 min ago");
  });

  test("shows 'just now' for a fresh scan and placeholders for a missing one", () => {
    r(<ScanStats summary={{ ...SUMMARY, last_scan_at: new Date().toISOString() }} />);
    expect(screen.getByTestId("patterns-stat-last_scan")).toHaveTextContent("just now");
    cleanup();
    r(<ScanStats summary={{ ...SUMMARY, last_scan_at: null }} />);
    expect(screen.getByTestId("patterns-stat-last_scan")).toHaveTextContent("—");
  });

  test("refreshes the relative age on a 60s interval without store updates", () => {
    vi.useFakeTimers();
    try {
      const base = Date.now();
      vi.setSystemTime(base - 61_000);
      const stamp = new Date().toISOString();
      vi.setSystemTime(base);
      r(<ScanStats summary={{ ...SUMMARY, last_scan_at: stamp }} />);
      expect(screen.getByTestId("patterns-stat-last_scan")).toHaveTextContent("1 min ago");

      // A minute passes with no prop change — the tick re-renders the age.
      // (advanceTimersByTime also moves the mocked clock forward.)
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(screen.getByTestId("patterns-stat-last_scan")).toHaveTextContent("2 min ago");
    } finally {
      vi.useRealTimers();
    }
  });

  test("renders a dash for every stat when summary is null", () => {
    r(<ScanStats summary={null} />);
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
    r(<ScanStats summary={{ ...SUMMARY, data_through: "2026-10-01 (delayed)" }} />);
    expect(screen.getByTestId("patterns-stat-data_through")).toHaveTextContent(
      "2026-10-01 (delayed)",
    );
  });

  test("formats large counts with en-IN grouping", () => {
    r(<ScanStats summary={{ ...SUMMARY, scanned: 9700, patterns: 123456 }} />);
    expect(screen.getByTestId("patterns-stat-scanned")).toHaveTextContent("9,700");
    expect(screen.getByTestId("patterns-stat-patterns")).toHaveTextContent("1,23,456");
  });

  test("shows hour and day granularity for the last scan age", () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 3_600_000).toISOString();
    r(<ScanStats summary={{ ...SUMMARY, last_scan_at: threeHoursAgo }} />);
    expect(screen.getByTestId("patterns-stat-last_scan")).toHaveTextContent("3 h ago");
    cleanup();
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
    r(<ScanStats summary={{ ...SUMMARY, last_scan_at: twoDaysAgo }} />);
    expect(screen.getByTestId("patterns-stat-last_scan")).toHaveTextContent("2 d ago");
  });
});
