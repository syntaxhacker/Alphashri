// @vitest-environment happy-dom
// Harness first: its vi.mock registrations must run before PatternsPage loads.
import { makeProps, r, resetToolbarHarness, testHooks } from "./PatternsPage.mainHarness";
import { PatternsPage } from "./PatternsPage";

const { afterEach, beforeEach, describe, expect, test, cleanup, fireEvent, screen } = testHooks;

describe("PatternsPage toolbar force refresh and scan cache", () => {
  beforeEach(resetToolbarHarness);
  afterEach(() => cleanup());

  test("Force refresh button calls forceRefresh", async () => {
    const props = makeProps();
    r(() => <PatternsPage {...props} />);
    fireEvent.click(screen.getByTestId("patterns-overflow"));
    fireEvent.click(await screen.findByTestId("patterns-force-refresh"));
    expect(props.forceRefresh).toHaveBeenCalledTimes(1);
  });

  test("Force refresh button is disabled while scanning", async () => {
    r(() => <PatternsPage {...makeProps({ scanning: true })} />);
    fireEvent.click(screen.getByTestId("patterns-overflow"));
    // Overflow items are menu items: the menu signals disabled items via aria-disabled
    // (pointer-events:none blocks real clicks, same as the old button).
    expect(await screen.findByTestId("patterns-force-refresh")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  test("shows the cached chip with age + force re-run when the job was reused", async () => {
    const props = makeProps({
      job: {
        job_id: "cpj_reused",
        universe: "nifty500",
        timeframe: "1D",
        status: "completed" as const,
        total: 500,
        done: 500,
        failed: 0,
        skipped: 0,
        queue_position: null,
        started_at: null,
        finished_at: null,
        data_through: "2026-09-30",
        error: null,
        reused: true,
        reused_from: "cpj_prev",
        reused_age_sec: 720,
        reused_finished_at: null,
      },
      scanning: false,
    });
    r(() => <PatternsPage {...props} />);
    expect(screen.getByTestId("patterns-scan-status")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-scan-reused")).toHaveTextContent("Cached · 12 min ago");
    expect(screen.getByTestId("patterns-job-status")).toHaveTextContent("through 2026-09-30");
    fireEvent.click(screen.getByTestId("patterns-scan-reused-force"));
    expect(props.forceRefresh).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("patterns-overflow"));
    expect(await screen.findByTestId("patterns-force-refresh")).toBeInTheDocument();
  });

  test("reused chip tooltip lists the cache layers", () => {
    r(() => (
      <PatternsPage
        {...makeProps({
          job: {
            job_id: "cpj_reused",
            universe: "nifty500",
            timeframe: "1D",
            status: "completed" as const,
            total: 500,
            done: 500,
            failed: 0,
            skipped: 0,
            queue_position: null,
            started_at: null,
            finished_at: null,
            data_through: "2026-09-30",
            error: null,
            reused: true,
            reused_from: "cpj_prev",
            reused_age_sec: 720,
            reused_finished_at: null,
            provenance: {
              scan_reused: true,
              candles_cached: 480,
              candles_fetched: 20,
              prefilter_dropped: 12,
              detector_version: 3,
              data_through: "2026-09-30",
            },
          },
          scanning: false,
        })}
      />
    ));
    // The wrapper surfaces a string tooltip title as its aria-label.
    expect(screen.getByLabelText(/Scan reused: yes \(12 min ago\)/)).toHaveAttribute(
      "aria-label",
      "Scan reused: yes (12 min ago) — data unchanged · Candle cache: 480 cached / 20 fetched · Prefilter dropped: 12 · Detector v3 · Data as of 2026-09-30",
    );
  });

  test("shows the fresh chip for a freshly computed completed scan", () => {
    r(() => (
      <PatternsPage
        {...makeProps({
          job: {
            job_id: "cpj_fresh",
            universe: "nifty500",
            timeframe: "1D",
            status: "completed" as const,
            total: 500,
            done: 500,
            failed: 0,
            skipped: 0,
            queue_position: null,
            started_at: null,
            finished_at: null,
            data_through: "2026-09-30",
            error: null,
            provenance: {
              scan_reused: false,
              candles_cached: 0,
              candles_fetched: 500,
              prefilter_dropped: 0,
              detector_version: 3,
              data_through: "2026-09-30",
            },
          },
          scanning: false,
        })}
      />
    ));
    expect(screen.getByTestId("patterns-scan-status")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-scan-fresh")).toHaveTextContent("Fresh");
    expect(screen.queryByTestId("patterns-scan-reused")).not.toBeInTheDocument();
    expect(screen.getByTestId("patterns-job-status")).toHaveTextContent("through 2026-09-30");
    expect(
      screen.getByLabelText("Scan reused: no — freshly computed · Candle cache: 0 cached / 500 fetched · Prefilter dropped: 0 · Detector v3 · Data as of 2026-09-30"),
    ).toBeInTheDocument();
  });

  test("shows the mixed cache share when candles were partly cached", () => {
    r(() => (
      <PatternsPage
        {...makeProps({
          job: {
            job_id: "cpj_mixed",
            universe: "nifty500",
            timeframe: "1D",
            status: "completed" as const,
            total: 500,
            done: 500,
            failed: 0,
            skipped: 0,
            queue_position: null,
            started_at: null,
            finished_at: null,
            data_through: "2026-09-30",
            error: null,
            provenance: {
              scan_reused: false,
              candles_cached: 335,
              candles_fetched: 165,
              prefilter_dropped: null,
              detector_version: 3,
              data_through: "2026-09-30",
            },
          },
          scanning: false,
        })}
      />
    ));
    expect(screen.getByTestId("patterns-scan-fresh")).toHaveTextContent("Cache 67%");
    expect(screen.queryByTestId("patterns-scan-reused")).not.toBeInTheDocument();
  });

  test("no cache chip while a scan is active", () => {
    r(() => (
      <PatternsPage
        {...makeProps({
          scanning: true,
          job: {
            job_id: "cpj_run",
            universe: "nifty500",
            timeframe: "1D",
            status: "running" as const,
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
    expect(screen.queryByTestId("patterns-scan-status")).not.toBeInTheDocument();
  });

  test("no reused notice for a freshly computed scan", () => {
    r(() => <PatternsPage {...makeProps()} />);
    expect(screen.queryByTestId("patterns-scan-reused")).not.toBeInTheDocument();
  });
});
