// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test } from "vitest";
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
});
