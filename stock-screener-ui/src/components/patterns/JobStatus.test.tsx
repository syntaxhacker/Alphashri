// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { UIProvider } from "@/ui";
import type { JobDTO } from "@/types/chartPatterns";
import { JobStatus } from "./JobStatus";

const JOB: JobDTO = {
  job_id: "cpj_abc",
  universe: "nifty500",
  timeframe: "1D",
  status: "running",
  total: 500,
  done: 210,
  failed: 3,
  skipped: 40,
  queue_position: null,
  started_at: "2026-10-03T09:00:00",
  finished_at: null,
  data_through: null,
  error: null,
};

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> });
}

describe("JobStatus", () => {
  afterEach(() => cleanup());

  test("always renders the contract testid when idle", () => {
    r(<JobStatus job={null} queuePosition={null} scanning={false} />);
    expect(screen.getByTestId("patterns-job-status")).toBeInTheDocument();
    expect(screen.getByText(/Idle/i)).toBeInTheDocument();
  });

  test("shows progress and failure/skip counts while running", () => {
    r(<JobStatus job={JOB} queuePosition={null} scanning />);
    expect(screen.getByTestId("patterns-job-status")).toHaveTextContent("Scanning 210/500");
    expect(screen.getByTestId("patterns-job-status")).toHaveTextContent("3 failed");
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  test("shows the bounded-queue position when queued", () => {
    r(
      <JobStatus
        job={{ ...JOB, status: "queued", queue_position: 2, total: 0, done: 0 }}
        queuePosition={2}
        scanning={false}
      />,
    );
    expect(screen.getByTestId("patterns-job-status")).toHaveTextContent("position 2");
  });

  test("reports the last completed scan", () => {
    r(
      <JobStatus
        job={{ ...JOB, status: "completed", data_through: "2026-09-30" }}
        queuePosition={null}
        scanning={false}
      />,
    );
    expect(screen.getByTestId("patterns-job-status")).toHaveTextContent("through 2026-09-30");
  });
});
