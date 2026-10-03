// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
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
});
