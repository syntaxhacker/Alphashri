// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { UIProvider } from "@/ui";
import type { JobDTO } from "@/types/chartPatterns";
import { ScanProgress } from "./ScanProgress";

function r(ui: React.ReactElement) {
  return render(ui, { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> });
}

function makeJob(overrides: Partial<JobDTO> = {}): JobDTO {
  return {
    job_id: "cpj_test",
    universe: "nifty50",
    timeframe: "1h",
    status: "running",
    total: 50,
    done: 23,
    failed: 0,
    skipped: 0,
    queue_position: null,
    started_at: new Date(Date.now() - 46_000).toISOString(),
    finished_at: null,
    data_through: null,
    error: null,
    ...overrides,
  };
}

afterEach(() => cleanup());

describe("ScanProgress", () => {
  test("renders nothing when idle", () => {
    const { container } = r(<ScanProgress job={null} scanning={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("shows how many stocks are done while scanning", () => {
    r(<ScanProgress job={makeJob()} scanning universe="nifty50" timeframe="1h" />);
    expect(screen.getByTestId("patterns-scan-progress-count")).toHaveTextContent("23 / 50 stocks");
    expect(screen.getByTestId("patterns-scan-progress")).toHaveTextContent("Scanning NIFTY 50 · 1h");
  });

  test("shows a starting state before the total is known", () => {
    r(<ScanProgress job={makeJob({ total: 0, done: 0 })} scanning universe="nifty50" timeframe="1h" />);
    expect(screen.getByTestId("patterns-scan-progress-count")).toHaveTextContent("Starting…");
  });

  test("shows the queue position when queued", () => {
    r(
      <ScanProgress
        job={makeJob({ status: "queued", done: 0, queue_position: 2 })}
        scanning={false}
        universe="nifty50"
        timeframe="1h"
      />,
    );
    const el = screen.getByTestId("patterns-scan-progress");
    expect(el).toHaveTextContent("Queued");
    expect(el).toHaveTextContent("position 2");
  });

  test("renders nothing when the last job finished and no scan is active", () => {
    const { container } = r(
      <ScanProgress job={makeJob({ status: "completed" })} scanning={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test("block variant shows the completion percent alongside done/total", () => {
    r(<ScanProgress job={makeJob()} scanning variant="block" universe="nifty50" timeframe="1h" />);
    // 23/50 → 46%
    expect(screen.getByTestId("patterns-scan-progress-count")).toHaveTextContent("23 / 50 stocks");
    expect(screen.getByTestId("patterns-scan-progress")).toHaveTextContent("46%");
  });

  test("banner variant shows compact done/total and percent", () => {
    r(<ScanProgress job={makeJob()} scanning variant="banner" universe="nifty50" timeframe="1h" />);
    const el = screen.getByTestId("patterns-scan-progress");
    expect(el).toHaveTextContent("Scanning NIFTY 50 · 1h");
    expect(screen.getByTestId("patterns-scan-progress-count")).toHaveTextContent("23/50 stocks · 46%");
  });

  test("inline variant shows a one-line count", () => {
    r(<ScanProgress job={makeJob()} scanning variant="inline" universe="nifty50" timeframe="1h" />);
    expect(screen.getByTestId("patterns-scan-progress")).toHaveTextContent("23 / 50 stocks");
  });

  test("banner variant shows starting state when total is 0", () => {
    r(
      <ScanProgress
        job={makeJob({ total: 0, done: 0 })}
        scanning
        variant="banner"
        universe="nifty50"
        timeframe="1h"
      />,
    );
    expect(screen.getByTestId("patterns-scan-progress-count")).toHaveTextContent("starting…");
  });

  test("inline variant shows starting state when total is 0", () => {
    r(
      <ScanProgress
        job={makeJob({ total: 0, done: 0 })}
        scanning
        variant="inline"
        universe="nifty50"
        timeframe="1h"
      />,
    );
    expect(screen.getByTestId("patterns-scan-progress")).toHaveTextContent("starting…");
  });

  test("formats ETA in seconds", () => {
    vi.useFakeTimers();
    try {
      const now = new Date("2026-10-03T10:00:00Z").getTime();
      vi.setSystemTime(now);
      // elapsed 46s, done 23/50 → 46/23*27 ≈ 54s left
      const startedAt = new Date(now - 46_000).toISOString();
      r(
        <ScanProgress
          job={makeJob({ started_at: startedAt, done: 23, total: 50 })}
          scanning
          variant="inline"
        />,
      );
      expect(screen.getByTestId("patterns-scan-progress")).toHaveTextContent("~54s left");
    } finally {
      vi.useRealTimers();
    }
  });

  test("formats ETA in minutes", () => {
    vi.useFakeTimers();
    try {
      const now = new Date("2026-10-03T10:00:00Z").getTime();
      vi.setSystemTime(now);
      // elapsed 60s, done 25/50 → 60s left → ~1 min left
      const startedAt = new Date(now - 60_000).toISOString();
      r(
        <ScanProgress
          job={makeJob({ started_at: startedAt, done: 25, total: 50 })}
          scanning
          variant="inline"
        />,
      );
      expect(screen.getByTestId("patterns-scan-progress")).toHaveTextContent("~1 min left");
    } finally {
      vi.useRealTimers();
    }
  });

  test("omits ETA before any stock finishes", () => {
    r(<ScanProgress job={makeJob({ total: 0, done: 0 })} scanning variant="inline" />);
    expect(screen.getByTestId("patterns-scan-progress")).not.toHaveTextContent("left");
  });
});
