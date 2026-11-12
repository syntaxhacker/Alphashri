// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@solidjs/testing-library";

import type { WallsPayload } from "@/api/reportNifty";
import { NiftyWallErosionBoard } from "./NiftyWallErosionBoard";

const makeWalls = (over: Partial<WallsPayload> = {}): WallsPayload => ({
  symbol: "NIFTY",
  date: "2026-11-10",
  expiry: "2026-11-10",
  dte: 0,
  spot: 25_000,
  max_pain: 24_950,
  max_pain_drift: 50,
  atm: 25_000,
  net_gex: -12.3,
  flip: 25_800,
  regime: "SHORT",
  gex_degraded: false,
  pin_distance_pts: 50,
  pin_distance_pct: 0.2,
  state: "WATCH",
  expiry_day: true,
  alert_eligible: false,
  alert: null,
  reasons: [],
  call_wall: { strike: 25_000, oi: 3_990_000 },
  put_wall: { strike: 24_800, oi: 2_100_000 },
  tracked_call_erosion_30m: -0.034,
  tracked_call_erosion_5m: -0.01,
  tracked_put_build_30m: 0.12,
  near: true,
  cross: false,
  calls: [],
  puts: [],
  nearest_call: {
    strike: 25_000,
    oi: 3_990_000,
    erosion_30m: -0.034,
    erosion_rate_30m: -0.0011,
    vol_mult: 1.3,
    prem_chg_5m: 0.012,
    flow: "WRITERS_COVERING",
    status: "ERODING",
    fuel_score: 78,
    fuel_parts: { erosion: 30, volume: 20, proximity: 12, gamma: 10, flow: 6 },
    time_to_break_min: 4,
    oi_history: [4_300_000, 4_150_000, 4_080_000, 3_990_000],
    distance_pts: 32,
    distance_pct: 0.128,
  },
  nearest_put: {
    strike: 24_800,
    oi: 2_100_000,
    erosion_30m: 0.018,
    erosion_rate_30m: 0.0006,
    vol_mult: 0.8,
    prem_chg_5m: -0.004,
    flow: "WRITERS_ADDING",
    status: "BUILDING",
    fuel_score: 18,
    time_to_break_min: 38,
    oi_history: [1_900_000, 1_950_000, 2_020_000, 2_100_000],
    distance_pts: -45,
    distance_pct: -0.18,
  },
  events: [],
  history: [],
  freshness: {
    last_t: "2026-11-10T14:25:00+05:30",
    age_sec: 30,
    stale: false,
    rows: 60,
    gaps: [],
  },
  window_min: 60,
  top: 3,
  ...over,
});

afterEach(() => {
  cleanup();
});

