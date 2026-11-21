import { createRoot } from "solid-js";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { NiftyReplayMeta } from "@/api/reportNifty";
import type { NiftyReport } from "@/types/niftyReport";
import { REPLAY_STUB_REPORT } from "./niftyReplay";

const { showErrorMock } = vi.hoisted(() => ({ showErrorMock: vi.fn() }));
vi.mock("@/ui/notifications", () => ({ showError: showErrorMock }));

vi.mock(import("@/utils/marketClock"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    isDerivativesOpenIst: () => true,
  };
});

vi.mock("@/api/holidays_api", () => ({
  fetchHolidayCheck: vi.fn().mockResolvedValue({ is_holiday: false }),
}));

vi.mock("@/api/paperTrading", () => ({
  fetchPositions: vi.fn().mockResolvedValue([]),
}));

vi.mock("./niftyStreamSolid", () => ({
  useNiftyReportStream: () => ({
    report: () => null,
    tape: () => null,
    sensex: () => null,
    connected: () => false,
  }),
  useNiftyBurstStream: () => undefined,
  useNiftySpotTick: () => () => null,
}));

vi.mock("@/api/reportNifty", () => ({
  fetchLiveNifty: vi.fn(),
  fetchLiveSensex: vi.fn().mockResolvedValue(null),
  fetchNiftyByDate: vi.fn(),
  fetchNiftyExpiries: vi.fn(),
  fetchNiftyReplay: vi.fn().mockResolvedValue(null),
  fetchNiftyReplayMeta: vi.fn().mockResolvedValue(null),
  fetchNiftyReplayFrame: vi.fn().mockResolvedValue(null),
  fetchNiftyReplayDates: vi.fn().mockResolvedValue([]),
  fetchNiftyTape: vi.fn().mockResolvedValue(null),
  fetchNiftyBursts: vi.fn().mockResolvedValue([]),
  fetchBreadth: vi.fn().mockResolvedValue(null),
  fetchChain10sSummary: vi.fn().mockResolvedValue([]),
  fetchNiftyBlasts: vi.fn().mockResolvedValue([]),
  fetchSpotBlasts: vi.fn().mockResolvedValue([]),
  fetchOptionsLive: vi.fn().mockResolvedValue(null),
  fetchOptionsLiveCandles: vi.fn().mockResolvedValue({ intraday: [] }),
  fetchOptionsTape: vi.fn().mockResolvedValue(null),
  fetchOptionsBursts: vi.fn().mockResolvedValue([]),
  fetchOptionsChain10s: vi.fn().mockResolvedValue([]),
  fetchOptionsBlasts: vi.fn().mockResolvedValue([]),
  fetchOptionsReplay: vi.fn().mockResolvedValue(null),
  fetchOptionsReplayDates: vi.fn().mockResolvedValue([]),
  fetchOptionsReplayFrame: vi.fn().mockResolvedValue(null),
  fetchOptionsReplayMeta: vi.fn().mockResolvedValue(null),
  fetchOptionsSnapshot: vi.fn().mockResolvedValue(null),
  fetchOptionsExpiries: vi.fn().mockResolvedValue([]),
  fetchOptionsWalls: vi.fn().mockResolvedValue(null),
  snapshotNifty: vi.fn(),
}));

import * as api from "@/api/reportNifty";
import {
  createNiftyReportStore,
  GENERIC_POLL_MS,
  startNiftyReportEffects,
} from "./niftyReportStore";
import type { NiftyReportStore } from "./niftyReportStore";

function liveReport(): NiftyReport {
  return {
    mode: "live",
    date: "2026-11-20",
    expiry: "2026-11-27",
    spot: 24_512.4,
    pcrOi: 1.02,
    pcrVol: 0.94,
    maxPain: 24_500,
    walls: { calls: [], puts: [] },
    strikes: [],
    timeline: [],
    intraday: [],
    candles: [],
    market: { is_open: true },
  } as unknown as NiftyReport;
}

function build(): { store: NiftyReportStore; dispose: () => void } {
  let store!: NiftyReportStore;
  let dispose!: () => void;
  createRoot((disposeRoot) => {
    dispose = disposeRoot;
    store = createNiftyReportStore();
    startNiftyReportEffects(store);
  });
  return { store, dispose };
}

