import { createRoot } from "solid-js";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { NiftyReport } from "@/types/niftyReport";

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
import { createNiftyReportStore, startNiftyReportEffects } from "./niftyReportStore";
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
});
