// @vitest-environment happy-dom
// Harness first: its vi.mock registrations must run before PatternsPage loads.
import { makeProps, r, resetHarness, testHooks } from "./PatternsPage.appliedHarness";
import { PatternsPage } from "./PatternsPage";

const { afterEach, beforeEach, describe, expect, test, cleanup, fireEvent, screen } = testHooks;

describe("PatternsPage busy + empty surfaces", () => {
  beforeEach(resetHarness);
  afterEach(() => cleanup());

  test("scan banner stays above the results while a scan runs with results", async () => {
    r(() =>
      <PatternsPage
        {...makeProps({
          scanning: true,
          job: {
            job_id: "cpj_banner",
            universe: "nifty500",
            timeframe: "1D",
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
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    // Banner variant (compact count, no spaces around the slash) + grid kept.
    expect(screen.getByTestId("patterns-scan-progress")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-scan-progress-count")).toHaveTextContent("12/50 stocks");
    expect(screen.getByTestId("patterns-grid")).toBeInTheDocument();
    expect(screen.queryByTestId("patterns-empty")).not.toBeInTheDocument();
    expect(screen.queryByTestId("patterns-loading")).not.toBeInTheDocument();
  });

  test("loading with no results and no active scan shows the card skeleton", () => {
    r(() => <PatternsPage {...makeProps({ loading: true, results: [], total: 0 })} />);
    expect(screen.getByTestId("patterns-loading")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-skeleton-grid")).toBeInTheDocument();
    expect(screen.getAllByTestId("patterns-skeleton-card")).toHaveLength(8);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("patterns-grid")).not.toBeInTheDocument();
  });
});