beforeEach(() => {
  vi.clearAllMocks();
  showErrorMock.mockClear();
  vi.mocked(api.fetchLiveSensex).mockResolvedValue(
    null as unknown as Awaited<ReturnType<typeof api.fetchLiveSensex>>,
  );
  vi.mocked(api.fetchNiftyExpiries).mockResolvedValue([
    { date: "2026-11-27" },
    { date: "2026-12-04" },
  ] as Awaited<ReturnType<typeof api.fetchNiftyExpiries>>);
  vi.mocked(api.fetchLiveNifty).mockResolvedValue(liveReport());
  vi.mocked(api.fetchNiftyReplayDates).mockResolvedValue([]);
  vi.mocked(api.fetchNiftyBursts).mockResolvedValue([]);
  vi.mocked(api.fetchNiftyTape).mockResolvedValue(
    null as unknown as Awaited<ReturnType<typeof api.fetchNiftyTape>>,
  );
});

describe("createNiftyReportStore", () => {
  test("builds inside a root and exposes the selection surface", () => {
    const { store, dispose } = build();

    expect(store.data.report()).toBeNull();
    expect(store.data.loading()).toBe(false);
    expect(store.data.error()).toBeNull();
    expect(store.data.snapshotting()).toBe(false);
    expect(store.data.freshness.marketClosed()).toBe(false);
    expect(store.data.freshness.isStale()).toBe(false);
    expect(store.data.metrics()).toBeNull();
    expect(store.data.atmStrike()).toBeNull();
    expect(store.data.tapeRows()).toEqual([]);
    expect(store.walls.data()).toBeNull();

    expect(store.selection.symbol()).toBe("NIFTY");
    expect(store.selection.index()).toBe("nifty");
    expect(store.selection.mode()).toBe("live");
    expect(store.selection.expiry()).toBe("nearest");
    expect(store.selection.date()).toBe("");
    expect(store.selection.historyDates()).toEqual([]);
    expect(store.selection.hasRecordedHistory()).toBe(true);
    expect(store.selection.contextKey()).toBe("live:nearest");

    store.selection.setDate("2026-11-20");
    store.selection.setMode("eod");
    expect(store.selection.date()).toBe("2026-11-20");
    expect(store.selection.mode()).toBe("eod");
    expect(store.selection.contextKey()).toBe("eod:2026-11-20");

    store.selection.setExpiry("2026-12-04");
    expect(store.selection.expiry()).toBe("2026-12-04");
    expect(store.selection.expiryData()[0]).toEqual({ value: "nearest", label: "Nearest expiry" });

    store.selection.handleIndexChange("sensex");
    expect(store.selection.index()).toBe("sensex");
    expect(store.ui.view()).toBe("chart");

    store.ui.setView("depth");
    expect(store.ui.view()).toBe("depth");

    expect(store.ui.deskMode()).toBe("desk");
    store.ui.toggleDeskMode();
    expect(store.ui.deskMode()).toBe("research");
    expect(store.ui.isDesk()).toBe(false);
    store.ui.handleDeskChange("desk");
    expect(store.ui.deskMode()).toBe("desk");

    store.ui.setChartTf("5m");
    store.ui.handleChartTf("15m");
    expect(store.ui.chartTf()).toBe("15m");

    store.ui.setSideTab("heatmap");
    expect(store.ui.sideTab()).toBe("heatmap");

    store.ui.openPlanReasons();
    expect(store.ui.planOpen()).toBe(true);
    store.ui.closeTopModal();
    expect(store.ui.planOpen()).toBe(false);

    store.ui.openMovers();
    expect(store.ui.overlayOpen("movers")).toBe(true);
    store.ui.closeMovers();
    expect(store.ui.moversOpen()).toBe(false);

    store.alerts.toggleCriticalOnly();
    expect(store.alerts.criticalOnly()).toBe(true);

    expect(store.replay.replay()).toBeNull();
    store.replay.scrub(4);
    expect(store.replay.index()).toBe(0);
    expect(store.replay.frameT()).toBeNull();
    expect(store.replay.coverage()).toBeNull();
    expect(store.replay.holes()).toBe(0);

    dispose();
  });

  test("mocked expiries and report populate expiryOptions and data.report", async () => {
    const { store, dispose } = build();

    await vi.waitFor(() => {
      expect(store.selection.expiryOptions()).toEqual(["2026-11-27", "2026-12-04"]);
    });

    expect(store.selection.expiryData()).toEqual([
      { value: "nearest", label: "Nearest expiry" },
      { value: "2026-11-27", label: "2026-11-27" },
      { value: "2026-12-04", label: "2026-12-04" },
    ]);

    await vi.waitFor(() => {
      expect(store.data.report()).not.toBeNull();
    });

    expect(store.data.booted()).toBe(true);
    expect(store.selection.mode()).toBe("live");
    expect(store.data.report()?.spot).toBe(24_512.4);
    expect(store.data.loading()).toBe(false);
    expect(store.data.error()).toBeNull();
    expect(store.data.metrics()).not.toBeNull();
    expect(api.fetchLiveNifty).toHaveBeenCalledTimes(1);

    dispose();
  });

  test("live Upstox auth failure falls back to EOD with one actionable toast", async () => {
    vi.mocked(api.fetchLiveNifty).mockRejectedValue(
      new Error(
        "Upstox access token not configured. Go to Settings to connect your Upstox account.",
      ),
    );
    vi.mocked(api.fetchNiftyReplayDates).mockResolvedValue(["2026-11-19"]);
    vi.mocked(api.fetchNiftyByDate).mockResolvedValue(liveReport());

    const { store, dispose } = build();

    await vi.waitFor(() => {
      expect(store.selection.mode()).toBe("eod");
    });

    expect(store.selection.date()).toBe("2026-11-19");
    expect(showErrorMock).toHaveBeenCalledTimes(1);
    expect(String(showErrorMock.mock.calls[0]?.[1])).toContain("Settings → Brokers");
    expect(store.data.error()).toBeNull();

    dispose();
  });

  test("switching symbol clears the previous report and forces live", async () => {
    const { store, dispose } = build();

    await vi.waitFor(() => {
      expect(store.data.report()).not.toBeNull();
    });

    store.selection.setMode("eod");
    store.selection.setDate("2026-11-14");
    store.selection.handleSymbolChange("SENSEX");

    expect(store.selection.symbol()).toBe("SENSEX");
    expect(store.selection.mode()).toBe("live");
    expect(store.selection.date()).toBe("");
    expect(store.selection.expiry()).toBe("nearest");
    expect(store.selection.index()).toBe("nifty");
    expect(store.data.report()).toBeNull();

    dispose();
  });

  test("switching symbol starts and keeps one generic live load", async () => {
    const { store, dispose } = build();

    await vi.waitFor(() => {
      expect(store.data.report()).not.toBeNull();
    });

    vi.mocked(api.fetchOptionsLive).mockResolvedValue(liveReport());
    store.selection.handleSymbolChange("SENSEX");

    await vi.waitFor(() => {
      expect(api.fetchOptionsLive).toHaveBeenCalled();
    });
    expect(vi.mocked(api.fetchOptionsLive).mock.calls.at(-1)?.[0]).toBe("SENSEX");

    await vi.waitFor(() => {
      expect(store.data.report()).not.toBeNull();
    });

    dispose();
  });

  test("refresh re-runs the one-shot load", async () => {
    const { store, dispose } = build();

    await vi.waitFor(() => {
      expect(store.data.report()).not.toBeNull();
    });

    store.data.refresh();

    await vi.waitFor(() => {
      expect(api.fetchLiveNifty).toHaveBeenCalledTimes(2);
    });

    dispose();
  });

  test("generic poll keeps the last candle series when the chain frame has none", async () => {
    vi.useFakeTimers();
    try {
      const withBars = {
        ...liveReport(),
        intraday: [
          {
            time: "2026-11-19T09:15:00+05:30",
            open: 100,
            high: 101,
            low: 99,
            close: 100.5,
          },
        ],
      } as NiftyReport;
      vi.mocked(api.fetchOptionsLive).mockResolvedValueOnce(withBars);
      vi.mocked(api.fetchOptionsTape).mockResolvedValue(
        null as unknown as Awaited<ReturnType<typeof api.fetchOptionsTape>>,
      );
      vi.mocked(api.fetchOptionsBursts).mockResolvedValue([]);
      vi.mocked(api.fetchOptionsReplayDates).mockResolvedValue([]);
      vi.mocked(api.fetchOptionsExpiries).mockResolvedValue([]);

      const { store, dispose } = build();
      store.selection.handleSymbolChange("SENSEX");
      await vi.advanceTimersByTimeAsync(0);

      expect(store.data.report()?.intraday).toHaveLength(1);

      vi.mocked(api.fetchOptionsLive).mockResolvedValue(liveReport());
      await vi.advanceTimersByTimeAsync(GENERIC_POLL_MS);

      expect(api.fetchOptionsLive).toHaveBeenCalledTimes(2);
      expect(store.data.report()?.intraday).toHaveLength(1);

      dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  test("generic live poll skips a tick while the initial load is in flight", async () => {
    vi.useFakeTimers();
    try {
      let resolveLive!: (report: NiftyReport) => void;
      const livePending = new Promise<NiftyReport>((resolve) => {
        resolveLive = resolve;
      });
      vi.mocked(api.fetchOptionsLive).mockReturnValue(livePending);
      vi.mocked(api.fetchOptionsTape).mockResolvedValue(
        null as unknown as Awaited<ReturnType<typeof api.fetchOptionsTape>>,
      );
      vi.mocked(api.fetchOptionsBursts).mockResolvedValue([]);
      vi.mocked(api.fetchOptionsReplayDates).mockResolvedValue([]);
      vi.mocked(api.fetchOptionsExpiries).mockResolvedValue([]);

      const { store, dispose } = build();
      // Select the generic symbol before bootstrap finishes so the pending
      // load is the generic triple, not the NIFTY one-shot path.
      store.selection.handleSymbolChange("SENSEX");

      // Bootstrap sets booted() -> true: the generic load starts (deferred) and
      // the first poll tick is armed for +GENERIC_POLL_MS.
      await vi.advanceTimersByTimeAsync(0);

      // fetchOptionsLive/fetchOptionsTape only run inside load()/runPoll(), so
      // they mark a full triple (bursts also has an independent 30s poll).
      const expectSingleTriple = () => {
        expect(api.fetchOptionsLive).toHaveBeenCalledTimes(1);
        expect(api.fetchOptionsTape).toHaveBeenCalledTimes(1);
      };
      expectSingleTriple();

      // Poll tick lands while load() is still in flight — it must not launch a
      // second live/tape/bursts triple.
      await vi.advanceTimersByTimeAsync(GENERIC_POLL_MS);
      expectSingleTriple();
      expect(store.data.loading()).toBe(true);

      // Resolving the load lets the re-armed poll tick run a fresh triple.
      resolveLive(liveReport());
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(GENERIC_POLL_MS);

      expect(api.fetchOptionsLive).toHaveBeenCalledTimes(2);
      expect(api.fetchOptionsTape).toHaveBeenCalledTimes(2);

      dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  test("EOD replay meta maps frames with the shared stub report identity", async () => {
    const meta: NiftyReplayMeta = {
      date: "2026-11-18",
      count: 99,
      interval_sec: 30,
      gap_reasons: { timeout: 4 },
      frames: [
        { t: "2026-11-18T10:00:00+05:30", spot: 24_500 },
        { t: "2026-11-18T10:01:00+05:30", spot: 24_510 },
      ],
    };
    vi.mocked(api.fetchNiftyReplayMeta).mockResolvedValue(meta);
    vi.mocked(api.fetchNiftyReplayFrame).mockResolvedValue(null);
    vi.mocked(api.fetchNiftyByDate).mockResolvedValue(liveReport());

    let store!: NiftyReportStore;
    let dispose!: () => void;
    createRoot((disposeRoot) => {
      dispose = disposeRoot;
      store = createNiftyReportStore();
      store.selection.setMode("eod");
      store.selection.setDate(meta.date);
      startNiftyReportEffects(store);
    });

    await vi.waitFor(() => {
      expect(store.replay.replay()).not.toBeNull();
    });
    const replay = store.replay.replay()!;
    expect(replay.date).toBe(meta.date);
    expect(replay.count).toBe(2);
    expect(replay.interval_sec).toBe(30);
    expect(replay.gap_reasons).toEqual({ timeout: 4 });
    expect(replay.snapshots.map((frame) => frame.t)).toEqual(meta.frames.map((f) => f.t));
    expect(replay.snapshots.every((frame) => frame.fetched_at === "" && frame.sensex === null)).toBe(
      true,
    );
    expect(replay.snapshots.every((frame) => frame.report === REPLAY_STUB_REPORT)).toBe(true);

    dispose();
  });
});
