// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import type { JobDTO } from "@/types/chartPatterns";
import { ScanProgress, ScanCacheChip, getScanCacheState } from "./ScanProgress";

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

  test("shows the reused notice when the job reused a previous scan", () => {
    r(
      <ScanProgress
        job={makeJob({ status: "completed", reused: true, reused_age_sec: 720 })}
        scanning={false}
      />,
    );
    const notice = screen.getByTestId("patterns-scan-reused");
    expect(notice).toHaveTextContent("Reused scan from 12 min ago");
    expect(notice).toHaveTextContent("data unchanged");
    expect(notice).toHaveTextContent("Force to re-run");
  });

  test("reused notice falls back when no age signal is available", () => {
    r(<ScanProgress job={makeJob({ status: "completed", reused: true })} scanning={false} />);
    expect(screen.getByTestId("patterns-scan-reused")).toHaveTextContent(
      "Reused scan — data unchanged",
    );
  });

  test("reused notice derives the age from reused_finished_at", () => {
    vi.useFakeTimers();
    try {
      const now = new Date("2026-10-03T10:00:00Z").getTime();
      vi.setSystemTime(now);
      const finishedAt = new Date(now - 12 * 60_000).toISOString();
      r(
        <ScanProgress
          job={makeJob({ status: "completed", reused: true, reused_finished_at: finishedAt })}
          scanning={false}
        />,
      );
      expect(screen.getByTestId("patterns-scan-reused")).toHaveTextContent(
        "Reused scan from 12 min ago",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  test("reused notice renders the force action when a handler is provided", () => {
    const onForceRefresh = vi.fn();
    r(
      <ScanProgress
        job={makeJob({ status: "completed", reused: true, reused_age_sec: 60 })}
        scanning={false}
        onForceRefresh={onForceRefresh}
      />,
    );
    expect(screen.getByTestId("patterns-scan-reused-force")).toBeInTheDocument();
  });
});

describe("getScanCacheState", () => {
  test("fresh when provenance shows a full recompute with no cached candles", () => {
    const job = makeJob({
      status: "completed",
      provenance: {
        scan_reused: false,
        candles_cached: 0,
        candles_fetched: 500,
        prefilter_dropped: 0,
        detector_version: 3,
        data_through: "2026-09-30",
      },
    });
    expect(getScanCacheState(job)).toEqual({ kind: "fresh", pct: null, age: null });
  });

  test("fresh without provenance (older backend, non-reused job)", () => {
    expect(getScanCacheState(makeJob({ status: "completed" }))).toEqual({
      kind: "fresh",
      pct: null,
      age: null,
    });
  });

  test("reused wins over any candle counts", () => {
    const job = makeJob({
      status: "completed",
      reused: true,
      reused_age_sec: 720,
      provenance: {
        scan_reused: true,
        candles_cached: 480,
        candles_fetched: 20,
        prefilter_dropped: 12,
        detector_version: 3,
        data_through: "2026-09-30",
      },
    });
    expect(getScanCacheState(job)).toEqual({ kind: "reused", pct: null, age: "12 min ago" });
  });

  test("reused via provenance alone even when the flag is absent", () => {
    const job = makeJob({
      status: "completed",
      provenance: {
        scan_reused: true,
        candles_cached: 500,
        candles_fetched: 0,
        prefilter_dropped: null,
        detector_version: 3,
        data_through: null,
      },
    });
    const cache = getScanCacheState(job);
    expect(cache.kind).toBe("reused");
    expect(cache.age).toBeNull();
  });

  test("mixed reports the rounded cache-hit share", () => {
    const job = makeJob({
      status: "completed",
      provenance: {
        scan_reused: false,
        candles_cached: 335,
        candles_fetched: 165,
        prefilter_dropped: null,
        detector_version: 3,
        data_through: "2026-09-30",
      },
    });
    expect(getScanCacheState(job)).toEqual({ kind: "mixed", pct: 67, age: null });
  });
});

describe("ScanCacheChip", () => {
  test("renders nothing without a job", () => {
    const { container } = r(<ScanCacheChip job={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("fresh chip for a fully computed scan", () => {
    r(
      <ScanCacheChip
        job={makeJob({
          status: "completed",
          provenance: {
            scan_reused: false,
            candles_cached: 0,
            candles_fetched: 500,
            prefilter_dropped: 0,
            detector_version: 3,
            data_through: "2026-09-30",
          },
        })}
      />,
    );
    expect(screen.getByTestId("patterns-scan-status")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-scan-fresh")).toHaveTextContent("Fresh");
    expect(screen.queryByTestId("patterns-scan-reused")).not.toBeInTheDocument();
    expect(screen.queryByTestId("patterns-scan-reused-force")).not.toBeInTheDocument();
  });

  test("cached chip with age keeps the reused testid when reused", () => {
    r(<ScanCacheChip job={makeJob({ status: "completed", reused: true, reused_age_sec: 720 })} />);
    expect(screen.getByTestId("patterns-scan-status")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-scan-reused")).toHaveTextContent("Cached · 12 min ago");
  });

  test("cached chip without an age signal still labels the reuse", () => {
    r(<ScanCacheChip job={makeJob({ status: "completed", reused: true })} />);
    expect(screen.getByTestId("patterns-scan-reused")).toHaveTextContent("Cached");
  });

  test("mixed chip shows the cache-hit percent", () => {
    r(
      <ScanCacheChip
        job={makeJob({
          status: "completed",
          provenance: {
            scan_reused: false,
            candles_cached: 1,
            candles_fetched: 3,
            prefilter_dropped: null,
            detector_version: 3,
            data_through: null,
          },
        })}
      />,
    );
    expect(screen.getByTestId("patterns-scan-fresh")).toHaveTextContent("Cache 25%");
  });

  test("force re-run action calls the handler when reused", async () => {
    const onForceRefresh = vi.fn();
    r(
      <ScanCacheChip
        job={makeJob({ status: "completed", reused: true, reused_age_sec: 60 })}
        onForceRefresh={onForceRefresh}
      />,
    );
    await userEvent.click(screen.getByTestId("patterns-scan-reused-force"));
    expect(onForceRefresh).toHaveBeenCalledTimes(1);
  });

  test("tooltip exposes the cache layers as its accessible label", () => {
    r(
      <ScanCacheChip
        job={makeJob({
          status: "completed",
          reused: true,
          reused_age_sec: 720,
          data_through: "2026-09-30",
          provenance: {
            scan_reused: true,
            candles_cached: 480,
            candles_fetched: 20,
            prefilter_dropped: 12,
            detector_version: 3,
            data_through: "2026-09-30",
          },
        })}
      />,
    );
    // MUI surfaces a string tooltip title as the wrapper's aria-label.
    expect(screen.getByLabelText(/Scan reused: yes \(12 min ago\)/)).toHaveAttribute(
      "aria-label",
      "Scan reused: yes (12 min ago) — data unchanged · Candle cache: 480 cached / 20 fetched · Prefilter dropped: 12 · Detector v3 · Data as of 2026-09-30",
    );
  });

  test("tooltip degrades gracefully without provenance", () => {
    r(<ScanCacheChip job={makeJob({ status: "completed", data_through: "2026-09-30" })} />);
    expect(screen.getByLabelText("Scan reused: no — freshly computed · Data as of 2026-09-30")).toBeInTheDocument();
  });
});