describe("NiftyWallErosionBoard", () => {
  it("renders both cards with erosion, fuel, flow and header context", () => {
    render(() =>     <NiftyWallErosionBoard walls={makeWalls()} />);

    const board = screen.getByTestId("wall-erosion-board");
    expect(board).toBeInTheDocument();
    expect(within(board).getByTestId("wall-erosion-call")).toBeInTheDocument();
    expect(within(board).getByTestId("wall-erosion-put")).toBeInTheDocument();

    const call = within(board).getByTestId("wall-erosion-call");
    expect(within(call).getByText(/25,000/)).toBeInTheDocument();
    expect(within(call).getByText("WRITERS COVERING")).toBeInTheDocument();
    expect(within(call).getByText("1.3×")).toBeInTheDocument();
    expect(within(call).getByText("3.99M")).toBeInTheDocument();
    expect(within(call).getByText("ERODING")).toBeInTheDocument();
    expect(within(call).getByText(/PRE-BLAST 78/)).toBeInTheDocument();
    expect(within(call).getByText(/~4m to break/)).toBeInTheDocument();
    expect(within(call).getByText("+32 pts")).toBeInTheDocument();
    expect(within(call).getByTestId("wall-erosion-call-spark")).toBeInTheDocument();

    expect(within(board).getByText(/SHORT Γ/)).toBeInTheDocument();
    expect(within(board).getByText(/flip 25,800/)).toBeInTheDocument();
    expect(within(board).getByText(/as of 14:25/)).toBeInTheDocument();
  });

  it("shows BUILDING and no PRE-BLAST on the put card", () => {
    render(() =>     <NiftyWallErosionBoard walls={makeWalls()} />);

    const put = screen.getByTestId("wall-erosion-put");
    expect(within(put).getByText("BUILDING")).toBeInTheDocument();
    expect(within(put).queryByText(/PRE-BLAST/)).toBeNull();
    expect(within(put).getByText("FUEL 18")).toBeInTheDocument();
    expect(within(put).getByText(/24,800/)).toBeInTheDocument();
    expect(within(put).getByText("−45 pts")).toBeInTheDocument();
  });

  it("prefers the asOf prop over walls.freshness.last_t", () => {
    render(() => (    <NiftyWallErosionBoard walls={makeWalls()} asOf="2026-11-10T15:05:00+05:30" />));
    expect(screen.getByText(/as of 15:05/)).toBeInTheDocument();
  });

  it("keeps the same two-row shape when walls is null", () => {
    render(() =>     <NiftyWallErosionBoard walls={null} />);

    const board = screen.getByTestId("wall-erosion-board");
    expect(board).toBeInTheDocument();
    expect(screen.getByTestId("wall-erosion-skeleton")).toBeInTheDocument();
    expect(within(board).queryByText("Waiting for walls data.")).toBeNull();

    // Same two rows as the loaded state — the strip never collapses.
    expect(within(board).getAllByTestId("wall-erosion-row")).toHaveLength(2);
    expect(within(board).getByTestId("wall-erosion-call")).toBeInTheDocument();
    expect(within(board).getByTestId("wall-erosion-put")).toBeInTheDocument();

    const call = within(board).getByTestId("wall-erosion-call");
    expect(within(call).getAllByText("—").length).toBeGreaterThan(0);
    expect(within(call).getByText("FUEL 0")).toBeInTheDocument();

    const put = within(board).getByTestId("wall-erosion-put");
    expect(within(put).getAllByText("—").length).toBeGreaterThan(0);
    expect(within(put).getByText("FUEL 0")).toBeInTheDocument();

    // Header slots stay in place so the title bar keeps its height.
    expect(within(board).getByText("as of —")).toBeInTheDocument();
  });

  it("renders dashes instead of crashing when wall fields are missing", () => {
    const walls = makeWalls({
      nearest_call: { strike: 25_100, oi: 1_000_000 },
      nearest_put: null,
      regime: null,
      flip: null,
    });
    render(() =>     <NiftyWallErosionBoard walls={walls} />);

    const call = screen.getByTestId("wall-erosion-call");
    expect(within(call).getByText(/25,100/)).toBeInTheDocument();
    expect(within(call).getAllByText("—").length).toBeGreaterThan(0);
    expect(within(call).getByText("FUEL 0")).toBeInTheDocument();

    const put = screen.getByTestId("wall-erosion-put");
    expect(within(put).getAllByText("—").length).toBeGreaterThan(0);
    expect(within(put).getByText("FUEL 0")).toBeInTheDocument();

    // No regime/flip chips when the payload omits them.
    expect(screen.queryByTestId("wall-erosion-regime")).toBeNull();
    expect(screen.queryByText(/flip /)).toBeNull();
  });

  it("shows BREACHED prominently and replaces time-to-break with spot crossed", () => {
    const walls = makeWalls();
    walls.nearest_call = {
      ...walls.nearest_call!,
      status: "BREACHED",
      time_to_break_min: null,
    };
    render(() =>     <NiftyWallErosionBoard walls={walls} />);

    const call = screen.getByTestId("wall-erosion-call");
    expect(within(call).getByText("spot crossed")).toBeInTheDocument();
    expect(within(call).queryByText(/to break/)).toBeNull();
  });

  it("renders exactly two rows and no skeleton for a full payload", () => {
    render(() =>     <NiftyWallErosionBoard walls={makeWalls()} />);

    const body = screen.getByTestId("wall-erosion-body");
    const rows = within(body).getAllByTestId("wall-erosion-row");
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.getAttribute("data-side"))).toEqual([
      "CALL",
      "PUT",
    ]);
    expect(screen.queryByTestId("wall-erosion-skeleton")).toBeNull();
  });

  it("pins the body to a fixed two-row layout in both states", () => {
    const { unmount } = render(() =>     <NiftyWallErosionBoard walls={null} />);
    const emptyBody = screen.getByTestId("wall-erosion-body");
    expect(emptyBody.getAttribute("data-layout")).toBe("fixed");
    expect(emptyBody.getAttribute("data-rows")).toBe("2");
    expect(within(emptyBody).getAllByTestId("wall-erosion-row")).toHaveLength(2);
    unmount();

    render(() =>     <NiftyWallErosionBoard walls={makeWalls()} />);
    const fullBody = screen.getByTestId("wall-erosion-body");
    expect(fullBody.getAttribute("data-layout")).toBe("fixed");
    expect(fullBody.getAttribute("data-rows")).toBe("2");
    expect(within(fullBody).getAllByTestId("wall-erosion-row")).toHaveLength(2);
  });
});
