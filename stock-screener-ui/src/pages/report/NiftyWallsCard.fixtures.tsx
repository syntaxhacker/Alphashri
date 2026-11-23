import { afterEach, vi } from "vitest";
import { cleanup } from "@solidjs/testing-library";
import type { WallsPayload } from "@/api/reportNifty";
import type { NiftyReport } from "@/types/niftyReport";

export const walls: WallsPayload = {
  symbol: "SENSEX",
  date: "2026-10-29",
  expiry: "2026-10-29",
  dte: 0,
  spot: 74096,
  max_pain: 73900,
  max_pain_drift: 100,
  atm: 74000,
  net_gex: 58.78,
  flip: 74100,
  gex_degraded: false,
  pin_distance_pts: 196,
  pin_distance_pct: 0.265,
  state: "BREAK",
  expiry_day: true,
  alert_eligible: true,
  alert: {
    symbol: "SENSEX",
    wall: 74000,
    spot: 74096,
    erosion_30m: -0.1388,
    put_build_30m: 2.1227,
    max_pain_drift: 100,
    max_pain: 73900,
    at: "2026-10-29T14:25:48.854611+05:30",
    cooldown_min: 15,
    reasons: [],
  },
  reasons: [
    "0-DTE",
    "call wall 74,000",
    "call wall -13.9% / 60m",
    "put build +212.3%",
  ],
  call_wall: {
    strike: 74000,
    oi: 8169120,
    oi_open: 6969120,
    new_oi: 1200000,
    new_oi_pct: 0.172,
    ltp: 145.35,
    distance_pts: -96,
    distance_pct: -0.13,
  },
  put_wall: {
    strike: 73500,
    oi: 7940520,
    oi_open: 6740520,
    new_oi: 1200000,
    new_oi_pct: 0.178,
    ltp: 20.1,
    distance_pts: -596,
    distance_pct: -0.8,
  },
  tracked_call_erosion_30m: -0.1388,
  tracked_call_erosion_5m: -0.02,
  tracked_put_build_30m: 2.1227,
  near: true,
  cross: true,
  calls: [
    {
      strike: 74200,
      oi: 5923820,
      oi_open: 6123820,
      new_oi: -200000,
      new_oi_pct: -0.032,
      erosion_5m: -0.01,
      erosion_30m: -0.034,
      erosion_rate_30m: -0.0011,
      vol_mult: 1.3,
      prem_chg_5m: 0.012,
      flow: "WRITERS_COVERING",
      status: "ERODING",
      fuel_score: 78,
      fuel_parts: { erosion: 55, volume: 80, proximity: 75, gamma: 60, flow: 70 },
      time_to_break_min: 4,
      oi_history: [5_900_000, 5_923_820],
      distance_pct: 0.14,
      tracked: false,
      nearest: true,
    },
    { strike: 74000, oi: 8169120, oi_open: 6969120, new_oi: 1200000, new_oi_pct: 0.172, erosion_5m: -0.02, erosion_30m: -0.1388, distance_pct: -0.13, tracked: true },
  ],
  puts: [
    { strike: 73500, oi: 7940520, oi_open: 6740520, new_oi: 1200000, new_oi_pct: 0.178, erosion_5m: 0.04, erosion_30m: 0.18, distance_pct: -0.8, tracked: true },
    { strike: 73700, oi: 5543550, oi_open: 5543550, new_oi: 0, new_oi_pct: 0, erosion_5m: 0.01, erosion_30m: 0.02, distance_pct: -0.53, tracked: false, flow: "WRITERS_ADDING", status: "ERODING" },
  ],
  events: [
    {
      at: "2026-10-29T14:25:48.854611+05:30",
      kind: "BREAK",
      wall: 74000,
      spot: 74096,
      erosion_30m: -0.1388,
      put_build_30m: 2.1227,
      max_pain_drift: 100,
      max_pain: 73900,
    },
  ],
  history: [
    {
      t: "2026-10-29T14:20:00+05:30",
      spot: 74000,
      max_pain: 73900,
      call_oi: 9000000,
      put_oi: 3000000,
    },
    {
      t: "2026-10-29T14:25:00+05:30",
      spot: 74096,
      max_pain: 73900,
      call_oi: 8169120,
      put_oi: 6400000,
    },
  ],
  freshness: {
    last_t: "2026-10-29T15:29:08.713634+05:30",
    age_sec: 60,
    stale: false,
    rows: 125,
    gaps: [],
  },
  window_min: 60,
  top: 3,
};

export const wallsWithMap: WallsPayload = {
  ...walls,
  read: "call wall 74,000 -13.9% / 60m · broke 74,000 at 14:25:48",
  regime: "SHORT",
  wall_map: {
    strikes: [74200, 74000, 73700, 73500],
    times: ["2026-10-29T14:20:00+05:30", "2026-10-29T14:25:00+05:30"],
    call_delta: [
      [0, -0.05],
      [0, -0.14],
      [0, 0.02],
      [0, 0.1],
    ],
    put_delta: [
      [0, 0.1],
      [0, 2.1],
      [0, 0.02],
      [0, 0.18],
    ],
    call_delta_open: [
      [0.1, 0.2],
      [0.2, 0.3],
      [0.02, 0.04],
      [0.1, 0.18],
    ],
    put_delta_open: [
      [0.1, 0.2],
      [0.5, 2.1],
      [0.02, 0.04],
      [0.18, 0.2],
    ],
    call_oi: [
      [5923820, 5923820],
      [8169120, 8169120],
      [5543550, 5543550],
      [7940520, 7940520],
    ],
    put_oi: [
      [3000000, 3000000],
      [6400000, 6400000],
      [5543550, 5543550],
      [7940520, 7940520],
    ],
    call_now: [5923820, 8169120, 5543550, 7940520],
    put_now: [3000000, 6400000, 5543550, 7940520],
    call_open: [5000000, 7000000, 5000000, 7000000],
    put_open: [2500000, 6000000, 5000000, 7000000],
    top_call: [74000, 74000],
    top_put: [73500, 73500],
    spot: [74000, 74096],
    max_pain: [73900, 73900],
    flip: [74100, 74100],
    pin_band: { low: [73850, 73850], high: [73950, 73950] },
  },
};

export const onExpand = vi.fn();

export function makeReport(over: Partial<NiftyReport> = {}): NiftyReport {
  return {
    mode: "live",
    date: "2026-11-06",
    expiry: "2026-11-06",
    spot: 24_650,
    ohlc: { open: 24_600, high: 24_720, low: 24_540, close: 24_650 },
    pcrOi: 1.05,
    pcrVol: 1.1,
    maxPain: 24_600,
    walls: { calls: [], puts: [] },
    strikes: [],
    timeline: [],
    ...over,
  };
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  onExpand.mockClear();
});
