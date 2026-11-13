// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import type { WallsPayload, WallsRow } from "@/api/reportNifty";
import { NiftyPressureDesk } from "./NiftyPressureDesk";

const row = (overrides: Partial<WallsRow> = {}): WallsRow => ({
  strike: 25000,
  oi: 4_440_000,
  oi_open: 3_040_000,
  ltp: 180,
  erosion_5m: 0.006,
  erosion_15m: 0.012,
  erosion_30m: -0.015,
  prem_chg_5m: 0.044,
  prem_chg_15m: 0.104,
  prem_chg_30m: 0.104,
  flow: "WRITERS_COVERING",
  status: "STABLE",
  fuel_score: 44,
  distance_pts: 71.5,
  oi_history: [4_500_000, 4_480_000, 4_440_000],
  ltp_history: [160, 170, 180],
  ...overrides,
});

const walls = {
  symbol: "NIFTY",
  date: "2026-11-09",
  expiry: "2026-11-17",
  dte: 8,
  spot: 24928.55,
  max_pain: 24800,
  max_pain_drift: 0,
  atm: 25000,
  net_gex: 0,
  flip: 25700,
  regime: "SHORT",
  gex_degraded: false,
  pin_distance_pts: 128.55,
  pin_distance_pct: 0.52,
  state: "WALL_WATCH",
  expiry_day: false,
  alert_eligible: false,
  alert: null,
  reasons: [],
  call_wall: { strike: 25000, oi: 4_440_000 },
  put_wall: { strike: 24000, oi: 4_540_000 },
  tracked_call_erosion_30m: -0.015,
  tracked_call_erosion_5m: 0.006,
  tracked_put_build_30m: 0.02,
  near: true,
  cross: false,
  calls: [
    row({ strike: 26000, oi: 5_950_000, distance_pts: 1071.45 }),
    row({ strike: 25500, oi: 4_450_000, distance_pts: 571.45 }),
    row({ strike: 25000 }),
  ],
  puts: [
    row({
      strike: 24000,
      oi: 4_540_000,
      distance_pts: -928.55,
      erosion_30m: 0.02,
      prem_chg_30m: -0.121,
      flow: "WRITERS_ADDING",
      status: "BUILDING",
      fuel_score: 22,
    }),
    row({ strike: 23000, oi: 4_220_000, distance_pts: -1928.55 }),
  ],
  events: [],
  history: [],
  freshness: { last_t: "2026-11-09T13:57:00+05:30", age_sec: 0, stale: false, rows: 30, gaps: [] },
  window_min: 60,
  top: 3,
} as unknown as WallsPayload;

afterEach(cleanup);

describe("NiftyPressureDesk", () => {
  it("renders the phase plane, selected read and the accessible table", () => {
    render(() => <NiftyPressureDesk open walls={walls} onClose={vi.fn()} />);

    expect(screen.getByText("PRESSURE DESK")).toBeInTheDocument();
    expect(screen.getByTestId("pressure-plane-CALL-25000")).toBeInTheDocument();
    expect(screen.getByText("Selected wall")).toBeInTheDocument();
    expect(screen.getByText("Short gamma: covering can accelerate upside through the wall.")).toBeInTheDocument();
    expect(screen.getByText("30m path")).toBeInTheDocument();

    const table = screen.getByTestId("pressure-desk-table");
    expect(within(table).getByText("25,000 CE")).toBeInTheDocument();
    expect(within(table).getByText("30m PREM")).toBeInTheDocument();
  });

  it("switches the read and table selection when a wall row is clicked", () => {
    render(() => <NiftyPressureDesk open walls={walls} onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId("pressure-row-PUT-24000"));

    expect(screen.getAllByText("24,000 PE").length).toBeGreaterThan(0);
    expect(screen.getByText("Writers are adding; a break needs real absorption.")).toBeInTheDocument();
    expect(screen.getByTestId("pressure-table-PUT-24000").style.background).not.toBe("");
  });

  it("closes through the panel shell", () => {
    const onClose = vi.fn();
    render(() => <NiftyPressureDesk open walls={walls} onClose={onClose} />);

    fireEvent.click(screen.getByTestId("panel-modal-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the empty state when the replay has no walls payload", () => {
    render(() => <NiftyPressureDesk open walls={null} onClose={vi.fn()} />);

    expect(screen.getByTestId("pressure-desk-empty")).toHaveTextContent(
      "No walls tape at this replay time.",
    );
  });
});
