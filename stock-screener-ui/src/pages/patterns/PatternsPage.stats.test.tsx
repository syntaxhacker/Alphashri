// @vitest-environment happy-dom
// Harness first: its vi.mock registrations must run before PatternsPage loads.
import type { JobDTO } from "@/types/chartPatterns";
import { makeProps, r, resetHarness, testHooks } from "./PatternsPage.mainHarness";
import { PatternsPage } from "./PatternsPage";

const { afterEach, beforeEach, describe, expect, test, cleanup, screen } = testHooks;

describe("PatternsPage", () => {
  beforeEach(resetHarness);
  afterEach(() => cleanup());

  test("renders every required stat key", () => {
    r(() => <PatternsPage {...makeProps()} />);
    for (const key of ["scanned", "patterns", "in_view", "confirmed", "bull_bear", "data_through"]) {
      expect(screen.getByTestId(`patterns-stat-${key}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("patterns-stat-bull_bear")).toHaveTextContent("1 / 0");
  });

  test("the stat strip reports live job progress while a scan runs", () => {
    const job: JobDTO = {
      job_id: "cpj_test0002",
      universe: "nifty500",
      timeframe: "1D",
      status: "running",
      total: 49,
      done: 12,
      failed: 0,
      skipped: 0,
      queue_position: null,
      started_at: "2026-10-03T09:15:00Z",
      finished_at: null,
      data_through: null,
      error: null,
    };
    r(() => <PatternsPage {...makeProps({ job })} />);
    expect(screen.getByTestId("patterns-stat-scanned")).toHaveTextContent("12 / 49");
    expect(screen.getByTestId("patterns-stat-last_scan")).toHaveTextContent("running…");
  });
});
