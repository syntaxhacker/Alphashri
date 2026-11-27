// @vitest-environment happy-dom
// Harness first: its vi.mock registrations must run before PatternsPage loads.
import { makeProps, r, resetHarness, testHooks } from "./PatternsPage.mainHarness";
import { PatternsPage } from "./PatternsPage";

const { afterEach, beforeEach, describe, expect, test, cleanup, screen } = testHooks;

describe("PatternsPage loading states", () => {
  beforeEach(resetHarness);
  afterEach(() => cleanup());

  test("shows loading state", () => {
    r(() => <PatternsPage {...makeProps({ loading: true, results: [], total: 0 })} />);
    expect(screen.getByTestId("patterns-loading")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-skeleton-grid")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("patterns-empty")).not.toBeInTheDocument();
  });

  test("shows scan progress in the grid while a scan is running", () => {
    r(() => (
      <PatternsPage
        {...makeProps({
          results: [],
          total: 0,
          scanning: true,
          timeframe: "1h",
          job: {
            job_id: "cpj_x",
            universe: "nifty50",
            timeframe: "1h",
            status: "running",
            total: 50,
            done: 12,
            failed: 0,
            skipped: 0,
            queue_position: null,
            started_at: null,
            finished_at: null,
            data_through: null,
            error: null,
          },
        })}
      />
    ));
    expect(screen.getByTestId("patterns-scan-progress")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-scan-progress-count")).toHaveTextContent("12 / 50 stocks");
  });

  test("keeps the list mounted and shows a non-blocking refresh chip", async () => {
    r(() => <PatternsPage {...makeProps({ loading: true })} />);
    // Existing results stay visible (no remount churn)…
    expect(screen.getByTestId("patterns-list")).toBeInTheDocument();
    expect(screen.queryByTestId("patterns-loading")).not.toBeInTheDocument();
    const chip = await screen.findByTestId("patterns-refreshing", {}, { timeout: 1000 });
    expect(chip).toBeInTheDocument();
  });
});
