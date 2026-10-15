// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  CHAIN_POLL_INTERVAL_MS,
  CHAIN_STALE_AFTER_MS,
  getChainLiveState,
} from "./useChainLivePolling";

describe("getChainLiveState", () => {
  const now = new Date("2026-05-09T10:30:00Z").getTime();

  it("reports LIVE for a fresh timestamp", () => {
    expect(
      getChainLiveState(new Date(now - 5_000).toISOString(), now),
    ).toEqual({ live: true, label: "LIVE" });
  });

  it("reports LIVE exactly at the staleness boundary", () => {
    expect(
      getChainLiveState(new Date(now - CHAIN_STALE_AFTER_MS).toISOString(), now),
    ).toEqual({ live: true, label: "LIVE" });
  });

  it("reports STALE minutes past the boundary", () => {
    expect(
      getChainLiveState(new Date(now - 2 * 60_000).toISOString(), now),
    ).toEqual({ live: false, label: "STALE 2m" });
  });

  it("reports STALE hours for older chains", () => {
    expect(
      getChainLiveState(new Date(now - 3 * 3_600_000).toISOString(), now),
    ).toEqual({ live: false, label: "STALE 3h" });
  });

  it("reports STALE days for very old chains", () => {
    expect(
      getChainLiveState(new Date(now - 2 * 86_400_000).toISOString(), now),
    ).toEqual({ live: false, label: "STALE 2d" });
  });

  it("reports STALE when timestamp is missing or invalid", () => {
    expect(getChainLiveState(undefined, now)).toEqual({ live: false, label: "STALE" });
    expect(getChainLiveState("not-a-date", now)).toEqual({ live: false, label: "STALE" });
  });

  it("keeps the 15s cadence with a 30s staleness threshold", () => {
    expect(CHAIN_POLL_INTERVAL_MS).toBe(15_000);
    expect(CHAIN_STALE_AFTER_MS).toBe(30_000);
  });
});
